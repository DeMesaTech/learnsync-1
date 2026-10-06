"""Assessment definitions: versioned drafts (compare-and-swap), validated publishing, and the
rules that freeze answer keys once students have started attempts."""
from decimal import Decimal

from sqlalchemy import delete, func, select

from app.errors import fail
from app.features.accounts.commands import audit
from app.features.accounts.models import now
from app.features.teaching.items import check_sections, outline_ids

from .models import (
    Assessment,
    AssessmentRevision,
    AssessmentScore,
    AssessmentSection,
    QuizAttempt,
    QuizQuestion,
)
from .policy import category_keys, period_keys, published_policy
from .reviews import flag_graded_change, flag_review
from .scoring import normalize_text

SCORED_BY_FACULTY = {"offline_quiz", "exam", "manual", "activity"}


def get_assessment(db, offering, assessment_id):
    a = db.get(Assessment, assessment_id)
    if not a or a.offering_id != offering.id:
        fail(404, "not_found", "Assessment not found.")
    return a


def revision(db, assessment_id, state):
    return db.scalar(select(AssessmentRevision).where(
        AssessmentRevision.assessment_id == assessment_id, AssessmentRevision.state == state))


def questions_of(db, revision_id):
    return db.scalars(select(QuizQuestion).where(QuizQuestion.revision_id == revision_id)
                      .order_by(QuizQuestion.position)).all()


def section_ids_of(db, assessment_id):
    return set(db.scalars(select(AssessmentSection.section_id)
                          .where(AssessmentSection.assessment_id == assessment_id)))


def has_attempts(db, assessment_id):
    return db.scalar(select(QuizAttempt.id).where(
        QuizAttempt.assessment_id == assessment_id).limit(1)) is not None


def question_view(q):
    return {"key": q.key, "type": q.type, "prompt": q.prompt, "choices": q.choices,
            "correct": q.correct, "explanation": q.explanation, "points": q.points,
            "source": q.source}


def rev_view(db, rev):
    return {"version": rev.version, "state": rev.state, "counter": rev.draft_counter,
            "title": rev.title, "instructions": rev.instructions,
            "category_key": rev.category_key, "period": rev.period, "max_points": rev.max_points,
            "available_from": rev.available_from, "deadline": rev.deadline,
            "allow_late": rev.allow_late, "max_attempts": rev.max_attempts,
            "score_rule": rev.score_rule, "include_in_grade": rev.include_in_grade,
            "anchor_node_id": rev.anchor_node_id, "updated_at": rev.updated_at,
            "published_at": rev.published_at, "ai_generated": rev.ai_generated,
            "ai_language": rev.ai_language,
            "reviewed": rev.reviewed_counter is not None
            and rev.reviewed_counter == rev.draft_counter,
            "questions": [question_view(q) for q in questions_of(db, rev.id)]}


def assessment_view(db, a):
    published, draft = revision(db, a.id, "published"), revision(db, a.id, "draft")
    return {"id": a.id, "kind": a.kind, "archived": a.archived,
            "section_ids": sorted(section_ids_of(db, a.id), key=str),
            "has_attempts": has_attempts(db, a.id) if a.kind == "online_quiz" else False,
            "published": rev_view(db, published) if published else None,
            "draft": rev_view(db, draft) if draft else None}


def faculty_list(db, offering):
    rows = db.scalars(select(Assessment).where(Assessment.offering_id == offering.id)
                      .order_by(Assessment.created_at)).all()
    return [assessment_view(db, a) for a in rows]


def create(db, actor, offering, data):
    section_ids = list(dict.fromkeys(data.section_ids))
    check_sections(db, offering, section_ids)
    a = Assessment(offering_id=offering.id, kind=data.kind, created_by=actor.id)
    db.add(a)
    db.flush()
    defaults = {"max_attempts": 1, "include_in_grade": True}
    db.add(AssessmentRevision(assessment_id=a.id, version=1, title=data.title,
                              created_by=actor.id, **defaults))
    for section_id in section_ids:
        db.add(AssessmentSection(assessment_id=a.id, section_id=section_id))
    audit(db, actor, "assessment.created", "assessment", a.id, {"kind": data.kind})
    db.commit()
    return a


def locked_draft(db, assessment, expected_counter):
    draft = db.scalar(select(AssessmentRevision).where(
        AssessmentRevision.assessment_id == assessment.id, AssessmentRevision.state == "draft")
        .with_for_update())
    if not draft:
        fail(404, "no_draft", "There is no draft to change. Start editing first.")
    if draft.draft_counter != expected_counter:
        fail(409, "draft_revision_conflict",
             "This draft changed elsewhere. Review the newer version before saving.")
    return draft


def start_draft(db, actor, assessment):
    db.scalar(select(Assessment.id).where(Assessment.id == assessment.id).with_for_update())
    draft = revision(db, assessment.id, "draft")
    if draft:
        return draft
    base = revision(db, assessment.id, "published")
    version = (db.scalar(select(func.max(AssessmentRevision.version))
                         .where(AssessmentRevision.assessment_id == assessment.id)) or 0) + 1
    draft = AssessmentRevision(
        assessment_id=assessment.id, version=version, created_by=actor.id, title=base.title,
        instructions=base.instructions, category_key=base.category_key, period=base.period,
        max_points=base.max_points, available_from=base.available_from, deadline=base.deadline,
        allow_late=base.allow_late, max_attempts=base.max_attempts, score_rule=base.score_rule,
        include_in_grade=base.include_in_grade, anchor_node_id=base.anchor_node_id,
        ai_generated=base.ai_generated, ai_language=base.ai_language)   # a new draft needs a fresh review
    db.add(draft)
    db.flush()
    for q in questions_of(db, base.id):   # same keys: question identity survives revisions
        db.add(QuizQuestion(revision_id=draft.id, key=q.key, position=q.position, type=q.type,
                            prompt=q.prompt, choices=q.choices, correct=q.correct,
                            explanation=q.explanation, points=q.points, source=q.source))
    db.commit()
    return draft


def save_draft(db, actor, offering, assessment, data):
    draft = locked_draft(db, assessment, data.expected_counter)
    if data.anchor_node_id and str(data.anchor_node_id) not in outline_ids(
            db, offering, ["draft", "published"]):
        fail(422, "anchor_invalid", "Choose a chapter or topic from this subject's syllabus.")
    for field in ("title", "instructions", "category_key", "period", "max_points",
                  "available_from", "deadline", "allow_late", "max_attempts", "score_rule",
                  "include_in_grade"):
        setattr(draft, field, getattr(data, field))
    draft.anchor_node_id = str(data.anchor_node_id) if data.anchor_node_id else None
    if assessment.kind == "online_quiz":
        db.execute(delete(QuizQuestion).where(QuizQuestion.revision_id == draft.id))
        db.flush()
        seen = set()
        for position, q in enumerate(data.questions):
            if q.key in seen:
                fail(422, "question_duplicate", "Each question needs its own identity.")
            seen.add(q.key)
            db.add(QuizQuestion(revision_id=draft.id, key=str(q.key), position=position,
                                type=q.type, prompt=q.prompt,
                                choices=[c.model_dump() for c in q.choices], correct=q.correct,
                                explanation=q.explanation, points=q.points, source=q.source))
        draft.max_points = sum((q.points for q in data.questions), Decimal(0))
    draft.draft_counter += 1
    db.commit()
    return {"counter": draft.draft_counter, "updated_at": draft.updated_at,
            "max_points": draft.max_points}


def review(db, actor, assessment, expected_counter):
    """Faculty confirm they read every question of an AI-drafted quiz. The confirmation is tied to
    this exact draft counter, so any later edit (which bumps it) cancels the review."""
    draft = locked_draft(db, assessment, expected_counter)
    if not draft.ai_generated:
        fail(422, "not_ai_generated", "Only AI-drafted quizzes need this review.")
    draft.reviewed_counter, draft.reviewed_by = draft.draft_counter, actor.id
    audit(db, actor, "assessment.ai_reviewed", "assessment", assessment.id)
    db.commit()
    return {"reviewed": True, "counter": draft.draft_counter}


def discard_draft(db, actor, assessment, expected_counter):
    draft = locked_draft(db, assessment, expected_counter)
    if not revision(db, assessment.id, "published"):
        fail(409, "never_published", "This assessment was never published; delete it instead.")
    db.execute(delete(QuizQuestion).where(QuizQuestion.revision_id == draft.id))
    db.delete(draft)
    db.commit()


def delete_assessment(db, actor, assessment):
    published = revision(db, assessment.id, "published")
    superseded = db.scalar(select(AssessmentRevision.id).where(
        AssessmentRevision.assessment_id == assessment.id,
        AssessmentRevision.state == "superseded"))
    scored = db.scalar(select(AssessmentScore.id).where(
        AssessmentScore.assessment_id == assessment.id))
    if published or superseded or scored or has_attempts(db, assessment.id):
        fail(409, "has_history", "Published assessments are archived, not deleted.")
    for rev in db.scalars(select(AssessmentRevision).where(
            AssessmentRevision.assessment_id == assessment.id)):
        db.execute(delete(QuizQuestion).where(QuizQuestion.revision_id == rev.id))
        db.delete(rev)
    db.execute(delete(AssessmentSection).where(AssessmentSection.assessment_id == assessment.id))
    audit(db, actor, "assessment.deleted", "assessment", assessment.id)
    db.delete(assessment)
    db.commit()


def update_settings(db, actor, offering, assessment, data):
    if data.section_ids is not None:
        section_ids = list(dict.fromkeys(data.section_ids))
        check_sections(db, offering, section_ids)
        db.execute(delete(AssessmentSection).where(
            AssessmentSection.assessment_id == assessment.id))
        for section_id in section_ids:
            db.add(AssessmentSection(assessment_id=assessment.id, section_id=section_id))
    if data.archived is not None:
        assessment.archived = data.archived
    audit(db, actor, "assessment.settings_changed", "assessment", assessment.id,
          data.model_dump(mode="json", exclude_none=True))
    # Archiving/retargeting changes who counts toward grades.
    flag_graded_change(db, offering.id, revision(db, assessment.id, "published"),
                       "Assessment audience or status changed.")
    db.commit()


# ---------- publishing ----------

def question_problems(questions):
    problems = []
    if not questions:
        return ["Add at least one question."]
    for n, q in enumerate(questions, start=1):
        label = f"Question {n}: "
        if not q.prompt.strip():
            problems.append(label + "write the question.")
        if Decimal(q.points) <= 0:
            problems.append(label + "points must be above zero.")
        if q.type == "multiple_choice":
            ids = [c["id"] for c in q.choices if c["text"].strip()]
            if len(ids) < 2:
                problems.append(label + "give at least two choices.")
            if q.correct not in ids:
                problems.append(label + "mark exactly one correct choice.")
        elif q.type == "true_false":
            if not isinstance(q.correct, bool):
                problems.append(label + "mark True or False as correct.")
        elif q.type == "short_answer":
            if not [a for a in (q.correct or []) if normalize_text(a)]:
                problems.append(label + "add at least one accepted answer.")
    return problems


def locked_signature(questions):
    """What must not change once students have started attempts."""
    return {q.key: (q.type, Decimal(q.points), tuple(c["id"] for c in q.choices),
                    tuple(sorted(normalize_text(a) for a in q.correct))
                    if q.type == "short_answer" else q.correct) for q in questions}


def violates_lock(db, published, draft, questions):
    return (locked_signature(questions) != locked_signature(questions_of(db, published.id))
            or draft.max_attempts != published.max_attempts
            or draft.score_rule != published.score_rule)


def publish(db, actor, offering, assessment, expected_counter):
    draft = locked_draft(db, assessment, expected_counter)
    published = revision(db, assessment.id, "published")
    questions = questions_of(db, draft.id) if assessment.kind == "online_quiz" else []
    if draft.ai_generated and draft.reviewed_counter != draft.draft_counter:
        fail(409, "review_required", "This quiz was drafted by AI. Read every question and mark the "
                                      "latest version as reviewed before publishing.")
    problems = []
    if not draft.title.strip():
        problems.append("Add a title.")
    if draft.available_from and draft.deadline and draft.deadline < draft.available_from:
        problems.append("The deadline cannot be before the start time.")
    if assessment.kind == "online_quiz":
        problems += question_problems(questions)
    elif assessment.kind in SCORED_BY_FACULTY and Decimal(draft.max_points) <= 0:
        problems.append("Set the maximum points.")
    if draft.include_in_grade:
        policy, _ = published_policy(db, offering.id)
        if not policy:
            fail(422, "policy_missing",
                 "Publish a syllabus with a confirmed grading policy before adding graded work, "
                 "or turn off 'counts toward the grade'.")
        if draft.category_key == "attendance":
            problems.append("Attendance comes from the attendance register, not an assessment. "
                            "Choose another category.")
        elif draft.category_key not in category_keys(policy):
            problems.append("Choose a grading category from your syllabus policy.")
        if draft.period not in period_keys(policy):
            problems.append("Choose the grading period (midterm or finals).")
    if draft.anchor_node_id and draft.anchor_node_id not in outline_ids(
            db, offering, ["published"]):
        fail(409, "anchor_not_published",
             "This assessment is attached to a topic that is not in the published syllabus yet.")
    if problems:
        fail(422, "assessment_incomplete", " ".join(problems))
    if (published and assessment.kind == "online_quiz" and has_attempts(db, assessment.id)
            and violates_lock(db, published, draft, questions)):
        fail(409, "locked_after_attempts",
             "Students have already started attempts, so answer keys, points, attempt limits "
             "and the score rule can no longer change. Wording, instructions and deadlines "
             "can.")
    highest = db.scalar(select(func.max(AssessmentScore.score)).where(
        AssessmentScore.assessment_id == assessment.id))
    if highest is not None and highest > Decimal(draft.max_points):
        fail(422, "score_exceeds_max",
             f"A recorded score ({highest}) is above the new maximum ({draft.max_points}).")
    changed_grading = bool(published and (
        published.max_points != draft.max_points or published.category_key != draft.category_key
        or published.period != draft.period
        or published.include_in_grade != draft.include_in_grade))
    if published:
        published.state = "superseded"
        db.flush()
    draft.state, draft.published_at, draft.published_by = "published", now(), actor.id
    if draft.include_in_grade and (published is None or changed_grading):
        periods = [p for p in {draft.period, published.period if published else None} if p]
        flag_review(db, offering.id, f"{draft.title}: "
                    + ("grading settings changed." if published else "graded work was added."),
                    None, periods or None)
    elif changed_grading:
        flag_graded_change(db, offering.id, published, f"{draft.title}: grading settings changed.")
    audit(db, actor, "assessment.published", "assessment", assessment.id,
          {"version": draft.version})
    db.commit()
    return draft
