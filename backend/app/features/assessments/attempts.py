"""Online quiz attempts. Answers are saved on the server, so a reload resumes the same attempt;
starting and submitting are serialised per student and assessment, so concurrent requests can
never create an extra attempt or score twice."""
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import and_, func, select, text

from app.errors import fail
from app.features.academics.models import Enrollment
from app.features.accounts.commands import audit
from app.features.accounts.models import Account, now
from app.features.study.events import record_event

from .definitions import questions_of, revision
from .models import Assessment, QuizAnswer, QuizAttempt, QuizQuestionClock
from .results import release_one
from .reviews import flag_graded_change
from .scores import sync_quiz_score
from .scoring import points_for

MAX_ANSWER_CHARS = 1000


def student_lock(db, assessment_id, student_id):
    """Transaction-scoped advisory lock: one writer per (assessment, student)."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
               {"k": f"{assessment_id}:{student_id}"})


def window_late(rev, at):
    """Raise if the quiz is not open; return True when work would be late (allowed by policy)."""
    if rev.available_from and at < rev.available_from:
        fail(409, "not_open", "This quiz has not opened yet.")
    late = bool(rev.deadline and at > rev.deadline)
    if late and not rev.allow_late:
        fail(409, "closed", "The deadline has passed.")
    return late


def expired(rev, at):
    return bool(rev.deadline and at > rev.deadline and not rev.allow_late)


def attempt_questions(db, attempt):
    return questions_of(db, attempt.revision_id)


def question_clock_map(db, attempt):
    return {clock.question_key: clock for clock in db.scalars(
        select(QuizQuestionClock).where(QuizQuestionClock.attempt_id == attempt.id))}


def has_response(response):
    return response is not None and not (isinstance(response, str) and not response.strip())


def activate_question(db, attempt, question, started_at):
    clock = QuizQuestionClock(
        attempt_id=attempt.id,
        question_key=question.key,
        started_at=started_at,
        expires_at=started_at + timedelta(seconds=question.duration_seconds),
        status="active",
    )
    db.add(clock)
    db.flush()
    return clock


def lock_question(clock, status, at):
    clock.status = status
    clock.locked_at = at


def validate_answer(question, response):
    valid = (
        response is None
        or (question.type == "multiple_choice" and isinstance(response, str)
            and response in {choice["id"] for choice in question.choices})
        or (question.type == "true_false" and isinstance(response, bool))
        or (question.type == "short_answer" and isinstance(response, str)
            and len(response) <= MAX_ANSWER_CHARS)
    )
    if not valid:
        fail(422, "answer_invalid", "The answer does not match this question's response type.")
    return response


def save_one_answer(db, attempt, question, response):
    response = validate_answer(question, response)
    answer = db.scalar(select(QuizAnswer).where(
        QuizAnswer.attempt_id == attempt.id, QuizAnswer.question_key == question.key))
    if answer:
        answer.response = response
    else:
        db.add(QuizAnswer(attempt_id=attempt.id, question_key=question.key, response=response))


def finalize(db, attempt, by_student=False):
    """Score the saved answers, close the attempt, refresh the working score and release it.
    Only a submit the student made counts as progress; expiry and faculty closing do not."""
    questions = attempt_questions(db, attempt)
    at = now()
    clocks = question_clock_map(db, attempt)
    for question in questions:
        clock = clocks.get(question.key)
        if clock is None:
            clock = QuizQuestionClock(
                attempt_id=attempt.id, question_key=question.key, started_at=at,
                expires_at=at, locked_at=at, status="skipped")
            db.add(clock)
        elif clock.status == "active":
            lock_question(clock, "timed_out" if clock.expires_at <= at else "skipped", at)
    answers = {a.question_key: a for a in db.scalars(
        select(QuizAnswer).where(QuizAnswer.attempt_id == attempt.id))}
    total = Decimal(0)
    for q in questions:
        row = answers.get(q.key)
        if row is None:
            row = QuizAnswer(attempt_id=attempt.id, question_key=q.key, response=None)
            db.add(row)
        row.auto_awarded = row.awarded = points_for(q, row.response)
        total += row.awarded
    attempt.score, attempt.max_score = total, sum((q.points for q in questions), Decimal(0))
    attempt.state, attempt.submitted_at = "submitted", now()
    db.flush()
    assessment_rev = revision(db, attempt.assessment_id, "published")
    assessment = db.get(Assessment, attempt.assessment_id)
    row = sync_quiz_score(db, assessment, assessment_rev, attempt.student_id)
    release_one(db, assessment, assessment_rev, row)   # online quiz totals are released at once
    flag_graded_change(db, assessment.offering_id, assessment_rev,
                       f"{assessment_rev.title}: a new attempt was scored.", [attempt.student_id])
    if by_student:
        record_event(db, attempt.student_id, assessment.offering_id, "quiz_submitted",
                     assessment.id, attempt.id)


def student_view(db, attempt):
    """Everything a student may see of an attempt: no answer keys, no explanations."""
    questions = attempt_questions(db, attempt)
    clocks = question_clock_map(db, attempt)
    answers = {a.question_key: a.response for a in db.scalars(
        select(QuizAnswer).where(QuizAnswer.attempt_id == attempt.id))}
    active = next((clock for clock in clocks.values() if clock.status == "active"), None)
    out = {"id": attempt.id, "state": attempt.state, "attempt_number": attempt.attempt_number,
           "started_at": attempt.started_at, "submitted_at": attempt.submitted_at,
           "server_now": now(),
           "question_count": len(questions),
           "active_question_key": active.question_key if active else None,
           "active_expires_at": active.expires_at if active else None,
           "questions": [{"key": q.key, "type": q.type, "prompt": q.prompt,
                          "choices": q.choices if q.type == "multiple_choice" else [],
                          "points": q.points, "duration_seconds": q.duration_seconds,
                          "status": clocks[q.key].status if q.key in clocks else "pending"}
                         for q in questions],
           "answers": answers}
    if attempt.state == "submitted":
        out["score"], out["max_score"] = attempt.score, attempt.max_score
    return out


def advance_question_deadlines(db, attempt, rev, at):
    """Persist any expired questions, chaining each next deadline from the prior expiry."""
    if attempt.state != "in_progress":
        return
    if expired(rev, at):
        finalize(db, attempt)
        return

    questions = attempt_questions(db, attempt)
    clocks = question_clock_map(db, attempt)
    answers = {answer.question_key: answer.response for answer in db.scalars(
        select(QuizAnswer).where(QuizAnswer.attempt_id == attempt.id))}

    for question in questions:
        clock = clocks.get(question.key)
        if clock and clock.paused_at and clock.status == "active":
            lock_question(clock, "skipped", clock.paused_at)
        elif clock is None and question.key in answers and has_response(answers[question.key]):
            clock = QuizQuestionClock(
                attempt_id=attempt.id, question_key=question.key,
                started_at=attempt.started_at,
                expires_at=attempt.started_at + timedelta(seconds=question.duration_seconds),
                locked_at=attempt.started_at, status="answered")
            db.add(clock)
            clocks[question.key] = clock

    active_clocks = [clock for clock in clocks.values() if clock.status == "active"]
    if len(active_clocks) > 1:
        active_clocks.sort(key=lambda clock: next(
            (index for index, question in enumerate(questions)
             if question.key == clock.question_key), len(questions)))
        for clock in active_clocks[1:]:
            lock_question(clock, "skipped", at)
        active_clocks = active_clocks[:1]

    cursor = active_clocks[0].started_at if active_clocks else at
    while True:
        active = active_clocks[0] if active_clocks else None
        if active is None:
            question = next((question for question in questions
                             if question.key not in clocks
                             or clocks[question.key].status == "pending"), None)
            if question is None:
                finalize(db, attempt)
                return
            active = activate_question(db, attempt, question, cursor)
            clocks[question.key] = active
            active_clocks = [active]
        if active.expires_at > at:
            return
        cursor = active.expires_at
        lock_question(active, "timed_out", cursor)
        active_clocks = []


def own_attempt(db, student, attempt_id, offering_id, lock=False):
    """The student's own attempt, which must live in the offering named in the URL: guards such as
    "term open" and "still enrolled" were checked against that offering, not any other."""
    query = select(QuizAttempt).where(QuizAttempt.id == attempt_id)
    if lock:   # re-read under the lock so a concurrent submit is never missed
        query = query.with_for_update().execution_options(populate_existing=True)
    attempt = db.scalar(query)
    if not attempt or attempt.student_id != student.id:
        fail(404, "not_found", "Attempt not found.")
    if db.get(Assessment, attempt.assessment_id).offering_id != offering_id:
        fail(404, "not_found", "Attempt not found.")
    return attempt


def used_attempts(db, assessment_id, student_id):
    return db.scalar(select(func.count()).select_from(QuizAttempt).where(
        QuizAttempt.assessment_id == assessment_id, QuizAttempt.student_id == student_id)) or 0


def start(db, student, assessment):
    rev = revision(db, assessment.id, "published")
    at = now()
    student_lock(db, assessment.id, student.id)
    current = db.scalar(select(QuizAttempt).where(
        QuizAttempt.assessment_id == assessment.id, QuizAttempt.student_id == student.id,
        QuizAttempt.state == "in_progress"))
    if current:
        advance_question_deadlines(db, current, rev, at)
        db.commit()
        return current
    window_late(rev, at)
    used = used_attempts(db, assessment.id, student.id)
    if used >= rev.max_attempts:
        fail(409, "attempts_exhausted", "You have used all your attempts for this quiz.")
    attempt = QuizAttempt(assessment_id=assessment.id, revision_id=rev.id, student_id=student.id,
                          attempt_number=used + 1)
    db.add(attempt)
    db.flush()
    questions = attempt_questions(db, attempt)
    if questions:
        activate_question(db, attempt, questions[0], at)
    db.commit()
    return attempt


def own_attempt_view(db, student, attempt_id, offering_id):
    target = own_attempt(db, student, attempt_id, offering_id)
    student_lock(db, target.assessment_id, student.id)
    attempt = own_attempt(db, student, attempt_id, offering_id, lock=True)
    rev = revision(db, attempt.assessment_id, "published")
    advance_question_deadlines(db, attempt, rev, now())
    db.commit()
    return student_view(db, attempt)


def save_answers(db, student, offering_id, attempt_id, answers):
    target = own_attempt(db, student, attempt_id, offering_id)
    student_lock(db, target.assessment_id, student.id)
    attempt = own_attempt(db, student, attempt_id, offering_id, lock=True)
    if attempt.state != "in_progress":
        fail(409, "attempt_closed", "This attempt has already been submitted.")
    rev = revision(db, attempt.assessment_id, "published")
    at = now()
    advance_question_deadlines(db, attempt, rev, at)
    if attempt.state != "in_progress":
        db.commit()
        fail(409, "attempt_closed", "The deadline passed; your saved answers were submitted.")
    questions = attempt_questions(db, attempt)
    clocks = question_clock_map(db, attempt)
    active = next((clock for clock in clocks.values() if clock.status == "active"), None)
    question = next((q for q in questions if active and q.key == active.question_key), None)
    if question is None:
        fail(409, "question_locked", "There is no active question to answer.")
    unknown = set(answers) - {question.key}
    if unknown:
        known = {q.key for q in questions}
        if unknown - known:
            fail(422, "question_unknown", "An answer refers to a question that is not in this quiz.")
        fail(409, "question_locked", "Only the current active question can be edited.")
    if active.expires_at <= at:
        advance_question_deadlines(db, attempt, rev, at)
        db.commit()
        fail(409, "question_expired", "This question's time limit has ended.")
    if answers:
        save_one_answer(db, attempt, question, answers[question.key])
    db.commit()
    return {"saved": len(answers)}


def navigate_question(db, student, offering_id, attempt_id, question_key):
    target = own_attempt(db, student, attempt_id, offering_id)
    student_lock(db, target.assessment_id, student.id)
    attempt = own_attempt(db, student, attempt_id, offering_id, lock=True)
    if attempt.state != "in_progress":
        fail(409, "attempt_closed", "This attempt has already been submitted.")
    rev = revision(db, attempt.assessment_id, "published")
    at = now()
    advance_question_deadlines(db, attempt, rev, at)
    if attempt.state != "in_progress":
        db.commit()
        fail(409, "attempt_closed", "The deadline passed; your saved answers were submitted.")
    questions = attempt_questions(db, attempt)
    if question_key not in {question.key for question in questions}:
        fail(422, "question_unknown", "The question is not part of this quiz.")
    clocks = question_clock_map(db, attempt)
    active = next((clock for clock in clocks.values() if clock.status == "active"), None)
    if not active:
        fail(409, "question_locked", "There is no active question to advance.")
    if question_key == active.question_key:
        return student_view(db, attempt)
    current_index = next(index for index, question in enumerate(questions)
                         if question.key == active.question_key)
    next_question = next((question for question in questions[current_index + 1:]
                          if question.key not in clocks
                          or clocks[question.key].status == "pending"), None)
    if not next_question or question_key != next_question.key:
        fail(409, "question_order", "Questions must be completed or skipped in order.")
    answer = db.scalar(select(QuizAnswer).where(
        QuizAnswer.attempt_id == attempt.id, QuizAnswer.question_key == active.question_key))
    lock_question(active, "answered" if answer and has_response(answer.response) else "skipped", at)
    activate_question(db, attempt, next_question, at)
    db.commit()
    return student_view(db, attempt)


def submit(db, student, offering_id, attempt_id, idempotency_key, answers):
    target = own_attempt(db, student, attempt_id, offering_id)
    student_lock(db, target.assessment_id, student.id)
    attempt = own_attempt(db, student, attempt_id, offering_id, lock=True)
    if attempt.state == "submitted":
        return student_view(db, attempt)                    # idempotent: same result, no re-score
    rev = revision(db, attempt.assessment_id, "published")
    at = now()
    ignored = bool(answers) and expired(rev, at)
    if ignored:
        finalize(db, attempt)
        db.commit()
        view = student_view(db, attempt)
        view["answers_ignored"] = True
        return view
    advance_question_deadlines(db, attempt, rev, at)
    if attempt.state == "submitted":
        db.commit()
        return student_view(db, attempt)
    questions = attempt_questions(db, attempt)
    clocks = question_clock_map(db, attempt)
    active = next((clock for clock in clocks.values() if clock.status == "active"), None)
    question = next((q for q in questions if active and q.key == active.question_key), None)
    if answers:
        keys = {q.key for q in questions}
        if set(answers) - keys:
            fail(422, "question_unknown", "An answer refers to a question that is not in this quiz.")
        saved = {a.question_key: a.response for a in db.scalars(
            select(QuizAnswer).where(QuizAnswer.attempt_id == attempt.id))}
        for key, response in answers.items():
            if active and key == active.question_key:
                if active.expires_at <= at:
                    fail(409, "question_expired", "This question's time limit has ended.")
                save_one_answer(db, attempt, question, response)
            elif key not in saved or response != saved[key]:
                fail(409, "question_locked", "Only the current active question can be answered.")
    if active:
        answer = db.scalar(select(QuizAnswer).where(
            QuizAnswer.attempt_id == attempt.id, QuizAnswer.question_key == active.question_key))
        lock_question(active, "answered" if answer and has_response(answer.response) else "skipped", at)
    attempt.idempotency_key = idempotency_key
    finalize(db, attempt, by_student=True)
    db.commit()
    return student_view(db, attempt)


# ---------- faculty ----------

def faculty_attempts(db, offering, assessment):
    rows = db.execute(
        select(QuizAttempt, Account.display_name, Account.student_number, Enrollment.section_id)
        .join(Account, Account.id == QuizAttempt.student_id)
        .outerjoin(Enrollment, and_(Enrollment.student_id == QuizAttempt.student_id,
                                    Enrollment.offering_id == offering.id))
        .where(QuizAttempt.assessment_id == assessment.id)
        .order_by(Account.display_name, QuizAttempt.attempt_number)).all()
    return [{"id": a.id, "student_id": a.student_id, "student": name, "student_number": number,
             "section_id": section_id,
             "attempt_number": a.attempt_number, "state": a.state, "score": a.score,
             "max_score": a.max_score, "submitted_at": a.submitted_at}
            for a, name, number, section_id in rows]


def faculty_attempt(db, assessment, attempt_id):
    attempt = db.get(QuizAttempt, attempt_id)
    if not attempt or attempt.assessment_id != assessment.id:
        fail(404, "not_found", "Attempt not found.")
    return attempt


def faculty_detail(db, attempt):
    answers = {a.question_key: a for a in db.scalars(
        select(QuizAnswer).where(QuizAnswer.attempt_id == attempt.id))}
    out = []
    for q in attempt_questions(db, attempt):
        a = answers.get(q.key)
        out.append({"key": q.key, "type": q.type, "prompt": q.prompt, "choices": q.choices,
                    "correct": q.correct, "points": q.points,
                    "response": a.response if a else None,
                    "auto_awarded": a.auto_awarded if a else None,
                    "awarded": a.awarded if a else None,
                    "correction_reason": a.correction_reason if a else None})
    return {"id": attempt.id, "student_id": attempt.student_id, "state": attempt.state,
            "attempt_number": attempt.attempt_number, "score": attempt.score,
            "max_score": attempt.max_score, "questions": out}


def correct_answer(db, actor, offering, assessment, attempt_id, key, data):
    """Audited manual correction (for example an equivalent short answer). It changes the
    working score and flags grades for review; it does NOT release anything by itself."""
    attempt = faculty_attempt(db, assessment, attempt_id)
    student_lock(db, assessment.id, attempt.student_id)
    if attempt.state != "submitted":
        fail(409, "attempt_open", "Only submitted attempts can be corrected.")
    question = next((q for q in attempt_questions(db, attempt) if q.key == key), None)
    if not question:
        fail(404, "not_found", "Question not found.")
    if Decimal(data.awarded) > Decimal(question.points):
        fail(422, "points_exceed", f"This question is worth {question.points} points.")
    answer = db.scalar(select(QuizAnswer).where(
        QuizAnswer.attempt_id == attempt.id, QuizAnswer.question_key == key))
    before = answer.awarded
    answer.awarded, answer.corrected_by, answer.correction_reason = data.awarded, actor.id, \
        data.reason
    db.flush()
    attempt.score = db.scalar(select(func.sum(QuizAnswer.awarded)).where(
        QuizAnswer.attempt_id == attempt.id)) or Decimal(0)
    rev = revision(db, assessment.id, "published")
    sync_quiz_score(db, assessment, rev, attempt.student_id)
    audit(db, actor, "attempt.corrected", "assessment", assessment.id,
          {"attempt_id": str(attempt.id), "question": key, "before": str(before),
           "after": str(data.awarded), "reason": data.reason})
    flag_graded_change(db, offering.id, rev, f"{rev.title}: an answer was corrected.",
                       [attempt.student_id])
    db.commit()
    return faculty_detail(db, attempt)


def close_open(db, actor, offering, assessment):
    """Faculty resolution for abandoned attempts: score what was saved, exactly as if the student
    had submitted. Only once the deadline has passed (or when there is no deadline)."""
    rev = revision(db, assessment.id, "published")
    if rev.deadline and now() <= rev.deadline:
        fail(409, "still_open", "Attempts can be closed after the deadline has passed.")
    open_attempts = db.scalars(select(QuizAttempt).where(
        QuizAttempt.assessment_id == assessment.id, QuizAttempt.state == "in_progress")).all()
    closed = []
    for attempt in open_attempts:
        student_lock(db, assessment.id, attempt.student_id)
        fresh = db.scalar(select(QuizAttempt).where(QuizAttempt.id == attempt.id)
                          .with_for_update().execution_options(populate_existing=True))
        if fresh.state == "in_progress":
            finalize(db, fresh)
            closed.append(fresh.student_id)
    if closed:
        audit(db, actor, "attempts.closed", "assessment", assessment.id, {"count": len(closed)})
        flag_graded_change(db, offering.id, rev, f"{rev.title}: open attempts were closed.", closed)
    db.commit()
    return {"closed": len(closed)}
