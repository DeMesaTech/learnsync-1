"""Working data changed after a grade was published: flag it for faculty review.

The last published grade is never touched; the flag only tells faculty a republication is due."""
from sqlalchemy import select

from app.features.accounts.models import now

from .models import GradePublication, GradeReviewState


def flag_review(db, offering_id, reason, student_ids=None, periods=None):
    """Flag every (student, period) that already has a published grade.

    `periods` limits the periods touched (course grades are always flagged along with them)."""
    query = select(GradePublication.student_id, GradePublication.period).where(
        GradePublication.offering_id == offering_id).distinct()
    if student_ids is not None:
        query = query.where(GradePublication.student_id.in_(list(student_ids)))
    wanted = None if periods is None else set(periods) | {"course"}
    for student_id, period in db.execute(query).all():
        if wanted is not None and period not in wanted:
            continue
        state = db.scalar(select(GradeReviewState).where(
            GradeReviewState.offering_id == offering_id,
            GradeReviewState.student_id == student_id, GradeReviewState.period == period))
        if state:
            state.needs_review, state.reason, state.changed_at = True, reason, now()
        else:
            db.add(GradeReviewState(offering_id=offering_id, student_id=student_id,
                                    period=period, needs_review=True, reason=reason))


def flag_graded_change(db, offering_id, rev, reason, student_ids=None):
    """Flag published grades for a change to GRADED work, in that work's period only.

    Practice work (not counted toward the grade) changes nothing a published grade used."""
    if rev is None or not rev.include_in_grade:
        return
    flag_review(db, offering_id, reason, student_ids, [rev.period] if rev.period else None)
