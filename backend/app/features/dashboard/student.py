"""The student's home page. Everything is assembled offering by offering through the same functions the
subject pages use, so enrolment, section targeting, published-only content and result release all apply;
an aggregate never reads across those rules. Only the student's own valid learning events are counted."""
from datetime import timedelta

from sqlalchemy import select

from app.features.academics.models import AcademicTerm, Enrollment, Offering, Subject
from app.features.accounts.models import now
from app.features.assessments import learner
from app.features.assessments.definitions import revision
from app.features.assessments.grading import own_published_grades
from app.features.assessments.results import student_results
from app.features.study import progress
from app.features.study.models import LearningEvent
from app.features.teaching import announcements
from app.features.teaching.items import student_items

UPDATE_DAYS = 30
MAX_UPDATES = 8
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def current_enrollments(db, student):
    """Enrolled students only, in terms that are still open: the only place new work can come from."""
    return db.execute(
        select(Enrollment, Offering, Subject).join(Offering, Offering.id == Enrollment.offering_id)
        .join(Subject, Subject.id == Offering.subject_id)
        .join(AcademicTerm, AcademicTerm.id == Offering.term_id)
        .where(Enrollment.student_id == student.id, Enrollment.status == "enrolled",
               AcademicTerm.status == "open").order_by(Subject.code)).all()


def week_strip(db, student):
    """Monday to Sunday of the current week in school time: counts of VALID events, nothing else."""
    today = progress.local(now()).date()
    monday = today - timedelta(days=today.weekday())
    counts = {monday + timedelta(days=n): {"lessons": 0, "work": 0} for n in range(7)}
    for event_type, at in db.execute(select(LearningEvent.event_type, LearningEvent.occurred_at).where(
            LearningEvent.student_id == student.id, LearningEvent.occurred_at >= now() - timedelta(days=8))):
        day = progress.local(at).date()
        if day in counts:
            counts[day]["lessons" if event_type == "lesson_completed" else "work"] += 1
    days = [{"label": WEEKDAYS[i], "date": d.isoformat(), "count": c["lessons"] + c["work"],
             "today": d == today, "future": d > today} for i, (d, c) in enumerate(counts.items())]
    return {"days": days, "lessons_today": counts[today]["lessons"], "work_today": counts[today]["work"]}


def work_buckets(db, student, offering, enrollment, subject):
    """(to do, awaiting feedback, another attempt) for one offering, from the learner's own view of it."""
    todo, waiting, again = [], [], []
    for w in learner.listing(db, student, offering, enrollment):
        base = {"offering_id": offering.id, "assessment_id": w["id"], "kind": w["kind"], "title": w["title"],
                "subject": subject.code, "deadline": w["deadline"], "available_from": w["available_from"],
                "late_allowed": w["late_allowed"]}
        bucket = w["bucket"]
        if bucket == "again":
            again.append({**base, "attempts_left": w["max_attempts"] - w["attempts_used"]})
        elif bucket in ("todo", "upcoming"):
            todo.append({**base, "state": w["state"]})
        elif bucket == "awaiting":
            waiting.append(base)
    return todo, waiting, again


def updates_for(db, student, offering, enrollment, subject):
    since = now() - timedelta(days=UPDATE_DAYS)
    out = []
    for a in announcements.student_list(db, offering, enrollment):
        if a["published_at"] and a["published_at"] >= since:
            out.append({"type": "announcement", "title": a["title"], "subject": subject.code,
                        "at": a["published_at"], "link": f"/student/offerings/{offering.id}/announcements"})
    for i in student_items(db, offering, enrollment):
        if i["published_at"] and i["published_at"] >= since:
            out.append({"type": "material", "title": i["title"], "subject": subject.code, "at": i["published_at"],
                        "link": f"/student/offerings/{offering.id}/lessons" + (f"/{i['id']}" if i["kind"] != "file" else "")})
    for release, assessment in student_results(db, offering.id, student.id):
        rev = revision(db, assessment.id, "published")
        if release.published_at >= since and rev and not assessment.archived:
            out.append({"type": "result", "title": f"Result released: {rev.title}", "subject": subject.code,
                        "at": release.published_at, "link": f"/student/offerings/{offering.id}/results"})
    for g in own_published_grades(db, offering.id, student.id):
        if g["published_at"] >= since:
            out.append({"type": "grade", "title": f"{g['period'].capitalize()} grade published", "subject": subject.code,
                        "at": g["published_at"], "link": f"/student/offerings/{offering.id}/results"})
    return out


def sort_todo(todo):
    """Available work first, earliest deadline first (none last); work that is not open yet follows, soonest opening first."""
    def key(x):
        if x["state"] == "not_open":
            return 1, x["available_from"] is None, x["available_from"] or 0, str(x["assessment_id"])
        return 0, x["deadline"] is None, x["deadline"] or 0, str(x["assessment_id"])
    return sorted(todo, key=key)


def student_todo(db, student):
    """Every open item across the student's current subjects (the dashboard only shows the first few)."""
    todo, waiting, again = [], [], []
    for enrollment, offering, subject in current_enrollments(db, student):
        t, w, a = work_buckets(db, student, offering, enrollment, subject)
        todo += t
        waiting += w
        again += a
    return {"todo": sort_todo(todo), "awaiting_feedback": waiting, "another_attempt": again}


def student_dashboard(db, student):
    subjects, todo, waiting, again, updates = [], [], [], [], []
    next_lesson = None
    for enrollment, offering, subject in current_enrollments(db, student):
        summary = progress.summary(db, offering, enrollment, student.id)
        t, w, a = work_buckets(db, student, offering, enrollment, subject)
        todo += t
        waiting += w
        again += a
        updates += updates_for(db, student, offering, enrollment, subject)
        lesson = next((s for s in summary["steps"] if s["type"] == "lesson_completed" and not s["done"]), None)
        if lesson and next_lesson is None:
            next_lesson = {"type": "lesson", "offering_id": offering.id, "item_id": lesson["id"], "title": lesson["title"],
                           "subject": f"{subject.code} · {subject.title}",
                           "link": f"/student/offerings/{offering.id}/lessons/{lesson['id']}"}
        subjects.append({"offering_id": offering.id, "code": subject.code, "title": subject.title,
                         "percent": summary["percent"], "done": summary["done"], "total": summary["total"],
                         "to_do": len(t)})
    todo = sort_todo(todo)
    updates.sort(key=lambda x: x["at"], reverse=True)
    available = [t for t in todo if t["state"] != "not_open"]      # something that opens later is not a next step
    if next_lesson is None and available:
        first = available[0]
        next_lesson = {"type": "work", "offering_id": first["offering_id"], "title": first["title"], "subject": first["subject"],
                       "link": f"/student/offerings/{first['offering_id']}/work/{first['assessment_id']}"}
    return {"name": student.display_name, "subjects": subjects, "week": week_strip(db, student),
            "next_step": next_lesson, "todo": todo[:10], "todo_total": len(todo), "awaiting_feedback": waiting[:6],
            "another_attempt": again[:6], "updates": updates[:MAX_UPDATES]}
