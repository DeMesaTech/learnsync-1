"""Attendance sessions and marks. An unmarked student is pending, never silently absent."""
from decimal import Decimal

from sqlalchemy import delete, select

from app.errors import fail
from app.features.academics.models import Enrollment, OfferingSection
from app.features.accounts.commands import audit
from app.features.accounts.models import Account

from .models import AttendanceMark, AttendanceSession
from .policy import published_policy
from .reviews import flag_review
from .schemas import NumericAttendanceMark


def section_roster(db, offering_id, section_id):
    """Students currently enrolled in the subject through this teaching section."""
    return db.execute(
        select(Account.id, Account.display_name, Account.student_number)
        .join(Enrollment, Enrollment.student_id == Account.id)
        .where(Enrollment.offering_id == offering_id, Enrollment.section_id == section_id,
               Enrollment.status == "enrolled").order_by(Account.display_name)).all()


def save_session(db, actor, offering, data):
    linked = db.scalar(select(OfferingSection.section_id).where(
        OfferingSection.offering_id == offering.id,
        OfferingSection.section_id == data.section_id))
    if not linked:
        fail(422, "section_invalid", "Choose one of this subject's sections.")
    roster = {row.id for row in section_roster(db, offering.id, data.section_id)}
    stray = set(data.marks) - roster
    if stray:
        fail(422, "student_invalid", "Marks can only be recorded for students in this section.")
    policy, _ = published_policy(db, offering.id)
    for value in data.marks.values():
        if isinstance(value, NumericAttendanceMark):
            if not policy or policy.get("attendance_max_points") is None:
                fail(422, "attendance_points_unconfigured",
                     "Configure and publish an attendance maximum before entering numeric points.")
            if value.points > Decimal(str(policy["attendance_max_points"])):
                fail(422, "attendance_points_exceeded",
                     "Attendance points cannot exceed the published daily maximum.")
    session = db.scalar(select(AttendanceSession).where(
        AttendanceSession.offering_id == offering.id,
        AttendanceSession.section_id == data.section_id,
        AttendanceSession.session_date == data.session_date).with_for_update())
    if not session:
        session = AttendanceSession(offering_id=offering.id, section_id=data.section_id,
                                    session_date=data.session_date, period=data.period,
                                    created_by=actor.id)
        db.add(session)
        db.flush()
    elif session.period != data.period:
        fail(409, "period_locked", "This day is already recorded under another grading period.")
    existing = {m.student_id: m for m in db.scalars(select(AttendanceMark).where(
        AttendanceMark.session_id == session.id))}
    changed = []
    for student_id, value in data.marks.items():
        mark = existing.get(student_id)
        status = value if isinstance(value, str) else None
        points = value.points if isinstance(value, NumericAttendanceMark) else None
        if value is None:
            if mark is not None:
                db.delete(mark)
                changed.append(student_id)
        elif mark is None:
            db.add(AttendanceMark(session_id=session.id, student_id=student_id,
                                  status=status, points=points))
            changed.append(student_id)
        elif mark.status != status or mark.points != points:
            mark.status, mark.points = status, points
            changed.append(student_id)
    if changed:
        audit(db, actor, "attendance.recorded", "offering", offering.id,
              {"date": str(data.session_date), "students": len(changed)})
        flag_review(db, offering.id, "Attendance changed.", changed, [session.period])
    db.commit()
    return session


def delete_session(db, actor, offering, session_id):
    session = db.get(AttendanceSession, session_id)
    if not session or session.offering_id != offering.id:
        fail(404, "not_found", "Attendance day not found.")
    students = list(db.scalars(select(AttendanceMark.student_id).where(
        AttendanceMark.session_id == session.id)))
    db.execute(delete(AttendanceMark).where(AttendanceMark.session_id == session.id))
    db.delete(session)
    audit(db, actor, "attendance.deleted", "offering", offering.id,
          {"date": str(session.session_date)})
    flag_review(db, offering.id, "An attendance day was removed.", students, [session.period])
    db.commit()


def sessions_view(db, offering, section_id=None):
    query = select(AttendanceSession).where(AttendanceSession.offering_id == offering.id) \
        .order_by(AttendanceSession.session_date.desc())
    if section_id:
        query = query.where(AttendanceSession.section_id == section_id)
    out = []
    for s in db.scalars(query):
        marks = {}
        for mark in db.scalars(select(AttendanceMark).where(AttendanceMark.session_id == s.id)):
            marks[str(mark.student_id)] = (mark.status if mark.status is not None
                                           else {"points": float(mark.points)})
        out.append({"id": s.id, "section_id": s.section_id, "date": s.session_date,
                    "period": s.period, "marks": marks})
    return out


def scoring_view(db, offering):
    policy, _ = published_policy(db, offering.id)
    if not policy:
        return {"max_points": 1.0, "late_points": 0.5, "excused_points": None,
                "numeric_enabled": False}
    maximum = float(policy.get("attendance_max_points") or 1)
    late = policy.get("attendance_late_points")
    if late is None:
        late = policy.get("late_attendance_fraction", 0.5) * maximum
    excused = policy.get("attendance_excused_points")
    if excused is None and "attendance_excused_points" not in policy:
        excused = policy.get("attendance_max_points")
    return {"max_points": maximum, "late_points": float(late),
            "excused_points": float(excused) if excused is not None else None,
            "numeric_enabled": policy.get("attendance_max_points") is not None}


def roster_view(db, offering, section_id):
    return [{"student_id": r.id, "display_name": r.display_name,
             "student_number": r.student_number}
            for r in section_roster(db, offering.id, section_id)]
