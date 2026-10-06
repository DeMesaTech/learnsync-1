"""Reviewed imports: student lists and prospectus drafts. Nothing is created until an admin
commits, and a commit with any invalid row creates nothing (no silent partial import)."""
from decimal import Decimal, InvalidOperation
from pathlib import Path

from fastapi import HTTPException
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select

from app.errors import fail
from app.features.accounts.commands import audit, issue_token, send_link
from app.features.accounts.models import Account, now
from app.features.files.storage import path_of, save_upload

from . import commands, documents
from .models import ProspectusImport, Section, SectionMember, StudentImport, Subject

EMAIL = TypeAdapter(EmailStr)
STUDENT_TYPES = {".csv", ".xlsx"}
PROSPECTUS_TYPES = {".pdf", ".docx", ".xlsx", ".csv"}


# ---------- students ----------

def validate_students(db, rows, term_id):
    """Check every row against the file and the database; returns per-row results."""
    sections = {s.name: s for s in db.scalars(select(Section).where(Section.term_id == term_id))} \
        if term_id else {}
    seen_email, seen_number, out = {}, {}, []
    for raw in rows:
        errors = []
        email = raw["email"].strip().lower()
        number = raw["student_number"].strip()
        name = raw["display_name"].strip()
        try:
            email = str(EMAIL.validate_python(email)).lower()
        except ValidationError:
            errors.append("Email address is not valid.")
        if not number or len(number) > 50:
            errors.append("Student number is required (max 50 characters).")
        if not name or len(name) > 150:
            errors.append("Name is required (max 150 characters).")
        if email in seen_email:
            errors.append(f"Email repeats row {seen_email[email]}.")
        if number in seen_number:
            errors.append(f"Student number repeats row {seen_number[number]}.")
        seen_email.setdefault(email, raw["row"])
        seen_number.setdefault(number, raw["row"])
        section = raw.get("section", "").strip()
        if section and not term_id:
            errors.append("Choose a term to assign sections.")
        elif section and section not in sections:
            errors.append(f'Section "{section}" does not exist in this term.')
        status = "new"
        by_email = db.scalar(select(Account).where(Account.email == email))
        by_number = db.scalar(select(Account).where(Account.student_number == number)) \
            if number else None
        if by_email and (by_email.role != "student" or by_email.student_number != number):
            errors.append("Email already belongs to a different account.")
        elif by_number and not by_email:
            errors.append("Student number already belongs to a different account.")
        elif by_email:
            status = "existing"
            current = db.scalar(select(SectionMember).where(
                SectionMember.term_id == term_id, SectionMember.student_id == by_email.id,
                SectionMember.status == "active")) if term_id else None
            if section and current and section in sections and current.section_id != sections[section].id:
                errors.append("Student already belongs to a different section this term.")
        out.append({"row": raw["row"], "student_number": number, "email": email,
                    "display_name": name, "section": section,
                    "status": "error" if errors else status, "errors": errors})
    return out


def summarize(results):
    return {"new": sum(r["status"] == "new" for r in results),
            "existing": sum(r["status"] == "existing" for r in results),
            "errors": sum(r["status"] == "error" for r in results), "total": len(results)}


def student_preview(db, imp):
    results = validate_students(db, imp.rows, imp.term_id)
    return {"id": imp.id, "status": imp.status, "term_id": imp.term_id,
            "summary": summarize(results), "rows": results}


def create_student_import(db, actor, upload, term_id):
    if term_id:
        commands.open_term(db, term_id)
    file = save_upload(db, upload, "student_import", actor, STUDENT_TYPES)
    try:
        rows = documents.read_student_rows(path_of(file), Path(file.original_name).suffix.lower())
    except HTTPException:
        raise
    except Exception:   # noqa: BLE001 - corrupt spreadsheets must not become a 500
        fail(422, "file_unreadable", "This file could not be read. Check that it opens in Excel.")
    imp = StudentImport(file_id=file.id, term_id=term_id, rows=rows, created_by=actor.id)
    db.add(imp)
    audit(db, actor, "student_import.previewed", "student_import", file.id,
          {"rows": len(rows)})
    db.commit()
    return imp


def commit_student_import(db, actor, import_id):
    imp = db.scalar(select(StudentImport).where(StudentImport.id == import_id).with_for_update())
    if not imp:
        fail(404, "not_found", "Import not found.")
    if imp.status == "committed":
        fail(409, "import_committed", "This import was already committed.")
    if imp.term_id:
        commands.open_term(db, imp.term_id)
    results = validate_students(db, imp.rows, imp.term_id)   # re-check: data may have changed
    if any(r["status"] == "error" for r in results):
        fail(409, "import_has_errors",
             "Fix the highlighted rows and upload the file again. Nothing was imported.")
    sections = {s.name: s for s in db.scalars(
        select(Section).where(Section.term_id == imp.term_id))} if imp.term_id else {}
    created, invitations = 0, []
    for r in results:
        if r["status"] == "new":
            account = Account(email=r["email"], display_name=r["display_name"], role="student",
                              student_number=r["student_number"], status="invited")
            db.add(account)
            db.flush()
            invitations.append((account, issue_token(db, account, "invite", actor)))
            created += 1
        else:
            account = db.scalar(select(Account).where(Account.email == r["email"]))
        if r["section"]:
            section = sections[r["section"]]
            commands.place_in_section(db, section, account.id)
    imp.status, imp.committed_at = "committed", now()
    audit(db, actor, "student_import.committed", "student_import", imp.id,
          {"created": created, "existing": len(results) - created})
    db.commit()
    failed = []
    for account, token in invitations:   # send after commit; failures are resendable
        try:
            send_link(account, token, "invite")
        except HTTPException:
            failed.append(account.email)
    return {"created": created, "existing": len(results) - created, "email_failed": failed}


# ---------- prospectus ----------

def validate_draft(db, draft):
    existing = set(db.scalars(select(Subject.code)))
    seen, out = set(), []
    for index, row in enumerate(draft, start=1):
        errors = []
        code = str(row.get("code", "")).strip().upper()
        title = str(row.get("title", "")).strip()
        if not code or len(code) > 30:
            errors.append("Code is required.")
        if not title or len(title) > 200:
            errors.append("Title is required.")
        try:
            units = Decimal(str(row.get("units", "")))
            if not 0 <= units <= 99:
                raise InvalidOperation
        except InvalidOperation:
            units = None
            errors.append("Units must be a number from 0 to 99.")
        year, sem = row.get("year_level"), row.get("semester")
        if year is not None and not (isinstance(year, int) and 1 <= year <= 6):
            errors.append("Year level must be 1-6 or empty.")
        if sem is not None and not (isinstance(sem, int) and 1 <= sem <= 4):
            errors.append("Semester must be 1-4 or empty.")
        if code in seen:
            errors.append("Code repeats earlier in this draft.")
        seen.add(code)
        out.append({"index": index, "code": code, "title": title,
                    "units": None if units is None else str(units), "year_level": year,
                    "semester": sem, "exists": code in existing, "errors": errors})
    return out


def prospectus_view(db, imp):
    return {"id": imp.id, "status": imp.status, "revision": imp.revision,
            "warnings": imp.warnings, "subjects": validate_draft(db, imp.draft)}


def create_prospectus_import(db, actor, upload):
    if upload is None:   # manual entry fallback when no file can be read
        imp = ProspectusImport(created_by=actor.id, warnings=["Manual entry: no file uploaded."])
    else:
        file = save_upload(db, upload, "prospectus", actor, PROSPECTUS_TYPES)
        ext = Path(file.original_name).suffix.lower()
        try:
            lines = documents.read_lines(path_of(file), ext)
        except Exception:   # noqa: BLE001 - any parser failure falls back to manual entry
            lines = []
        draft, warnings = documents.parse_prospectus(lines)
        if not lines:
            warnings.insert(0, "The file could not be read as text (scanned documents are not "
                               "supported). Enter subjects manually.")
        imp = ProspectusImport(file_id=file.id, draft=draft, warnings=warnings,
                               created_by=actor.id)
    db.add(imp)
    db.flush()
    audit(db, actor, "prospectus.uploaded", "prospectus_import", imp.id, {"rows": len(imp.draft)})
    db.commit()
    return imp


def locked_draft(db, import_id, expected_revision):
    imp = db.scalar(select(ProspectusImport).where(ProspectusImport.id == import_id)
                    .with_for_update())
    if not imp:
        fail(404, "not_found", "Prospectus import not found.")
    if imp.status != "draft":
        fail(409, "import_committed", "This prospectus was already committed.")
    if imp.revision != expected_revision:
        fail(409, "draft_revision_conflict",
             "This draft changed elsewhere. Reload it before saving.")
    return imp


def save_prospectus_draft(db, actor, import_id, expected_revision, subjects):
    imp = locked_draft(db, import_id, expected_revision)
    imp.draft = [s.model_dump(mode="json") for s in subjects]
    imp.revision += 1
    db.commit()
    return imp


def commit_prospectus(db, actor, import_id, expected_revision):
    imp = locked_draft(db, import_id, expected_revision)
    rows = validate_draft(db, imp.draft)
    if not rows:
        fail(422, "draft_empty", "Add at least one subject before committing.")
    if any(r["errors"] for r in rows):
        fail(409, "draft_has_errors", "Fix the highlighted subjects. Nothing was created.")
    created = 0
    for r in rows:
        if r["exists"]:
            continue   # existing catalog entries are never overwritten by an import
        db.add(Subject(code=r["code"], title=r["title"], units=Decimal(r["units"]),
                       year_level=r["year_level"], semester=r["semester"]))
        created += 1
    imp.status, imp.committed_at = "committed", now()
    audit(db, actor, "prospectus.committed", "prospectus_import", imp.id,
          {"created": created, "skipped_existing": len(rows) - created})
    db.commit()
    return {"created": created, "skipped_existing": len(rows) - created}

