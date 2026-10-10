from sqlalchemy import func, or_, select

from app.errors import fail
from app.features.accounts.models import Account

from .models import (
    AcademicTerm,
    Enrollment,
    EnrollmentException,
    Offering,
    OfferingSection,
    SchoolYear,
    Section,
    SectionMember,
    Subject,
)


def _dates(row):
    return {"start_date": row.start_date, "end_date": row.end_date}


def term_view(term):
    return {"id": term.id, "school_year_id": term.school_year_id, "name": term.name,
            "sequence": term.sequence, "status": term.status, "closed_at": term.closed_at,
            "reopened_reason": term.reopened_reason, **_dates(term)}


def school_years(db):
    terms = db.scalars(select(AcademicTerm).order_by(AcademicTerm.sequence)).all()
    by_year = {}
    for term in terms:
        by_year.setdefault(term.school_year_id, []).append(term_view(term))
    years = db.scalars(select(SchoolYear).order_by(SchoolYear.start_date.desc())).all()
    return [{"id": y.id, "label": y.label, **_dates(y), "terms": by_year.get(y.id, [])}
            for y in years]


def subject_view(subject):
    return {"id": subject.id, "code": subject.code, "title": subject.title,
            "units": subject.units, "year_level": subject.year_level,
            "semester": subject.semester, "description": subject.description,
            "status": subject.status}


def subjects(db, include_archived):
    query = select(Subject).order_by(Subject.year_level, Subject.semester, Subject.code)
    if not include_archived:
        query = query.where(Subject.status == "active")
    return [subject_view(s) for s in db.scalars(query)]


def sections(db, term_id):
    counts = dict(db.execute(select(SectionMember.section_id, func.count())
                             .where(SectionMember.term_id == term_id,
                                    SectionMember.status == "active")
                             .group_by(SectionMember.section_id)).all())
    rows = db.scalars(select(Section).where(Section.term_id == term_id)
                      .order_by(Section.year_level, Section.name))
    return [{"id": s.id, "term_id": s.term_id, "name": s.name, "year_level": s.year_level,
             "member_count": counts.get(s.id, 0)} for s in rows]


def section_members(db, section_id):
    if not db.get(Section, section_id):
        fail(404, "not_found", "Section not found.")
    rows = db.execute(
        select(Account.id, Account.display_name, Account.email, Account.student_number)
        .join(SectionMember, SectionMember.student_id == Account.id)
        .where(SectionMember.section_id == section_id, SectionMember.status == "active")
        .order_by(Account.display_name))
    return [{"student_id": r.id, "display_name": r.display_name, "email": r.email,
             "student_number": r.student_number} for r in rows]


def section_roster_page(db, section_id, page, page_size, search, status):
    """Students of a section, a page at a time, with search and a status filter (active, withdrawn, all)."""
    if not db.get(Section, section_id):
        fail(404, "not_found", "Section not found.")
    query = (select(Account.id, Account.display_name, Account.email, Account.student_number, SectionMember.status)
             .join(SectionMember, SectionMember.student_id == Account.id)
             .where(SectionMember.section_id == section_id))
    if status in ("active", "withdrawn"):
        query = query.where(SectionMember.status == status)
    query = _search(query, search)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(query.order_by(Account.display_name, Account.id)
                      .limit(page_size).offset((page - 1) * page_size))
    return {"total": total, "page": page, "page_size": page_size,
            "items": [{"student_id": r.id, "display_name": r.display_name, "email": r.email,
                       "student_number": r.student_number, "status": r.status} for r in rows]}


def section_candidates(db, section_id, page, page_size, search, account="all"):
    """Students who could be added: not deactivated and not already active in any section of this term
    (a student has one active section per term; withdraw them first to move them)."""
    section = db.get(Section, section_id)
    if not section:
        fail(404, "not_found", "Section not found.")
    placed = select(SectionMember.student_id).join(Section, Section.id == SectionMember.section_id).where(
        Section.term_id == section.term_id, SectionMember.status == "active")
    query = (select(Account.id, Account.display_name, Account.email, Account.student_number, Account.status)
             .where(Account.role == "student", Account.status != "inactive", Account.id.not_in(placed)))
    if account in ("active", "invited"):
        query = query.where(Account.status == account)
    query = _search(query, search)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(query.order_by(Account.display_name, Account.id)
                      .limit(page_size).offset((page - 1) * page_size))
    return {"total": total, "page": page, "page_size": page_size,
            "items": [{"student_id": r.id, "display_name": r.display_name, "email": r.email,
                       "student_number": r.student_number, "account_status": r.status} for r in rows]}


def _search(query, search):
    text = (search or "").strip()
    if not text:
        return query
    like = f"%{text.replace('%', '').replace('_', '')}%"
    return query.where(or_(Account.display_name.ilike(like), Account.email.ilike(like),
                           Account.student_number.ilike(like)))


def offering_summary(db, offerings):
    """Shared projection: subject, teacher, term, sections, enrolled count."""
    ids = [o.id for o in offerings]
    if not ids:
        return []
    links = {}
    for oid, sid, name in db.execute(
            select(OfferingSection.offering_id, Section.id, Section.name)
            .join(Section, Section.id == OfferingSection.section_id)
            .where(OfferingSection.offering_id.in_(ids)).order_by(Section.name)):
        links.setdefault(oid, []).append({"id": sid, "name": name})
    section_counts = {
        (oid, sid): count for oid, sid, count in db.execute(
            select(Enrollment.offering_id, Enrollment.section_id, func.count())
            .where(Enrollment.offering_id.in_(ids), Enrollment.status == "enrolled",
                   Enrollment.section_id.is_not(None))
            .group_by(Enrollment.offering_id, Enrollment.section_id)
        ).all()
    }
    for oid, sections in links.items():
        for section in sections:
            section["enrolled"] = section_counts.get((oid, section["id"]), 0)
    counts = dict(db.execute(select(Enrollment.offering_id, func.count())
                             .where(Enrollment.offering_id.in_(ids),
                                    Enrollment.status == "enrolled")
                             .group_by(Enrollment.offering_id)).all())
    subject_map = {s.id: s for s in db.scalars(
        select(Subject).where(Subject.id.in_({o.subject_id for o in offerings})))}
    teacher_map = {a.id: a.display_name for a in db.scalars(
        select(Account).where(Account.id.in_({o.faculty_id for o in offerings})))}
    term_map = {t.id: t for t in db.scalars(
        select(AcademicTerm).where(AcademicTerm.id.in_({o.term_id for o in offerings})))}
    out = []
    for o in offerings:
        s, t = subject_map[o.subject_id], term_map[o.term_id]
        out.append({"id": o.id, "status": o.status, "term_id": o.term_id, "term": t.name,
                    "term_status": t.status, "subject": {"id": s.id, "code": s.code,
                                                         "title": s.title, "units": s.units},
                    "faculty": {"id": o.faculty_id, "display_name": teacher_map[o.faculty_id]},
                    "sections": links.get(o.id, []), "enrolled": counts.get(o.id, 0),
                    "meeting_days": o.meeting_days})
    return out


def term_offerings(db, term_id):
    rows = db.scalars(select(Offering).where(Offering.term_id == term_id)
                      .join(Subject, Subject.id == Offering.subject_id).order_by(Subject.code))
    return offering_summary(db, rows.all())


def my_offerings(db, faculty):
    rows = db.scalars(select(Offering).where(Offering.faculty_id == faculty.id)
                      .join(AcademicTerm, AcademicTerm.id == Offering.term_id)
                      .order_by(AcademicTerm.start_date.desc(), Offering.id))
    return offering_summary(db, rows.all())


def my_subjects(db, student):
    rows = db.execute(
        select(Enrollment, Offering).join(Offering, Offering.id == Enrollment.offering_id)
        .join(AcademicTerm, AcademicTerm.id == Offering.term_id)
        .where(Enrollment.student_id == student.id)
        .order_by(AcademicTerm.start_date.desc(), Offering.id)).all()
    summaries = {s["id"]: s for s in offering_summary(db, [o for _, o in rows])}
    out = []
    for enrollment, offering in rows:
        s = summaries[offering.id]
        out.append({"offering_id": offering.id, "term": s["term"], "term_status": s["term_status"],
                    "subject": s["subject"], "faculty": s["faculty"],
                    "enrollment_status": enrollment.status})
    return out


def visible_offering(db, offering_id, actor):
    """Admins manage offerings; faculty see only offerings assigned to them."""
    offering = db.get(Offering, offering_id)
    if not offering or (actor.role == "faculty" and offering.faculty_id != actor.id):
        fail(404, "not_found", "Offering not found.")
    return offering


def offering_detail(db, offering_id, actor):
    return offering_summary(db, [visible_offering(db, offering_id, actor)])[0]


def offering_roster(db, offering_id, actor, history=False):
    visible_offering(db, offering_id, actor)
    exceptions = {e.student_id: e for e in db.scalars(
        select(EnrollmentException).where(EnrollmentException.offering_id == offering_id))}
    rows = db.execute(
        select(Enrollment, Account, Section.name)
        .join(Account, Account.id == Enrollment.student_id)
        .outerjoin(Section, Section.id == Enrollment.section_id)
        .where(Enrollment.offering_id == offering_id)
        .order_by(Account.display_name)).all()
    if actor.role == "faculty" and not history:
        rows = [r for r in rows if r[0].status == "enrolled"]   # active students by default
    out = []
    for enrollment, account, section_name in rows:
        row = {"student_id": account.id, "display_name": account.display_name,
               "student_number": account.student_number, "section": section_name,
               "source": enrollment.source, "status": enrollment.status}
        if actor.role == "admin" and account.id in exceptions:
            row["exception_reason"] = exceptions[account.id].reason
        out.append(row)
    if actor.role == "admin":
        # Excluded students have no enrollment row; admins still need to see and undo them.
        listed = {r["student_id"] for r in out}
        for student_id, exc in exceptions.items():
            if exc.action == "exclude" and student_id not in listed:
                account = db.get(Account, student_id)
                out.append({"student_id": account.id, "display_name": account.display_name,
                            "student_number": account.student_number, "section": None,
                            "source": "exception", "status": "excluded",
                            "exception_reason": exc.reason})
    return out
