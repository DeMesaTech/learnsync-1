"""Progress: only deliberate learning actions count.

Valid events: a lesson the student marked complete, a quiz attempt the STUDENT submitted, and an
activity version the student uploaded. Views, downloads, AI chat, typed scores and release actions
never count. Events are unique per (student, type, ref), so retries cannot inflate anything, and
days/weeks are bucketed in the school's time zone (weeks start on Monday)."""
import uuid
from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.config import settings
from app.errors import fail
from app.features.academics.models import Enrollment
from app.features.accounts.models import Account, now
from app.features.assessments.definitions import revision as assessment_revision
from app.features.assessments.definitions import section_ids_of as assessment_sections
from app.features.assessments.models import Assessment
from app.features.teaching.access import learner_offering, targeted
from app.features.teaching.items import SEQUENCE_KINDS, get_item, ordered_published, student_item
from app.features.teaching.items import revision as item_revision

from .events import record_event
from .models import LearningEvent, LessonCompletion

DAYS, WEEKS = 14, 8
TYPES = ("lesson_completed", "quiz_submitted", "activity_submitted")


def complete_lesson(db, student, offering_id, item_id):
    offering, enrollment = learner_offering(db, offering_id, student, write=True)
    view = student_item(db, offering, enrollment, item_id)      # published, targeted, not archived
    if view["kind"] not in SEQUENCE_KINDS:
        fail(422, "not_completable", "This cannot be marked complete.")
    item = get_item(db, offering, item_id)
    version = item_revision(db, item.id, "published").version
    db.execute(insert(LessonCompletion).values(
        id=uuid.uuid4(), student_id=student.id, item_id=item.id, revision_version=version,
        completed_at=now()).on_conflict_do_nothing(constraint="completion_unique"))
    record_event(db, student.id, offering.id, "lesson_completed", item.id, item.id)
    db.commit()
    return {"item_id": item.id, "completed": True}


def applicable_steps(db, offering, enrollment):
    """Published, targeted, non-archived lessons, files and links, online quizzes and activities."""
    steps = [{"id": item.id, "type": "lesson_completed", "title": rev.title, "kind": item.kind}
             for item, rev, _ in ordered_published(db, offering, enrollment) if item.kind in SEQUENCE_KINDS]
    for a in db.scalars(select(Assessment).where(
            Assessment.offering_id == offering.id, Assessment.archived.is_(False),
            Assessment.kind.in_(("online_quiz", "activity"))).order_by(Assessment.created_at)):
        rev = assessment_revision(db, a.id, "published")
        if rev and targeted(assessment_sections(db, a.id), enrollment):
            steps.append({"id": a.id, "type": "quiz_submitted" if a.kind == "online_quiz"
                          else "activity_submitted", "title": rev.title})
    return steps


def local(at):
    return at.astimezone(ZoneInfo(settings().app_timezone))


def buckets(events, today):
    """Zero-filled per-day (last 14 days) and per-week (last 8 Monday-based weeks) counts."""
    day_counts = {today - timedelta(days=n): 0 for n in range(DAYS - 1, -1, -1)}
    monday = today - timedelta(days=today.weekday())
    week_counts = {monday - timedelta(weeks=n): 0 for n in range(WEEKS - 1, -1, -1)}
    for at in events:
        d = local(at).date()
        if d in day_counts:
            day_counts[d] += 1
        w = d - timedelta(days=d.weekday())
        if w in week_counts:
            week_counts[w] += 1
    return ([{"date": d.isoformat(), "count": n} for d, n in day_counts.items()],
            [{"week_start": d.isoformat(), "count": n} for d, n in week_counts.items()])


def summary(db, offering, enrollment, student_id):
    steps = applicable_steps(db, offering, enrollment)
    events = db.execute(select(LearningEvent.event_type, LearningEvent.resource_id,
                               LearningEvent.occurred_at).where(
        LearningEvent.student_id == student_id,
        LearningEvent.offering_id == offering.id)).all()
    done = {(t, r) for t, r, _ in events}
    for step in steps:
        step["done"] = (step["type"], step["id"]) in done
    finished = sum(s["done"] for s in steps)
    # Completed work whose step no longer applies (archived, unpublished or retargeted) is kept
    # as history but is not part of the percentage; say so instead of letting it look like a drop.
    shown = {(s["type"], s["id"]) for s in steps}
    outside = len({key for key in done if key not in shown})
    note = (f"{outside} completed step{'s' if outside != 1 else ''} no longer count because the "
            "material was archived, unpublished or no longer applies to you.") if outside else ""
    days, weeks = buckets([at for _, _, at in events], local(now()).date())
    last = max((at for _, _, at in events), default=None)
    return {"total": len(steps), "done": finished,
            "percent": round(100 * finished / len(steps)) if steps else None,
            "steps": steps, "outside_count": outside, "note": note,
            "days": days, "weeks": weeks, "last_activity_at": last,
            "events_total": len(events)}


def student_progress(db, student, offering_id):
    offering, enrollment = learner_offering(db, offering_id, student)
    return summary(db, offering, enrollment, student.id)


def faculty_progress(db, offering):
    """Counts only. Chats, answers and scores are not part of this view."""
    rows = db.execute(select(Enrollment, Account).join(Account, Account.id == Enrollment.student_id)
                      .where(Enrollment.offering_id == offering.id, Enrollment.status == "enrolled")
                      .order_by(Account.display_name)).all()
    since = now() - timedelta(days=7)
    out = []
    for enrollment, account in rows:
        s = summary(db, offering, enrollment, account.id)
        recent = sum(1 for d in s["days"][-7:] for _ in range(d["count"]))
        out.append({"student_id": account.id, "student": account.display_name,
                    "student_number": account.student_number, "total": s["total"],
                    "done": s["done"], "percent": s["percent"], "last_activity_at":
                    s["last_activity_at"], "recent_events": recent,
                    "inactive": s["last_activity_at"] is None or s["last_activity_at"] < since})
    done = [r["percent"] for r in out if r["percent"] is not None]
    return {"students": out, "average_percent": round(sum(done) / len(done)) if done else None,
            "inactive_count": sum(r["inactive"] for r in out)}
