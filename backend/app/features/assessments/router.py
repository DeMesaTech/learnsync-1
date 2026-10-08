from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from sqlalchemy.orm import Session

from app.db import get_db
from app.features.teaching.access import learner_offering, record_offering, teaching_offering
from app.features.teaching.schemas import Counter
from app.security import require_role

from . import (
    attempts,
    attendance,
    definitions,
    grading,
    learner,
    planning,
    results,
    scores,
    standing,
    submissions,
)
from .schemas import (
    AnswersSave,
    AssessmentCreate,
    AssessmentDraftSave,
    AssessmentSettings,
    AttemptSubmit,
    AttendanceInput,
    Correction,
    GradePublishInput,
    PermissionInput,
    PlanInput,
    ReleaseInput,
    ScheduleInput,
    ScoreInput,
)

router = APIRouter(prefix="/api", tags=["Assessments"])
faculty = require_role("faculty")
student = require_role("student")


def own(db, offering_id, actor, write=True):
    return teaching_offering(db, offering_id, actor, write)


def assessment_of(db, offering_id, assessment_id, actor, write=True):
    offering = own(db, offering_id, actor, write)
    return offering, definitions.get_assessment(db, offering, assessment_id)


T = "/teach/offerings/{offering_id}"
L = "/learn/offerings/{offering_id}"


# ---------------- faculty: definitions ----------------

@router.post(T + "/assessments/plan", status_code=201)
def plan_assessments(offering_id: UUID, data: PlanInput, actor=Depends(faculty), db: Session = Depends(get_db)):
    """Create many hidden draft assessments at once (skeleton-first setup)."""
    return planning.plan(db, actor, own(db, offering_id, actor), data)


@router.put(T + "/schedule")
def set_schedule(offering_id: UUID, data: ScheduleInput, actor=Depends(faculty), db: Session = Depends(get_db)):
    return planning.set_schedule(db, actor, own(db, offering_id, actor), data.meeting_days)


@router.post(T + "/copy-from/{source_id}", status_code=201)
def copy_subject(offering_id: UUID, source_id: UUID, actor=Depends(faculty), db: Session = Depends(get_db)):
    """Copy one of the teacher's own earlier subjects into this EMPTY one, as drafts only."""
    return planning.copy_from(db, actor, own(db, offering_id, actor), own(db, source_id, actor, write=False))


@router.get(T + "/assessments")
def list_assessments(offering_id: UUID, actor=Depends(faculty), db: Session = Depends(get_db)):
    return definitions.faculty_list(db, own(db, offering_id, actor, write=False))


@router.post(T + "/assessments", status_code=201)
def create_assessment(offering_id: UUID, data: AssessmentCreate, actor=Depends(faculty),
                      db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    return definitions.assessment_view(db, definitions.create(db, actor, offering, data))


@router.get(T + "/assessments/{assessment_id}")
def get_assessment(offering_id: UUID, assessment_id: UUID, actor=Depends(faculty),
                   db: Session = Depends(get_db)):
    _, a = assessment_of(db, offering_id, assessment_id, actor, write=False)
    return definitions.assessment_view(db, a)


@router.post(T + "/assessments/{assessment_id}/draft")
def start_draft(offering_id: UUID, assessment_id: UUID, actor=Depends(faculty),
                db: Session = Depends(get_db)):
    _, a = assessment_of(db, offering_id, assessment_id, actor)
    definitions.start_draft(db, actor, a)
    return definitions.assessment_view(db, a)


@router.put(T + "/assessments/{assessment_id}/draft")
def save_draft(offering_id: UUID, assessment_id: UUID, data: AssessmentDraftSave,
               actor=Depends(faculty), db: Session = Depends(get_db)):
    offering, a = assessment_of(db, offering_id, assessment_id, actor)
    return definitions.save_draft(db, actor, offering, a, data)


@router.post(T + "/assessments/{assessment_id}/draft/review")
def review_draft(offering_id: UUID, assessment_id: UUID, data: Counter, actor=Depends(faculty),
                 db: Session = Depends(get_db)):
    _, a = assessment_of(db, offering_id, assessment_id, actor)
    return definitions.review(db, actor, a, data.expected_counter)


@router.delete(T + "/assessments/{assessment_id}/draft", status_code=204)
def discard_draft(offering_id: UUID, assessment_id: UUID, expected_counter: int,
                  actor=Depends(faculty), db: Session = Depends(get_db)):
    _, a = assessment_of(db, offering_id, assessment_id, actor)
    definitions.discard_draft(db, actor, a, expected_counter)
    return Response(status_code=204)


@router.post(T + "/assessments/{assessment_id}/draft/publish")
def publish(offering_id: UUID, assessment_id: UUID, data: Counter, actor=Depends(faculty),
            db: Session = Depends(get_db)):
    offering, a = assessment_of(db, offering_id, assessment_id, actor)
    definitions.publish(db, actor, offering, a, data.expected_counter)
    return definitions.assessment_view(db, a)


@router.patch(T + "/assessments/{assessment_id}")
def assessment_settings(offering_id: UUID, assessment_id: UUID, data: AssessmentSettings,
                        actor=Depends(faculty), db: Session = Depends(get_db)):
    offering, a = assessment_of(db, offering_id, assessment_id, actor)
    definitions.update_settings(db, actor, offering, a, data)
    return definitions.assessment_view(db, a)


@router.delete(T + "/assessments/{assessment_id}", status_code=204)
def delete_assessment(offering_id: UUID, assessment_id: UUID, actor=Depends(faculty),
                      db: Session = Depends(get_db)):
    _, a = assessment_of(db, offering_id, assessment_id, actor)
    definitions.delete_assessment(db, actor, a)
    return Response(status_code=204)


# ---------------- faculty: quiz attempts and corrections ----------------

@router.get(T + "/assessments/{assessment_id}/attempts")
def list_attempts(offering_id: UUID, assessment_id: UUID, actor=Depends(faculty),
                  db: Session = Depends(get_db)):
    offering, a = assessment_of(db, offering_id, assessment_id, actor, write=False)
    return attempts.faculty_attempts(db, offering, a)


@router.post(T + "/assessments/{assessment_id}/attempts/close-open")
def close_open_attempts(offering_id: UUID, assessment_id: UUID, actor=Depends(faculty),
                        db: Session = Depends(get_db)):
    offering, a = assessment_of(db, offering_id, assessment_id, actor)
    return attempts.close_open(db, actor, offering, a)


@router.get(T + "/assessments/{assessment_id}/attempts/{attempt_id}")
def get_attempt(offering_id: UUID, assessment_id: UUID, attempt_id: UUID,
                actor=Depends(faculty), db: Session = Depends(get_db)):
    _, a = assessment_of(db, offering_id, assessment_id, actor, write=False)
    return attempts.faculty_detail(db, attempts.faculty_attempt(db, a, attempt_id))


@router.put(T + "/assessments/{assessment_id}/attempts/{attempt_id}/answers/{question_key}")
def correct_answer(offering_id: UUID, assessment_id: UUID, attempt_id: UUID, question_key: str,
                   data: Correction, actor=Depends(faculty), db: Session = Depends(get_db)):
    offering, a = assessment_of(db, offering_id, assessment_id, actor)
    return attempts.correct_answer(db, actor, offering, a, attempt_id, question_key, data)


# ---------------- faculty: scores, submissions, releases ----------------

@router.get(T + "/assessments/{assessment_id}/scores")
def list_scores(offering_id: UUID, assessment_id: UUID, actor=Depends(faculty),
                db: Session = Depends(get_db)):
    offering, a = assessment_of(db, offering_id, assessment_id, actor, write=False)
    return submissions.faculty_rows(db, offering, a, scores.targeted_students(db, offering, a))


@router.put(T + "/assessments/{assessment_id}/scores/{student_id}")
def record_score(offering_id: UUID, assessment_id: UUID, student_id: UUID, data: ScoreInput,
                 actor=Depends(faculty), db: Session = Depends(get_db)):
    offering, a = assessment_of(db, offering_id, assessment_id, actor)
    last = submissions.latest(db, a.id, student_id) if a.kind == "activity" else None
    row = scores.set_score(db, actor, offering, a, student_id, data, last.id if last else None)
    return {"score": row.score, "feedback": row.feedback, "revision": row.revision}


@router.post(T + "/assessments/{assessment_id}/release")
def release_results(offering_id: UUID, assessment_id: UUID, data: ReleaseInput,
                    actor=Depends(faculty), db: Session = Depends(get_db)):
    _, a = assessment_of(db, offering_id, assessment_id, actor)
    rev = definitions.revision(db, a.id, "published")
    return {"released": results.release(db, actor, a, rev, data.student_ids)}


@router.post(T + "/assessments/{assessment_id}/permissions", status_code=201)
def grant_permission(offering_id: UUID, assessment_id: UUID, data: PermissionInput,
                     actor=Depends(faculty), db: Session = Depends(get_db)):
    offering, a = assessment_of(db, offering_id, assessment_id, actor)
    row = submissions.grant_permission(db, actor, offering, a, data)
    return {"id": row.id, "expires_at": row.expires_at}


# ---------------- faculty: attendance, gradebook, grade publication ----------------

@router.get(T + "/students/{student_id}/standing")
def student_standing(offering_id: UUID, student_id: UUID, actor=Depends(faculty),
                     db: Session = Depends(get_db)):
    return standing.student_standing(db, own(db, offering_id, actor, write=False), student_id)


@router.get(T + "/attendance")
def list_attendance(offering_id: UUID, section_id: UUID | None = None, actor=Depends(faculty),
                    db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor, write=False)
    return {"sessions": attendance.sessions_view(db, offering, section_id),
            "roster": attendance.roster_view(db, offering, section_id) if section_id else []}


@router.put(T + "/attendance", status_code=204)
def save_attendance(offering_id: UUID, data: AttendanceInput, actor=Depends(faculty),
                    db: Session = Depends(get_db)):
    attendance.save_session(db, actor, own(db, offering_id, actor), data)
    return Response(status_code=204)


@router.delete(T + "/attendance/{session_id}", status_code=204)
def delete_attendance(offering_id: UUID, session_id: UUID, actor=Depends(faculty),
                      db: Session = Depends(get_db)):
    attendance.delete_session(db, actor, own(db, offering_id, actor), session_id)
    return Response(status_code=204)


@router.get(T + "/gradebook")
def get_gradebook(offering_id: UUID, actor=Depends(faculty), db: Session = Depends(get_db)):
    return grading.gradebook(db, own(db, offering_id, actor, write=False))


@router.post(T + "/grades/publish")
def publish_grades(offering_id: UUID, data: GradePublishInput, actor=Depends(faculty),
                   db: Session = Depends(get_db)):
    ids = set(data.student_ids) if data.student_ids is not None else None
    return grading.publish_grades(db, actor, own(db, offering_id, actor), data.period, ids)


# ---------------- student ----------------

@router.get(L + "/assessments")
def learn_assessments(offering_id: UUID, actor=Depends(student), db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(db, offering_id, actor)
    return learner.listing(db, actor, offering, enrollment)


@router.post(L + "/assessments/{assessment_id}/attempts", status_code=201)
def start_attempt(offering_id: UUID, assessment_id: UUID, actor=Depends(student),
                  db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(db, offering_id, actor, write=True)
    a, _ = learner.student_assessment(db, offering, enrollment, assessment_id, "online_quiz")
    return attempts.student_view(db, attempts.start(db, actor, a))


@router.get(L + "/attempts/{attempt_id}")
def get_own_attempt(offering_id: UUID, attempt_id: UUID, actor=Depends(student),
                    db: Session = Depends(get_db)):
    record_offering(db, offering_id, actor)
    return attempts.student_view(db, attempts.own_attempt(db, actor, attempt_id, offering_id))


@router.put(L + "/attempts/{attempt_id}/answers")
def save_answers(offering_id: UUID, attempt_id: UUID, data: AnswersSave,
                 actor=Depends(student), db: Session = Depends(get_db)):
    learner_offering(db, offering_id, actor, write=True)
    return attempts.save_answers(db, actor, offering_id, attempt_id, data.answers)


@router.post(L + "/attempts/{attempt_id}/submit")
def submit_attempt(offering_id: UUID, attempt_id: UUID, data: AttemptSubmit,
                   actor=Depends(student), db: Session = Depends(get_db)):
    learner_offering(db, offering_id, actor, write=True)
    return attempts.submit(db, actor, offering_id, attempt_id, data.idempotency_key, data.answers)


@router.post(L + "/assessments/{assessment_id}/submissions", status_code=201)
def submit_activity(offering_id: UUID, assessment_id: UUID, file: UploadFile = File(...),
                    note: str = Form(""), actor=Depends(student), db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(db, offering_id, actor, write=True)
    a, _ = learner.student_assessment(db, offering, enrollment, assessment_id, "activity")
    return submissions.submission_view(db, submissions.submit(db, actor, a, file, note))


@router.get(L + "/results")
def learn_results(offering_id: UUID, actor=Depends(student), db: Session = Depends(get_db)):
    offering, _ = record_offering(db, offering_id, actor)
    return learner.own_results(db, offering, actor)
