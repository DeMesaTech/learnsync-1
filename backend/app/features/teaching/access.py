"""Who may touch an offering's teaching content. Used by every teaching endpoint."""
from sqlalchemy import select

from app.errors import fail
from app.features.academics.models import AcademicTerm, Enrollment, Offering


def teaching_offering(db, offering_id, faculty, write=True):
    """The faculty's own offering. Writes are refused once the term is closed."""
    offering = db.get(Offering, offering_id)
    if not offering or offering.faculty_id != faculty.id:
        fail(404, "not_found", "Offering not found.")
    if write and db.get(AcademicTerm, offering.term_id).status == "closed":
        fail(409, "term_closed", "This term is closed. Ask an administrator to reopen it.")
    return offering


def learner_offering(db, offering_id, student, write=False):
    """(offering, enrollment) for a currently enrolled student.

    Withdrawn students get no course content and cannot start new work (a deliberate
    least-privilege default); their own records are reached through record_offering.
    Writes (attempts, submissions) are refused once the term is closed."""
    offering = db.get(Offering, offering_id)
    enrollment = db.scalar(select(Enrollment).where(
        Enrollment.offering_id == offering_id, Enrollment.student_id == student.id,
        Enrollment.status == "enrolled")) if offering else None
    if not offering or not enrollment:
        fail(404, "not_found", "Subject not found.")
    if write and db.get(AcademicTerm, offering.term_id).status == "closed":
        fail(409, "term_closed", "This term is closed. Your teacher can no longer accept work.")
    return offering, enrollment


def record_offering(db, offering_id, student):
    """(offering, enrollment) for a student's OWN retained results, even after withdrawal."""
    offering = db.get(Offering, offering_id)
    enrollment = db.scalar(select(Enrollment).where(
        Enrollment.offering_id == offering_id, Enrollment.student_id == student.id))         if offering else None
    if not offering or not enrollment:
        fail(404, "not_found", "Subject not found.")
    return offering, enrollment


def targeted(section_ids, enrollment):
    """Empty targeting means every section of the offering."""
    return not section_ids or enrollment.section_id in section_ids
