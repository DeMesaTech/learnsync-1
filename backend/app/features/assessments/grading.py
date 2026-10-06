"""Grade calculation and publication.

category percentage = earned / possible * 100          (optionally 50 + raw / 2)
period grade        = sum(category percentage * weight / 100)   (unrounded values, 2-dp result)
course grade        = sum(rounded period grade * period share / 100)

Missing required scores are PENDING, never zero; an explicitly recorded zero counts. Zero-weight
categories never block a grade. Working data may change freely: published grades are immutable
snapshots, and anything that changes working data flags them for review instead."""
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select, text

from app.errors import fail
from app.features.academics.models import Enrollment, Section
from app.features.accounts.commands import audit
from app.features.accounts.models import Account, now
from app.features.teaching.access import targeted

from .definitions import revision
from .models import (
    Assessment,
    AssessmentScore,
    AssessmentSection,
    AttendanceMark,
    AttendanceSession,
    GradePublication,
    GradeReviewState,
    QuizAttempt,
    ResultPublication,
)
from .policy import require_policy

CENT = Decimal("0.01")
PERIODS = ("midterm", "finals")


def D(value):
    return Decimal(str(value))


def jsonable(value):
    """Plain JSON for snapshots: decimals and ids become strings, dates become ISO text."""
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, Decimal) or hasattr(value, "hex"):          # Decimal / UUID
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def r2(value):
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def complete_policy(db, offering_id):
    policy, version = require_policy(db, offering_id)
    weights = sum(D(c["weight"]) for c in policy["categories"])
    periods = policy.get("periods", [])
    shares = sum(D(p["share"]) for p in periods)
    if abs(weights - 100) > CENT or not periods or abs(shares - 100) > CENT:
        fail(422, "policy_incomplete",
             "The grading policy must have category weights and period shares that each total "
             "100%. Fix it in the syllabus and publish it.")
    return policy, version


class Context:
    """Everything needed to grade one offering, loaded once."""

    def __init__(self, db, offering):
        self.policy, self.version = complete_policy(db, offering.id)
        self.enrollments = db.execute(
            select(Enrollment, Account).join(Account, Account.id == Enrollment.student_id)
            .where(Enrollment.offering_id == offering.id, Enrollment.status == "enrolled")
            .order_by(Account.display_name)).all()
        self.assessments = []
        for a in db.scalars(select(Assessment).where(Assessment.offering_id == offering.id,
                                                     Assessment.archived.is_(False))
                            .order_by(Assessment.created_at)):
            rev = revision(db, a.id, "published")
            if rev:
                sections = set(db.scalars(select(AssessmentSection.section_id)
                                          .where(AssessmentSection.assessment_id == a.id)))
                self.assessments.append((a, rev, sections))
        self.scores = {(s.assessment_id, s.student_id): s for s in db.scalars(
            select(AssessmentScore).join(Assessment, Assessment.id == AssessmentScore.assessment_id)
            .where(Assessment.offering_id == offering.id))}
        self.attempt_states = {}
        for aid, sid, state in db.execute(
                select(QuizAttempt.assessment_id, QuizAttempt.student_id, QuizAttempt.state)
                .join(Assessment, Assessment.id == QuizAttempt.assessment_id)
                .where(Assessment.offering_id == offering.id)):
            seen = self.attempt_states.get((aid, sid))
            self.attempt_states[(aid, sid)] = "submitted" if "submitted" in (seen, state)                 else "in_progress"
        self.sessions = db.scalars(select(AttendanceSession).where(
            AttendanceSession.offering_id == offering.id)).all()
        self.marks = {(m.session_id, m.student_id): m.status for m in db.scalars(
            select(AttendanceMark).join(AttendanceSession,
                                        AttendanceSession.id == AttendanceMark.session_id)
            .where(AttendanceSession.offering_id == offering.id))}


def attendance_category(ctx, enrollment, period):
    fraction = D(ctx.policy.get("late_attendance_fraction", 0.5))
    counted, total, missing = 0, Decimal(0), 0
    sessions = sorted((s for s in ctx.sessions
                       if s.section_id == enrollment.section_id and s.period == period),
                      key=lambda s: s.session_date)
    days = [{"date": s.session_date, "status": ctx.marks.get((s.id, enrollment.student_id))}
            for s in sessions]
    for s in sessions:
        status = ctx.marks.get((s.id, enrollment.student_id))
        if status is None:
            missing += 1
        elif status == "excused":
            continue
        else:
            counted += 1
            total += {"present": Decimal(1), "absent": Decimal(0), "late": fraction}[status]
    if not sessions:
        return {"status": "no_data", "raw": None, "earned": None, "possible": None,
                "missing": ["No attendance days recorded"], "sources": days}
    if missing:
        return {"status": "pending", "raw": None, "earned": None, "possible": None,
                "missing": [f"{missing} attendance day(s) not marked"], "sources": days}
    if counted == 0:
        return {"status": "no_data", "raw": None, "earned": None, "possible": None,
                "missing": ["All attendance days excused"], "sources": days}
    return {"status": "ok", "raw": total / counted * 100, "earned": total,
            "possible": Decimal(counted), "missing": [], "sources": days}


def assessment_category(ctx, enrollment, key, period):
    items = [(a, rev) for a, rev, sections in ctx.assessments
             if rev.include_in_grade and rev.category_key == key and rev.period == period
             and targeted(sections, enrollment)]
    if not items:
        return {"status": "no_data", "raw": None, "earned": None, "possible": None,
                "missing": ["Nothing assigned in this category yet"], "sources": []}
    earned, possible, missing, sources = Decimal(0), Decimal(0), [], []
    for a, rev in items:
        row = ctx.scores.get((a.id, enrollment.student_id))
        sources.append({"assessment_id": a.id, "title": rev.title, "kind": a.kind,
                        "revision_version": rev.version,
                        "score": row.score if row else None, "max_points": rev.max_points,
                        "attempt_id": row.selected_attempt_id if row else None,
                        "submission_id": row.selected_submission_id if row else None})
        if row is None or row.score is None:
            missing.append(rev.title)
            continue
        earned += Decimal(row.score)
        possible += Decimal(rev.max_points)
    if missing:
        return {"status": "pending", "raw": None, "earned": None, "possible": None,
                "missing": missing, "sources": sources}
    if possible <= 0:
        return {"status": "no_data", "raw": None, "earned": None, "possible": None,
                "missing": ["No points available"], "sources": sources}
    return {"status": "ok", "raw": earned / possible * 100, "earned": earned,
            "possible": possible, "missing": [], "sources": sources}


def period_result(ctx, enrollment, period):
    transmuted = ctx.policy.get("transmutation") == "transmuted"
    total, pending, categories = Decimal(0), [], []
    for cat in ctx.policy["categories"]:
        info = (attendance_category(ctx, enrollment, period) if cat["key"] == "attendance"
                else assessment_category(ctx, enrollment, cat["key"], period))
        weight = D(cat["weight"])
        percent = None
        if info["status"] == "ok":
            percent = 50 + info["raw"] / 2 if transmuted else info["raw"]
        if weight > 0:
            if info["status"] != "ok":
                pending.append(f'{cat["label"]}: {"; ".join(info["missing"])}')
            else:
                total += percent * weight / 100
        categories.append({"key": cat["key"], "label": cat["label"], "weight": weight,
                           "status": info["status"], "earned": info["earned"],
                           "possible": info["possible"],
                           "raw_percent": None if info["raw"] is None else r2(info["raw"]),
                           "percent": None if percent is None else r2(percent),
                           "missing": info["missing"], "sources": info["sources"]})
    return {"grade": None if pending else r2(total), "pending": pending,
            "categories": categories}


def student_grades(ctx, enrollment):
    """Midterm, finals and course results for one student (working values, not published)."""
    results = {p["key"]: period_result(ctx, enrollment, p["key"]) for p in ctx.policy["periods"]}
    shares = {p["key"]: D(p["share"]) for p in ctx.policy["periods"]}
    pending = [f'{k}: not ready' for k, r in results.items() if r["grade"] is None]
    course = None if pending else r2(sum(
        (results[k]["grade"] * shares[k] / 100 for k in results), Decimal(0)))
    results["course"] = {"grade": course, "pending": pending, "categories": []}
    return results


def remark(ctx, grade):
    return "passed" if grade >= D(ctx.policy.get("passing", 75)) else "failed"


# ---------- faculty gradebook ----------

def latest_grade_rows(db, offering_id):
    rows = {}
    for g in db.scalars(select(GradePublication).where(GradePublication.offering_id == offering_id)
                        .order_by(GradePublication.release_number)):
        rows[(g.student_id, g.period)] = g
    return rows


def review_flags(db, offering_id):
    return {(s.student_id, s.period): s for s in db.scalars(select(GradeReviewState).where(
        GradeReviewState.offering_id == offering_id, GradeReviewState.needs_review.is_(True)))}


def gradebook(db, offering):
    ctx = Context(db, offering)
    released = {}
    for r in db.scalars(select(ResultPublication).join(
            Assessment, Assessment.id == ResultPublication.assessment_id)
            .where(Assessment.offering_id == offering.id)
            .order_by(ResultPublication.release_number)):
        released[(r.assessment_id, r.student_id)] = r
    published, flags = latest_grade_rows(db, offering.id), review_flags(db, offering.id)
    sections = {s.id: s.name for s in db.scalars(select(Section).where(
        Section.term_id == offering.term_id))}
    columns = [{"id": a.id, "kind": a.kind, "title": rev.title, "category_key": rev.category_key,
                "period": rev.period, "max_points": rev.max_points,
                "include_in_grade": rev.include_in_grade, "section_ids": sorted(secs, key=str)}
               for a, rev, secs in ctx.assessments]
    rows = []
    for enrollment, account in ctx.enrollments:
        cells = {}
        for a, rev, secs in ctx.assessments:
            if not targeted(secs, enrollment):
                continue
            score = ctx.scores.get((a.id, account.id))
            rel = released.get((a.id, account.id))
            cells[str(a.id)] = {
                "score": score.score if score else None,
                "feedback": score.feedback if score else "",
                "revision": score.revision if score else 0,
                "released_score": rel.score if rel else None,
                "release_number": rel.release_number if rel else 0,
                "unreleased_change": bool(score and score.score is not None and (
                    rel is None or rel.score != score.score or rel.feedback != score.feedback))}
            if a.kind == "online_quiz":
                cells[str(a.id)]["attempt_state"] = ctx.attempt_states.get(
                    (a.id, account.id), "not_attempted")
        grades = student_grades(ctx, enrollment)
        rows.append({
            "student_id": account.id, "display_name": account.display_name,
            "student_number": account.student_number,
            "section": sections.get(enrollment.section_id), "cells": cells,
            "grades": {k: {"grade": v["grade"], "pending": v["pending"],
                           "categories": v["categories"]} for k, v in grades.items()},
            "published": {k: {"grade": published[(account.id, k)].grade,
                              "release_number": published[(account.id, k)].release_number,
                              "needs_review": (account.id, k) in flags,
                              "review_reason": flags[(account.id, k)].reason
                              if (account.id, k) in flags else None}
                          for k in (*PERIODS, "course") if (account.id, k) in published}})
    return {"policy": ctx.policy, "policy_version": ctx.version, "columns": columns, "rows": rows}


def publish_grades(db, actor, offering, period, student_ids):
    # One publication at a time per offering: concurrent requests wait instead of colliding.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
               {"k": f"grades:{offering.id}"})
    ctx = Context(db, offering)
    if period != "course" and period not in {p["key"] for p in ctx.policy["periods"]}:
        fail(422, "period_invalid", "That grading period is not in the grading policy.")
    published, flags = latest_grade_rows(db, offering.id), review_flags(db, offering.id)
    released, pending, unchanged = [], [], 0
    for enrollment, account in ctx.enrollments:
        if student_ids is not None and account.id not in student_ids:
            continue
        results = student_grades(ctx, enrollment)
        result = results[period]
        if result["grade"] is None:
            pending.append({"student_id": account.id, "student": account.display_name,
                            "reasons": result["pending"]})
            continue
        last = published.get((account.id, period))
        flagged = (account.id, period) in flags
        if last and last.grade == result["grade"] and last.policy_version == ctx.version \
                and not flagged:
            unchanged += 1
            continue
        number = (last.release_number if last else 0) + 1
        snapshot = jsonable({"policy_version": ctx.version, "policy": ctx.policy, "periods": {
            k: {"grade": v["grade"], "categories": v["categories"]}
            for k, v in results.items() if k != "course"}})
        db.add(GradePublication(offering_id=offering.id, student_id=account.id, period=period,
                                release_number=number, grade=result["grade"],
                                remark=remark(ctx, result["grade"]), policy_version=ctx.version,
                                snapshot=snapshot, published_by=actor.id))
        state = db.scalar(select(GradeReviewState).where(
            GradeReviewState.offering_id == offering.id,
            GradeReviewState.student_id == account.id, GradeReviewState.period == period))
        if state:
            state.needs_review, state.reason, state.changed_at = False, "", now()
        released.append(account.id)
    audit(db, actor, "grades.published", "offering", offering.id,
          {"period": period, "published": len(released), "pending": len(pending)})
    db.commit()
    return {"published": len(released), "unchanged": unchanged, "pending": pending}


def own_published_grades(db, offering_id, student_id):
    """What a student may see: the latest published grade per period, nothing else."""
    rows = latest_grade_rows(db, offering_id)
    return [{"period": k, "grade": g.grade, "remark": g.remark,
             "release_number": g.release_number, "published_at": g.published_at}
            for (sid, k), g in rows.items() if sid == student_id]
