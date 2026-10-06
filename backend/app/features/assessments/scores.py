"""Working scores. Missing (no row / NULL) means pending; an explicit 0 is a real score."""
from decimal import Decimal

from sqlalchemy import select

from app.errors import fail
from app.features.academics.models import Enrollment
from app.features.accounts.commands import audit
from app.features.accounts.models import Account
from app.features.teaching.access import targeted

from .definitions import revision, section_ids_of
from .models import AssessmentScore, QuizAttempt
from .reviews import flag_graded_change


def score_row(db, assessment_id, student_id, create=False):
    row = db.scalar(select(AssessmentScore).where(
        AssessmentScore.assessment_id == assessment_id,
        AssessmentScore.student_id == student_id).with_for_update())
    if row or not create:
        return row
    row = AssessmentScore(assessment_id=assessment_id, student_id=student_id)
    db.add(row)
    db.flush()
    return row


def enrolled_student_ids(db, offering_id):
    return set(db.scalars(select(Enrollment.student_id).where(
        Enrollment.offering_id == offering_id, Enrollment.status == "enrolled")))


def set_score(db, actor, offering, assessment, student_id, data, submission_id=None):
    """Faculty entry for offline quizzes, exams, manual assessments and graded activities."""
    rev = revision(db, assessment.id, "published")
    if not rev:
        fail(409, "not_published", "Publish the assessment before recording scores.")
    if student_id not in {a.id for _, a in targeted_students(db, offering, assessment)}:
        fail(422, "student_invalid", "Choose a currently enrolled student this assessment "
                                     "applies to.")
    if assessment.kind == "online_quiz":
        # Scores come from attempts. Faculty may only record one for a student who never
        # attempted (a no-show); an open attempt must be closed first, a submitted one corrected.
        states = set(db.scalars(select(QuizAttempt.state).where(
            QuizAttempt.assessment_id == assessment.id, QuizAttempt.student_id == student_id)))
        if "submitted" in states:
            fail(422, "use_correction", "This student has a submitted attempt; correct an answer "
                                        "instead.")
        if "in_progress" in states:
            fail(409, "attempt_open", "This student has an open attempt. Close open attempts "
                                      "first.")
    if data.score is not None and Decimal(data.score) > Decimal(rev.max_points):
        fail(422, "score_exceeds_max", f"The score cannot be above {rev.max_points}.")
    row = score_row(db, assessment.id, student_id, create=True)
    if data.expected_revision is not None and data.expected_revision != row.revision:
        fail(409, "score_conflict", "This score was changed by someone else. Reload and retry.")
    changed = row.score != data.score or row.feedback != data.feedback
    row.score, row.feedback, row.graded_by = data.score, data.feedback, actor.id
    if submission_id:
        row.selected_submission_id = submission_id
    if changed:
        row.revision += 1
        audit(db, actor, "score.recorded", "assessment", assessment.id,
              {"student_id": str(student_id), "score": None if data.score is None
               else str(data.score)})
        flag_graded_change(db, offering.id, rev, f"{rev.title}: a score changed.", [student_id])
    db.commit()
    return row


def select_attempt(db, assessment, rev, student_id):
    """Apply the score rule (highest or latest) across the student's submitted attempts."""
    attempts = db.scalars(select(QuizAttempt).where(
        QuizAttempt.assessment_id == assessment.id, QuizAttempt.student_id == student_id,
        QuizAttempt.state == "submitted").order_by(QuizAttempt.attempt_number)).all()
    if not attempts:
        return None
    if rev.score_rule == "latest":
        return attempts[-1]
    return max(attempts, key=lambda a: (a.score or Decimal(0), a.attempt_number))


def sync_quiz_score(db, assessment, rev, student_id):
    """Recompute the working score of an online quiz from its attempts."""
    chosen = select_attempt(db, assessment, rev, student_id)
    row = score_row(db, assessment.id, student_id, create=True)
    if chosen:
        row.score, row.selected_attempt_id = chosen.score, chosen.id
        row.revision += 1
    return row


def targeted_students(db, offering, assessment):
    """(enrollment, account) for currently enrolled students this assessment applies to."""
    sections = section_ids_of(db, assessment.id)
    rows = db.execute(select(Enrollment, Account).join(Account, Account.id == Enrollment.student_id)
                      .where(Enrollment.offering_id == offering.id, Enrollment.status == "enrolled")
                      .order_by(Account.display_name)).all()
    return [(e, a) for e, a in rows if targeted(sections, e)]
