"""Result releases: immutable snapshots of a student's score for one assessment.

The student sees the latest release only. Working scores (faculty-visible) may change at any
time without changing what the student sees until faculty release again."""
from sqlalchemy import func, select

from app.features.accounts.commands import audit

from .models import Assessment, AssessmentScore, ResultPublication


def latest_release(db, assessment_id, student_id):
    return db.scalar(select(ResultPublication).where(
        ResultPublication.assessment_id == assessment_id,
        ResultPublication.student_id == student_id)
        .order_by(ResultPublication.release_number.desc()).limit(1))


def release_one(db, assessment, rev, score_row, actor=None):
    """Release the current working score unless the student already sees exactly this."""
    if score_row is None or score_row.score is None:
        return None
    last = latest_release(db, assessment.id, score_row.student_id)
    if last and last.score == score_row.score and last.feedback == score_row.feedback \
            and last.max_points == rev.max_points:
        return None
    number = (last.release_number if last else 0) + 1
    source = {"kind": assessment.kind, "revision_version": rev.version}
    if score_row.selected_attempt_id:
        source["attempt_id"] = str(score_row.selected_attempt_id)
    if score_row.selected_submission_id:
        source["submission_id"] = str(score_row.selected_submission_id)
    row = ResultPublication(assessment_id=assessment.id, student_id=score_row.student_id,
                            release_number=number, score=score_row.score,
                            max_points=rev.max_points, feedback=score_row.feedback,
                            source=source, published_by=actor.id if actor else None)
    db.add(row)
    db.flush()
    return row


def release(db, actor, assessment, rev, student_ids=None):
    """Faculty release for all (or chosen) students that have a score. Returns released count."""
    query = select(AssessmentScore).where(AssessmentScore.assessment_id == assessment.id,
                                          AssessmentScore.score.is_not(None))
    if student_ids is not None:
        query = query.where(AssessmentScore.student_id.in_(list(student_ids)))
    released = 0
    for row in db.scalars(query):
        if release_one(db, assessment, rev, row, actor):
            released += 1
    audit(db, actor, "results.released", "assessment", assessment.id, {"count": released})
    db.commit()
    return released


def release_count(db, assessment_id):
    return db.scalar(select(func.count()).select_from(ResultPublication)
                     .where(ResultPublication.assessment_id == assessment_id)) or 0


def student_results(db, offering_id, student_id):
    """Latest release per assessment for one student (the only score data students may see)."""
    latest = (select(ResultPublication.assessment_id,
                     func.max(ResultPublication.release_number).label("n"))
              .where(ResultPublication.student_id == student_id)
              .group_by(ResultPublication.assessment_id).subquery())
    rows = db.execute(
        select(ResultPublication, Assessment)
        .join(latest, (latest.c.assessment_id == ResultPublication.assessment_id)
              & (latest.c.n == ResultPublication.release_number))
        .join(Assessment, Assessment.id == ResultPublication.assessment_id)
        .where(ResultPublication.student_id == student_id, Assessment.offering_id == offering_id)
        .order_by(ResultPublication.published_at.desc())).all()
    return rows

