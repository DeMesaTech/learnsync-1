"""What a student sees: published, targeted work, their own attempts/submissions, and RELEASED
results only. Answer keys, explanations and unreleased scores never appear here."""
from sqlalchemy import select

from app.errors import fail
from app.features.accounts.models import now
from app.features.teaching.access import targeted

from . import submissions
from .attempts import used_attempts
from .definitions import revision, section_ids_of
from .grading import own_published_grades
from .models import Assessment, AssessmentRevision, QuizAttempt
from .results import latest_release, student_results

INTERACTIVE = {"online_quiz", "activity"}


def student_assessment(db, offering, enrollment, assessment_id, kind=None):
    a = db.get(Assessment, assessment_id)
    rev = revision(db, a.id, "published") if a and a.offering_id == offering.id \
        and not a.archived else None
    if not rev or not targeted(section_ids_of(db, a.id), enrollment) \
            or (kind and a.kind != kind) or a.kind not in INTERACTIVE:
        fail(404, "not_found", "Assessment not found.")
    return a, rev


def result_view(db, assessment_id, student_id):
    row = latest_release(db, assessment_id, student_id)
    return {"score": row.score, "max_points": row.max_points, "feedback": row.feedback,
            "released_at": row.published_at} if row else None


def item_view(db, student, enrollment, a, rev):
    at = now()
    out = {"id": a.id, "kind": a.kind, "title": rev.title, "instructions": rev.instructions,
           "available_from": rev.available_from, "deadline": rev.deadline,
           "allow_late": rev.allow_late, "max_points": rev.max_points,
           "anchor_node_id": rev.anchor_node_id, "result": result_view(db, a.id, student.id)}
    if a.kind == "online_quiz":
        used = used_attempts(db, a.id, student.id)
        current = db.scalar(select(QuizAttempt.id).where(
            QuizAttempt.assessment_id == a.id, QuizAttempt.student_id == student.id,
            QuizAttempt.state == "in_progress"))
        closed = bool(rev.deadline and at > rev.deadline and not rev.allow_late)
        not_open = bool(rev.available_from and at < rev.available_from)
        out.update(max_attempts=rev.max_attempts, attempts_used=used,
                   in_progress_attempt_id=current)
        if current and not closed:
            out["state"] = "in_progress"
        elif not_open:
            out["state"] = "not_open"
        elif used >= rev.max_attempts:
            out["state"] = "done"
        elif closed:
            out["state"] = "closed"
        else:
            out["state"] = "available"
    else:
        allowed, late, _, reason = submissions.eligibility(db, rev, a.id, student.id, at)
        subs = submissions.versions(db, a.id, student.id)
        out.update(submissions=[submissions.submission_view(db, s) for s in subs],
                   can_submit=allowed, would_be_late=late)
        out["state"] = ("not_open" if reason == "not_open" else "submitted"
                        if subs and not allowed else "closed" if not allowed
                        else "resubmit" if subs else "available")
    out["bucket"] = bucket_of(out)
    out["late_allowed"] = bool(rev.allow_late and rev.deadline and at > rev.deadline
                               and out["bucket"] in ("todo", "again"))
    return out


BUCKETS = ("todo", "again", "upcoming", "awaiting", "done", "closed")   # the order My work shows them


def bucket_of(w):
    """Where a piece of work belongs for the student. The one rule behind My work and the dashboard."""
    state = w["state"]
    if state == "not_open":
        return "upcoming"
    if w["kind"] == "online_quiz":
        if state == "in_progress":
            return "todo"
        if state == "done":
            return "done"
        if state == "closed":
            return "done" if w["attempts_used"] else "closed"
        return "again" if w["attempts_used"] else "todo"          # available
    if state in ("submitted", "resubmit"):                        # a handed-in activity stays submitted
        return "done" if w["result"] else "awaiting"              # until feedback is released: never a zero
    return "closed" if state == "closed" else "todo"


def sort_key(w):
    """To do: earliest deadline first, none last. Upcoming: soonest opening first."""
    when = w["available_from"] if w["bucket"] == "upcoming" else w["deadline"]
    return BUCKETS.index(w["bucket"]), when is None, when or now()


def listing(db, student, offering, enrollment):
    rows = db.scalars(select(Assessment).where(
        Assessment.offering_id == offering.id, Assessment.archived.is_(False),
        Assessment.kind.in_(INTERACTIVE)).order_by(Assessment.created_at)).all()
    out = []
    for a in rows:
        rev = revision(db, a.id, "published")
        if rev and targeted(section_ids_of(db, a.id), enrollment):
            out.append(item_view(db, student, enrollment, a, rev))
    return sorted(out, key=sort_key)


def own_results(db, offering, student):
    """Released results (latest release each) and published grades for the student's own record."""
    results = []
    for release, a in student_results(db, offering.id, student.id):
        rev = db.scalar(select(AssessmentRevision).where(
            AssessmentRevision.assessment_id == a.id, AssessmentRevision.state != "draft")
            .order_by(AssessmentRevision.version.desc()).limit(1))
        results.append({"assessment_id": a.id, "kind": a.kind, "title": rev.title if rev else "",
                        "score": release.score, "max_points": release.max_points,
                        "feedback": release.feedback, "released_at": release.published_at,
                        "release_number": release.release_number})
    return {"results": results, "grades": own_published_grades(db, offering.id, student.id)}
