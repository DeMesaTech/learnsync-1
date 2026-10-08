from fastapi import HTTPException
from sqlalchemy import delete, select

from app.errors import fail
from app.features.accounts.commands import audit
from app.features.accounts.models import Account, now

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

# ---------- lookups and guards ----------

def get_or_404(db, model, ident, label):
    row = db.get(model, ident)
    if not row:
        fail(404, "not_found", f"{label} not found.")
    return row


def open_term(db, term_id):
    term = get_or_404(db, AcademicTerm, term_id, "Term")
    if term.status == "closed":
        fail(409, "term_closed", "This term is closed. Reopen it before making changes.")
    return term


def account_with_role(db, account_id, role):
    account = db.get(Account, account_id)
    if not account or account.role != role or account.status == "inactive":
        fail(422, "account_invalid", f"Choose an existing {role} account that is not inactive.")
    return account


# ---------- school years and terms ----------

def create_school_year(db, actor, data):
    if db.scalar(select(SchoolYear.id).where(SchoolYear.label == data.label)):
        fail(409, "school_year_exists", "A school year with this label already exists.")
    if len({t.sequence for t in data.terms}) != len(data.terms):
        fail(422, "term_sequence_duplicate", "Each term needs its own sequence number.")
    year = SchoolYear(label=data.label, start_date=data.start_date, end_date=data.end_date)
    db.add(year)
    db.flush()
    for item in data.terms:
        term = AcademicTerm(school_year_id=year.id, name=item.name, sequence=item.sequence,
                            start_date=item.start_date, end_date=item.end_date)
        db.add(term)
        db.flush()
        if item.copy_from_term_id:
            copy_structure(db, actor, get_or_404(db, AcademicTerm, item.copy_from_term_id,
                                                 "Source term"), term, offerings=item.copy_offerings)
    audit(db, actor, "school_year.created", "school_year", year.id, {"label": year.label})
    db.commit()
    return year


def copy_structure(db, actor, source, target, offerings):
    """Copy sections (without students) and optionally offerings (without enrollments)."""
    if source.id == target.id:
        fail(422, "copy_same_term", "Choose a different source term.")
    mapping = {}
    for section in db.scalars(select(Section).where(Section.term_id == source.id)):
        new = Section(term_id=target.id, name=section.name, year_level=section.year_level)
        db.add(new)
        db.flush()
        mapping[section.id] = new.id
    if offerings:
        for offering in db.scalars(select(Offering).where(Offering.term_id == source.id,
                                                          Offering.status == "active")):
            new = Offering(subject_id=offering.subject_id, term_id=target.id,
                           faculty_id=offering.faculty_id)
            db.add(new)
            db.flush()
            for link in db.scalars(select(OfferingSection)
                                   .where(OfferingSection.offering_id == offering.id)):
                db.add(OfferingSection(offering_id=new.id, section_id=mapping[link.section_id]))
    audit(db, actor, "term.structure_copied", "term", target.id,
          {"source_term_id": str(source.id), "offerings": offerings})


def copy_term_structure(db, actor, term_id, source_term_id, offerings):
    target = open_term(db, term_id)
    if db.scalar(select(Section.id).where(Section.term_id == target.id)):
        fail(409, "term_not_empty", "Copy structure only into a term without sections.")
    copy_structure(db, actor, get_or_404(db, AcademicTerm, source_term_id, "Source term"),
                   target, offerings)
    db.commit()


def update_term(db, actor, term_id, data):
    term = open_term(db, term_id)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(term, field, value)
    if term.end_date < term.start_date:
        fail(422, "term_dates", "End date must not be before the start date.")
    audit(db, actor, "term.updated", "term", term.id, data.model_dump(mode="json",
                                                                    exclude_none=True))
    db.commit()
    return term


def close_term(db, actor, term_id):
    term = get_or_404(db, AcademicTerm, term_id, "Term")
    if term.status == "closed":
        fail(409, "term_closed", "This term is already closed.")
    term.status, term.closed_at, term.closed_by = "closed", now(), actor.id
    audit(db, actor, "term.closed", "term", term.id)
    db.commit()
    return term


def reopen_term(db, actor, term_id, reason):
    term = get_or_404(db, AcademicTerm, term_id, "Term")
    if term.status != "closed":
        fail(409, "term_open", "This term is already open.")
    term.status, term.reopened_reason = "open", reason
    audit(db, actor, "term.reopened", "term", term.id, {"reason": reason})
    db.commit()
    return term


# ---------- subject catalog ----------

def create_subject(db, actor, data):
    code = data.code.strip().upper()
    if db.scalar(select(Subject.id).where(Subject.code == code)):
        fail(409, "subject_exists", "A subject with this code already exists.")
    subject = Subject(**{**data.model_dump(), "code": code})
    db.add(subject)
    db.flush()
    audit(db, actor, "subject.created", "subject", subject.id, {"code": code})
    db.commit()
    return subject


def update_subject(db, actor, subject_id, data):
    subject = get_or_404(db, Subject, subject_id, "Subject")
    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(subject, field, value)
    audit(db, actor, "subject.updated", "subject", subject.id,
          data.model_dump(mode="json", exclude_unset=True))
    db.commit()
    return subject


# ---------- sections and rosters ----------

def create_section(db, actor, term_id, data):
    term = open_term(db, term_id)
    if db.scalar(select(Section.id).where(Section.term_id == term.id, Section.name == data.name)):
        fail(409, "section_exists", "This term already has a section with this name.")
    section = Section(term_id=term.id, name=data.name, year_level=data.year_level)
    db.add(section)
    db.flush()
    audit(db, actor, "section.created", "section", section.id, {"name": data.name})
    db.commit()
    return section


def place_in_section(db, section, student_id):
    """Put a student in a section (one active section per term) and refresh enrollments."""
    account_with_role(db, student_id, "student")
    current = db.scalar(select(SectionMember).where(
        SectionMember.term_id == section.term_id, SectionMember.student_id == student_id,
        SectionMember.status == "active"))
    if current and current.section_id == section.id:
        return   # already placed here; re-adding is a no-op
    if current:
        fail(409, "already_in_section",
             "This student already belongs to a section this term. Withdraw them first.")
    member = db.scalar(select(SectionMember).where(SectionMember.section_id == section.id,
                                                   SectionMember.student_id == student_id))
    if member:
        member.status = "active"
    else:
        db.add(SectionMember(section_id=section.id, term_id=section.term_id,
                             student_id=student_id))
    db.flush()
    recompute_for_section(db, section.id)


def add_member(db, actor, section_id, student_id):
    section = get_or_404(db, Section, section_id, "Section")
    open_term(db, section.term_id)
    place_in_section(db, section, student_id)
    audit(db, actor, "section.member_added", "section", section.id,
          {"student_id": str(student_id)})
    db.commit()


def withdraw_member(db, actor, section_id, student_id, reason):
    reason = (reason or "").strip()
    if len(reason) < 3:
        fail(422, "reason_required", "Give a reason for the withdrawal (at least 3 characters). It is kept in the audit history.")
    section = get_or_404(db, Section, section_id, "Section")
    open_term(db, section.term_id)
    member = db.scalar(select(SectionMember).where(
        SectionMember.section_id == section.id, SectionMember.student_id == student_id,
        SectionMember.status == "active"))
    if not member:
        fail(404, "not_found", "This student is not an active member of the section.")
    member.status = "withdrawn"
    db.flush()
    recompute_for_section(db, section.id)
    audit(db, actor, "section.member_withdrawn", "section", section.id,
          {"student_id": str(student_id), "reason": reason})
    db.commit()


# ---------- offerings ----------

def check_sections(db, offering_term_id, subject, section_ids, override_reason=None):
    sections = db.scalars(select(Section).where(Section.id.in_(section_ids))).all() \
        if section_ids else []
    if len(sections) != len(set(section_ids)):
        fail(422, "section_invalid", "Choose existing sections.")
    term = db.get(AcademicTerm, offering_term_id)
    overridden = []
    for section in sections:
        if section.term_id != offering_term_id:
            fail(422, "section_wrong_term", "Sections must belong to the offering's term.")
        placed = subject.year_level is not None and subject.semester is not None
        if placed and (section.year_level != subject.year_level
                       or term.sequence != subject.semester):
            if override_reason:
                overridden.append(section.name)
                continue
            fail(422, "placement_mismatch",
                 f"{subject.code} is placed in year {subject.year_level}, semester "
                 f"{subject.semester}; {section.name} does not match. "
                 "Use an enrollment exception for irregular students, or override with a reason.")
    return overridden


def add_offering(db, actor, term, faculty_id, subject_id, section_ids, override_reason):
    """Create one offering inside the caller's transaction (the caller commits)."""
    subject = get_or_404(db, Subject, subject_id, "Subject")
    if subject.status != "active":
        fail(422, "subject_archived", "Archived subjects cannot be offered.")
    section_ids = list(dict.fromkeys(section_ids))
    overridden = check_sections(db, term.id, subject, section_ids, override_reason)
    if db.scalar(select(Offering.id).where(Offering.subject_id == subject.id,
                                           Offering.term_id == term.id,
                                           Offering.faculty_id == faculty_id)):
        fail(409, "offering_exists", "This teacher already has this subject in this term.")
    offering = Offering(subject_id=subject.id, term_id=term.id, faculty_id=faculty_id)
    db.add(offering)
    db.flush()
    for section_id in section_ids:
        db.add(OfferingSection(offering_id=offering.id, section_id=section_id))
    db.flush()
    recompute_offering(db, offering)
    details = {"subject": subject.code, "faculty_id": str(faculty_id)}
    if overridden:
        details["placement_override"] = {"sections": overridden, "reason": override_reason}
    audit(db, actor, "offering.created", "offering", offering.id, details)
    return offering


def create_offering(db, actor, term_id, data):
    term = open_term(db, term_id)
    account_with_role(db, data.faculty_id, "faculty")
    offering = add_offering(db, actor, term, data.faculty_id, data.subject_id, data.section_ids,
                            data.placement_override_reason)
    db.commit()
    return offering


def create_offerings_bulk(db, actor, term_id, data):
    """Assign several subjects, each with its own sections, to one teacher: all or nothing.
    A refusal names the subject that caused it and nothing is saved."""
    term = open_term(db, term_id)
    account_with_role(db, data.faculty_id, "faculty")
    subject_ids = [item.subject_id for item in data.items]
    if len(set(subject_ids)) != len(subject_ids):
        fail(422, "duplicate_subject", "Each subject can appear only once in a bulk assignment.")
    made = []
    for item in data.items:
        try:
            made.append(add_offering(db, actor, term, data.faculty_id, item.subject_id,
                                     item.section_ids, item.placement_override_reason))
        except HTTPException as error:
            db.rollback()
            subject = db.get(Subject, item.subject_id)
            name = subject.code if subject else "A subject"
            detail = error.detail if isinstance(error.detail, dict) else {"code": "refused", "message": str(error.detail)}
            fail(error.status_code, detail.get("code", "refused"),
                 f"{name}: {detail.get('message', 'Could not be assigned.')} Nothing was saved.",
                 {str(item.subject_id): detail.get("message", "")})
    db.commit()
    return made


def update_offering(db, actor, offering_id, data):
    offering = get_or_404(db, Offering, offering_id, "Offering")
    open_term(db, offering.term_id)
    details = {}
    if data.faculty_id and data.faculty_id != offering.faculty_id:
        account_with_role(db, data.faculty_id, "faculty")
        details["previous_faculty_id"] = str(offering.faculty_id)
        details["faculty_id"] = str(data.faculty_id)
        offering.faculty_id = data.faculty_id
    if data.section_ids is not None:
        section_ids = list(dict.fromkeys(data.section_ids))
        overridden = check_sections(db, offering.term_id, db.get(Subject, offering.subject_id),
                                    section_ids, data.placement_override_reason)
        if overridden:
            details["placement_override"] = {"sections": overridden,
                                             "reason": data.placement_override_reason}
        db.execute(delete(OfferingSection).where(OfferingSection.offering_id == offering.id))
        for section_id in section_ids:
            db.add(OfferingSection(offering_id=offering.id, section_id=section_id))
        details["section_ids"] = [str(s) for s in section_ids]
    db.flush()
    recompute_offering(db, offering)
    audit(db, actor, "offering.updated", "offering", offering.id, details)
    db.commit()
    return offering


# ---------- irregular enrollment ----------

def set_exception(db, actor, offering_id, student_id, data):
    offering = get_or_404(db, Offering, offering_id, "Offering")
    open_term(db, offering.term_id)
    account_with_role(db, student_id, "student")
    if data.action == "include":
        linked = db.scalar(select(OfferingSection.section_id).where(
            OfferingSection.offering_id == offering.id,
            OfferingSection.section_id == data.section_id))
        if not linked:
            fail(422, "section_not_linked", "Choose one of this offering's teaching sections.")
    row = db.scalar(select(EnrollmentException).where(
        EnrollmentException.offering_id == offering.id,
        EnrollmentException.student_id == student_id))
    if not row:
        row = EnrollmentException(offering_id=offering.id, student_id=student_id)
        db.add(row)
    row.action, row.section_id, row.reason, row.actor_id = (
        data.action, data.section_id if data.action == "include" else None, data.reason, actor.id)
    db.flush()
    recompute_offering(db, offering)
    audit(db, actor, "enrollment.exception_set", "offering", offering.id,
          {"student_id": str(student_id), "action": data.action, "reason": data.reason})
    db.commit()


def clear_exception(db, actor, offering_id, student_id):
    offering = get_or_404(db, Offering, offering_id, "Offering")
    open_term(db, offering.term_id)
    removed = db.execute(delete(EnrollmentException).where(
        EnrollmentException.offering_id == offering.id,
        EnrollmentException.student_id == student_id)).rowcount
    if not removed:
        fail(404, "not_found", "No exception exists for this student.")
    db.flush()
    recompute_offering(db, offering)
    audit(db, actor, "enrollment.exception_cleared", "offering", offering.id,
          {"student_id": str(student_id)})
    db.commit()


# ---------- effective enrollment ----------

def recompute_for_section(db, section_id):
    for offering_id in db.scalars(select(OfferingSection.offering_id)
                                  .where(OfferingSection.section_id == section_id)):
        recompute_offering(db, db.get(Offering, offering_id))


def recompute_offering(db, offering):
    """Materialize who is effectively enrolled; withdrawn students stay as history."""
    wanted = {}
    regular = db.execute(
        select(SectionMember.student_id, SectionMember.section_id)
        .join(OfferingSection, OfferingSection.section_id == SectionMember.section_id)
        .where(OfferingSection.offering_id == offering.id, SectionMember.status == "active"))
    for student_id, section_id in regular:
        wanted[student_id] = (section_id, "regular")
    for exc in db.scalars(select(EnrollmentException)
                          .where(EnrollmentException.offering_id == offering.id)):
        if exc.action == "exclude":
            wanted.pop(exc.student_id, None)
        else:
            wanted[exc.student_id] = (exc.section_id, "exception")
    existing = {e.student_id: e for e in db.scalars(
        select(Enrollment).where(Enrollment.offering_id == offering.id))}
    for student_id, (section_id, source) in wanted.items():
        row = existing.get(student_id)
        if row is None:
            db.add(Enrollment(offering_id=offering.id, student_id=student_id,
                              section_id=section_id, source=source))
        else:
            row.section_id, row.source, row.status = section_id, source, "enrolled"
    for student_id, row in existing.items():
        if student_id not in wanted:
            row.status = "withdrawn"
    db.flush()
