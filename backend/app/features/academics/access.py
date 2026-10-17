from app.errors import fail
from app.features.academics.models import AcademicTerm


def writable_term(db, term_id):
    term = db.get(AcademicTerm, term_id)
    if not term:
        fail(404, "not_found", "Term not found.")
    if term.status != "active":
        if term.status in {"inactive", "archived"}:
            fail(409, "term_closed", "This semester is read-only because it is closed or archived.")
        fail(409, "term_not_active", "This semester is read-only until it is activated.")
    return term