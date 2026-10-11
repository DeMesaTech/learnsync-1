"""Reviewed faculty imports. Preview is read-only; commit revalidates before creating invites."""
from pathlib import Path

from fastapi import HTTPException
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select

from app.errors import fail
from app.features.academics.documents import MAX_ROWS, read_faculty_rows
from app.features.accounts.commands import audit, issue_token, send_link
from app.features.accounts.models import Account, FacultyImport, now
from app.features.files.storage import path_of, save_upload

EMAIL = TypeAdapter(EmailStr)
FACULTY_TYPES = {".csv", ".xlsx"}


def validate_faculty(db, rows):
    emails = {row["email"].strip().lower() for row in rows}
    existing = {account.email: account for account in db.scalars(
        select(Account).where(Account.email.in_(emails)))}
    seen, results = {}, []
    for raw in rows:
        email = raw["email"].strip().lower()
        name = raw["display_name"].strip()
        errors = []
        try:
            email = str(EMAIL.validate_python(email)).lower()
        except ValidationError:
            errors.append("Email address is not valid.")
        if not name or len(name) > 150:
            errors.append("Name is required (max 150 characters).")
        if email in seen:
            errors.append(f"Email repeats row {seen[email]}.")
        seen.setdefault(email, raw["row"])
        account = existing.get(email)
        if account and account.role != "faculty":
            errors.append("Email already belongs to a different account.")
        results.append({"row": raw["row"], "display_name": name, "email": email,
                        "status": "error" if errors else "existing" if account else "new",
                        "errors": errors})
    return results


def summary(rows):
    return {"new": sum(row["status"] == "new" for row in rows),
            "existing": sum(row["status"] == "existing" for row in rows),
            "errors": sum(row["status"] == "error" for row in rows),
            "total": len(rows)}


def faculty_preview(db, imp):
    rows = validate_faculty(db, imp.rows)
    return {"id": imp.id, "status": imp.status, "summary": summary(rows), "rows": rows}


def create_faculty_import(db, actor, upload):
    file = save_upload(db, upload, "faculty_import", actor, FACULTY_TYPES)
    try:
        rows = read_faculty_rows(path_of(file), Path(file.original_name).suffix.lower())
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 - unreadable spreadsheets must not become a 500
        fail(422, "file_unreadable", "This file could not be read. Check that it opens in Excel.")
    if len(rows) > MAX_ROWS:
        fail(422, "too_many_rows", f"Import at most {MAX_ROWS} teachers at a time.")
    imp = FacultyImport(file_id=file.id, rows=rows, created_by=actor.id)
    db.add(imp)
    audit(db, actor, "faculty_import.previewed", "faculty_import", file.id,
          {"rows": len(rows)})
    db.commit()
    return imp


def commit_faculty_import(db, actor, import_id):
    imp = db.scalar(select(FacultyImport).where(FacultyImport.id == import_id).with_for_update())
    if not imp:
        fail(404, "not_found", "Import not found.")
    if imp.status == "committed":
        fail(409, "import_committed", "This import was already committed.")
    rows = validate_faculty(db, imp.rows)
    if any(row["status"] == "error" for row in rows):
        fail(409, "import_has_errors",
             "Fix the highlighted rows and upload the file again. Nothing was imported.")

    invitations = []
    for row in rows:
        if row["status"] != "new":
            continue
        account = Account(email=row["email"], display_name=row["display_name"],
                          role="faculty", status="invited")
        db.add(account)
        db.flush()
        invitations.append((account, issue_token(db, account, "invite", actor)))

    imp.status, imp.committed_at = "committed", now()
    audit(db, actor, "faculty_import.committed", "faculty_import", imp.id,
          {"created": len(invitations), "existing": len(rows) - len(invitations)})
    db.commit()

    failed = []
    for account, token in invitations:
        try:
            send_link(account, token, "invite")
        except HTTPException:
            failed.append(account.email)
    return {"created": len(invitations), "existing": len(rows) - len(invitations),
            "email_failed": failed}
