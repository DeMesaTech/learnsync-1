"""Activity submissions: each upload is a kept version; grading points at a specific version.

Before the deadline a student may replace their work freely. After it, only a faculty-granted
permission (or the activity's late policy, for a FIRST submission) allows another upload. A new
version never changes a released result."""
from sqlalchemy import func, select

from app.errors import fail
from app.features.accounts.commands import audit
from app.features.accounts.models import now
from app.features.files.models import StoredFile
from app.features.files.storage import save_upload
from app.features.study.events import record_event

from .attempts import student_lock
from .definitions import revision
from .models import ActivitySubmission, AssessmentScore, SubmissionPermission
from .scores import enrolled_student_ids

SUBMISSION_TYPES = {".pdf"}


def versions(db, assessment_id, student_id):
    return db.scalars(select(ActivitySubmission).where(
        ActivitySubmission.assessment_id == assessment_id,
        ActivitySubmission.student_id == student_id)
        .order_by(ActivitySubmission.version)).all()


def latest(db, assessment_id, student_id):
    return db.scalar(select(ActivitySubmission).where(
        ActivitySubmission.assessment_id == assessment_id,
        ActivitySubmission.student_id == student_id)
        .order_by(ActivitySubmission.version.desc()).limit(1))


def open_permission(db, assessment_id, student_id, at):
    return db.scalar(select(SubmissionPermission).where(
        SubmissionPermission.assessment_id == assessment_id,
        SubmissionPermission.student_id == student_id,
        SubmissionPermission.consumed_at.is_(None), SubmissionPermission.expires_at > at)
        .order_by(SubmissionPermission.created_at).limit(1))


def submission_view(db, s):
    file = db.get(StoredFile, s.file_id)
    return {"version": s.version, "submitted_at": s.submitted_at, "is_late": s.is_late,
            "note": s.note, "file": {"id": file.id, "name": file.original_name,
                                     "size": file.size}}


def eligibility(db, rev, assessment_id, student_id, at):
    """(allowed, is_late, permission, reason) for the next upload."""
    if rev.available_from and at < rev.available_from:
        return False, False, None, "not_open"
    if not rev.deadline or at <= rev.deadline:
        return True, False, None, None
    permission = open_permission(db, assessment_id, student_id, at)
    if permission:
        return True, True, permission, None
    if rev.allow_late and latest(db, assessment_id, student_id) is None:
        return True, True, None, None
    return False, False, None, "closed"


def submit(db, student, assessment, upload, note):
    rev = revision(db, assessment.id, "published")
    student_lock(db, assessment.id, student.id)
    at = now()
    allowed, late, permission, reason = eligibility(db, rev, assessment.id, student.id, at)
    if not allowed:
        if reason == "not_open":
            fail(409, "not_open", "This activity has not opened yet.")
        fail(409, "closed", "The deadline has passed. Ask your teacher if you need to submit.")
    file = save_upload(db, upload, "submission", student, SUBMISSION_TYPES)
    number = (db.scalar(select(func.max(ActivitySubmission.version)).where(
        ActivitySubmission.assessment_id == assessment.id,
        ActivitySubmission.student_id == student.id)) or 0) + 1
    row = ActivitySubmission(assessment_id=assessment.id, revision_id=rev.id,
                             student_id=student.id, version=number, file_id=file.id,
                             note=note[:2000], is_late=late)
    db.add(row)
    db.flush()
    record_event(db, student.id, assessment.offering_id, "activity_submitted", assessment.id, row.id)
    if permission:
        permission.consumed_at = at
    db.commit()
    return row


def grant_permission(db, actor, offering, assessment, data):
    if data.student_id not in enrolled_student_ids(db, offering.id):
        fail(422, "student_invalid", "Choose a student who is currently enrolled.")
    if data.expires_at <= now():
        fail(422, "expiry_past", "The permission must expire in the future.")
    row = SubmissionPermission(assessment_id=assessment.id, student_id=data.student_id,
                               reason=data.reason, expires_at=data.expires_at,
                               granted_by=actor.id)
    db.add(row)
    audit(db, actor, "submission.permission_granted", "assessment", assessment.id,
          {"student_id": str(data.student_id), "reason": data.reason})
    db.commit()
    return row


def faculty_rows(db, offering, assessment, enrollments):
    """One row per enrolled, targeted student with their latest version and grading state."""
    scores = {s.student_id: s for s in db.scalars(select(AssessmentScore).where(
        AssessmentScore.assessment_id == assessment.id))}
    out = []
    for enrollment, account in enrollments:
        subs = versions(db, assessment.id, account.id)
        last = subs[-1] if subs else None
        score = scores.get(account.id)
        out.append({
            "student_id": account.id, "student": account.display_name,
            "student_number": account.student_number, "versions": len(subs),
            "latest": submission_view(db, last) if last else None,
            "score": score.score if score else None,
            "feedback": score.feedback if score else "",
            "score_revision": score.revision if score else 0,
            "graded_current_version": bool(score and score.score is not None
                                           and last and score.selected_submission_id == last.id),
            "new_version_since_grading": bool(score and score.score is not None and last
                                              and score.selected_submission_id != last.id),
            "permission_open": open_permission(db, assessment.id, account.id, now()) is not None})
    return out
