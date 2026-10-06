"""One student's standing in one subject, for the assigned faculty. Read-only and assembled from the
authoritative calculations (gradebook rows, attendance marks, progress steps): nothing is recomputed here,
so this page cannot disagree with the gradebook. No conversation content or question counts, ever."""
from fastapi import HTTPException
from sqlalchemy import select

from app.errors import fail
from app.features.academics.models import Enrollment, Section
from app.features.accounts.models import Account
from app.features.study import progress

from .definitions import revision
from .grading import gradebook, latest_grade_rows
from .models import (
    ActivitySubmission,
    Assessment,
    AssessmentScore,
    AttendanceMark,
    AttendanceSession,
    QuizAttempt,
)
from .results import student_results

ATTENDANCE = ("present", "late", "absent", "excused")


def attendance_view(db, offering, enrollment):
    """The student's section days with their own mark (None = not marked yet). A withdrawn student keeps only
    the days that were actually marked, so later days are not read as absences."""
    marks = {m.session_id: m.status for m in db.scalars(select(AttendanceMark).where(
        AttendanceMark.student_id == enrollment.student_id))}
    days = []
    for s in db.scalars(select(AttendanceSession).where(
            AttendanceSession.offering_id == offering.id,
            AttendanceSession.section_id == enrollment.section_id).order_by(AttendanceSession.session_date)):
        status = marks.get(s.id)
        if enrollment.status == "enrolled" or status:
            days.append({"date": s.session_date, "period": s.period, "status": status})
    counts = {p: {**{k: 0 for k in ATTENDANCE}, "not_marked": 0} for p in ("midterm", "finals")}
    for d in days:
        counts[d["period"]][d["status"] or "not_marked"] += 1
    return {"days": days, "counts": counts}


def attempts_of(db, assessment_id, student_id):
    """The student's attempts at one quiz, oldest first: enough to open each one for review."""
    return [{"id": a.id, "attempt_number": a.attempt_number, "state": a.state, "score": a.score,
             "max_score": a.max_score, "submitted_at": a.submitted_at}
            for a in db.scalars(select(QuizAttempt).where(
                QuizAttempt.assessment_id == assessment_id, QuizAttempt.student_id == student_id)
                .order_by(QuizAttempt.attempt_number))]


def submission_status(db, assessment, cell):
    if assessment.kind == "online_quiz":
        return cell.get("attempt_state", "not_attempted")
    if assessment.kind == "activity":
        latest = db.scalar(select(ActivitySubmission).where(
            ActivitySubmission.assessment_id == assessment.id,
            ActivitySubmission.student_id == cell["student_id"])
            .order_by(ActivitySubmission.version.desc()).limit(1))
        return "not_submitted" if not latest else "submitted_late" if latest.is_late else "submitted"
    return "teacher_entered"


def assessment_rows(db, book, row):
    out = []
    labels = {c["key"]: c["label"] for c in book["policy"]["categories"]}
    for col in book["columns"]:
        cell = row["cells"].get(str(col["id"]))
        if cell is None:                       # does not apply to this student's section
            continue
        a = db.get(Assessment, col["id"])
        rev = revision(db, a.id, "published")
        out.append({
            "id": a.id, "title": col["title"], "kind": col["kind"], "period": col["period"],
            "category": labels.get(col["category_key"], col["category_key"]),
            "max_points": col["max_points"], "counts_toward_grade": col["include_in_grade"],
            "deadline": rev.deadline if rev else None,
            "submission": submission_status(db, a, {**cell, "student_id": row["student_id"]}),
            "scored": cell["score"] is not None, "working_score": cell["score"],
            "feedback": cell["feedback"], "released": cell["release_number"] > 0,
            "released_score": cell["released_score"], "unreleased_change": cell["unreleased_change"],
            "attempts": attempts_of(db, a.id, row["student_id"]) if a.kind == "online_quiz" else []})
    return out


def historical_rows(db, offering, student_id, current_ids):
    """Archived work, or work no longer shown for this student, that still has a score or a release."""
    out, seen = [], set(current_ids)
    released = {a.id: r for r, a in student_results(db, offering.id, student_id)}
    scores = {s.assessment_id: s for s in db.scalars(select(AssessmentScore).where(
        AssessmentScore.student_id == student_id))}
    for a in db.scalars(select(Assessment).where(Assessment.offering_id == offering.id)
                        .order_by(Assessment.created_at)):
        if a.id in seen or (a.id not in released and a.id not in scores):
            continue
        rev = revision(db, a.id, "published") or revision(db, a.id, "superseded")
        score = scores.get(a.id)
        out.append({"id": a.id, "title": rev.title if rev else "Untitled", "kind": a.kind,
                    "archived": a.archived,
                    "working_score": score.score if score else None,
                    "released_score": released[a.id].score if a.id in released else None})
    return out


def student_standing(db, offering, student_id):
    enrollment = db.scalar(select(Enrollment).where(
        Enrollment.offering_id == offering.id, Enrollment.student_id == student_id))
    account = db.get(Account, student_id) if enrollment else None
    if not enrollment or not account:
        fail(404, "not_found", "That student is not in this subject.")
    section = db.get(Section, enrollment.section_id) if enrollment.section_id else None
    out = {"student": {"id": account.id, "name": account.display_name,
                       "student_number": account.student_number,
                       "section": section.name if section else None,
                       "enrollment_status": enrollment.status},
           "calculation": None, "calculation_note": "", "assessments": [], "published": {},
           "attendance": attendance_view(db, offering, enrollment), "progress": None}
    published = latest_grade_rows(db, offering.id)
    out["published"] = {k: {"grade": g.grade, "remark": g.remark, "release_number": g.release_number,
                            "published_at": g.published_at}
                        for (sid, k), g in published.items() if sid == student_id}
    current_ids = []
    if enrollment.status == "enrolled":
        try:
            book = gradebook(db, offering)               # ponytail: whole class computed, one row used
            row = next(r for r in book["rows"] if r["student_id"] == student_id)
        except HTTPException as e:                       # no complete grading policy yet
            out["calculation_note"] = e.detail["message"]
            row = book = None
        if row:
            out["calculation"] = {"policy_version": book["policy_version"], "passing": book["policy"]["passing"],
                                  "grades": row["grades"], "published_flags": row["published"]}
            out["assessments"] = assessment_rows(db, book, row)
            current_ids = [a["id"] for a in out["assessments"]]
        summary = progress.summary(db, offering, enrollment, student_id)
        out["progress"] = {k: summary[k] for k in ("total", "done", "percent", "steps", "outside_count",
                                                   "note", "days", "last_activity_at")}
    else:
        out["calculation_note"] = ("This student withdrew. No working grade is calculated; the published "
                                   "grades and released results below are the record.")
    out["historical"] = historical_rows(db, offering, student_id, current_ids)
    return out
