"""The teacher home page: counts and shortcuts for the teacher's OWN offerings only. Nothing from other
teachers, and no student conversations (those are private to the student)."""
from datetime import timedelta

from sqlalchemy import func, select

from app.features.academics.models import AcademicTerm, Offering, Subject
from app.features.academics.queries import offering_summary
from app.features.accounts.models import now
from app.features.assessments import submissions
from app.features.assessments.definitions import revision
from app.features.assessments.models import Assessment, AssessmentRevision, GradeReviewState
from app.features.assessments.scores import targeted_students
from app.features.study import progress
from app.features.teaching.models import LearningItem, LearningItemRevision

DEADLINE_DAYS = 14


def offering_card(db, offering, summary):
    drafts_content = db.scalar(select(func.count()).select_from(LearningItemRevision)
                               .join(LearningItem, LearningItem.id == LearningItemRevision.item_id)
                               .where(LearningItem.offering_id == offering.id, LearningItem.archived.is_(False),
                                      LearningItemRevision.state == "draft")) or 0
    drafts_assessments = db.scalar(select(func.count()).select_from(AssessmentRevision)
                                   .join(Assessment, Assessment.id == AssessmentRevision.assessment_id)
                                   .where(Assessment.offering_id == offering.id, Assessment.archived.is_(False),
                                          AssessmentRevision.state == "draft")) or 0
    review = db.scalar(select(func.count(func.distinct(GradeReviewState.student_id))).where(
        GradeReviewState.offering_id == offering.id, GradeReviewState.needs_review.is_(True))) or 0
    to_grade, first_to_grade, deadlines = 0, None, []
    for a in db.scalars(select(Assessment).where(Assessment.offering_id == offering.id,
                                                 Assessment.archived.is_(False)).order_by(Assessment.created_at)):
        rev = revision(db, a.id, "published")
        if not rev:
            continue
        link = (f"/faculty/offerings/{offering.id}/assessments/{a.id}/scores"
                if a.kind in ("activity", "online_quiz") else f"/faculty/offerings/{offering.id}/assessments")
        if rev.deadline and now() <= rev.deadline <= now() + timedelta(days=DEADLINE_DAYS):
            deadlines.append({"title": rev.title, "deadline": rev.deadline,
                              "subject": summary["subject"]["code"], "link": link})
        if a.kind == "activity":
            waiting = [r for r in submissions.faculty_rows(db, offering, a, targeted_students(db, offering, a))
                       if r["latest"] and not r["graded_current_version"]]
            to_grade += len(waiting)
            if waiting and first_to_grade is None:
                first_to_grade = {"title": rev.title, "link": link}
    prog = progress.faculty_progress(db, offering)
    return {"offering_id": offering.id, "code": summary["subject"]["code"], "title": summary["subject"]["title"],
            "sections": [s["name"] for s in summary["sections"]], "students": summary["enrolled"],
            "term": summary["term"], "drafts_content": drafts_content, "drafts_assessments": drafts_assessments,
            "to_grade": to_grade, "needs_review": review, "average_progress": prog["average_percent"],
            "quiet_students": prog["inactive_count"], "first_to_grade": first_to_grade, "deadlines": deadlines}


def next_task(cards):
    for c in cards:
        if c["to_grade"] and c["first_to_grade"]:
            total = sum(x["to_grade"] for x in cards)
            return {"headline": f"{total} submission{'s' if total != 1 else ''} ready to grade",
                    "detail": f"{c['first_to_grade']['title']} · {c['code']}", "action": "Review submissions",
                    "link": c["first_to_grade"]["link"]}
    for c in cards:
        if c["needs_review"]:
            return {"headline": f"{c['needs_review']} published grade{'s' if c['needs_review'] != 1 else ''} need your review",
                    "detail": f"{c['code']} · working data changed after publication", "action": "Open the gradebook",
                    "link": f"/faculty/offerings/{c['offering_id']}/gradebook"}
    for c in cards:
        drafts = c["drafts_content"] + c["drafts_assessments"]
        if drafts:
            return {"headline": f"{drafts} unpublished draft{'s' if drafts != 1 else ''} in progress",
                    "detail": f"{c['code']} · students cannot see drafts yet", "action": "Continue editing",
                    "link": f"/faculty/offerings/{c['offering_id']}/" + ("content" if c["drafts_content"] else "assessments")}
    return None


def faculty_dashboard(db, teacher):
    rows = db.execute(select(Offering).join(AcademicTerm, AcademicTerm.id == Offering.term_id)
                      .join(Subject, Subject.id == Offering.subject_id)
                      .where(Offering.faculty_id == teacher.id, AcademicTerm.status == "open")
                      .order_by(Subject.code)).scalars().all()
    summaries = {s["id"]: s for s in offering_summary(db, rows)}
    cards = [offering_card(db, o, summaries[o.id]) for o in rows]
    closed = db.scalar(select(func.count()).select_from(Offering).join(AcademicTerm, AcademicTerm.id == Offering.term_id)
                       .where(Offering.faculty_id == teacher.id, AcademicTerm.status == "closed")) or 0
    deadlines = sorted((d for c in cards for d in c["deadlines"]), key=lambda d: d["deadline"])[:6]
    return {"name": teacher.display_name, "subjects": cards, "closed_subjects": closed, "task": next_task(cards),
            "deadlines": deadlines,
            "totals": {"subjects": len(cards), "students": sum(c["students"] for c in cards),
                       "to_grade": sum(c["to_grade"] for c in cards),
                       "needs_review": sum(c["needs_review"] for c in cards),
                       "drafts": sum(c["drafts_content"] + c["drafts_assessments"] for c in cards)}}
