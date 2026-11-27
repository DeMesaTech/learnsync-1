"""Reviewed faculty imports. Preview is read-only; commit revalidates before creating invites."""
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select

from app.errors import fail
from app.features.academics.documents import MAX_ROWS, read_faculty_rows
from app.features.accounts.commands import audit
from app.features.accounts.models import Account, AuditEvent, FacultyImport, now
from app.features.accounts.names import (
    StudentName,
    canonical_suffix,
    format_student_name,
    normalize_faculty_name_parts,
    split_faculty_name,
    suffix_from_last_name,
)
from app.features.files.storage import path_of, save_upload

EMAIL = TypeAdapter(EmailStr)
FACULTY_TYPES = {".csv", ".xlsx"}


def faculty_name(row):
    if "first_name" in row or "last_name" in row:
        last_name, detected_suffix = suffix_from_last_name(str(row.get("last_name") or "").strip())
        supplied_suffix = str(row.get("suffix") or "").strip()
        suffix = canonical_suffix(supplied_suffix)
        name = normalize_faculty_name_parts(StudentName(
            str(row.get("first_name") or "").strip(),
            str(row.get("middle_name") or "").strip(),
            last_name,
            suffix or detected_suffix,
        ))
        if supplied_suffix and not suffix:
            return None, "Use a valid generational suffix such as Jr., Sr., II, or III."
        return name, None
    return split_faculty_name(str(row.get("display_name") or "")), None


def validate_faculty(db, rows):
    from app.features.academics.models import College

    emails = {row["email"].strip().lower() for row in rows}
    existing = {account.email: account for account in db.scalars(
        select(Account).where(Account.email.in_(emails)))}
    college_ids = {UUID(row["college_id"]) for row in rows if row.get("college_id")}
    colleges = {college.id for college in db.scalars(
        select(College).where(College.id.in_(college_ids), College.status == "active"))} \
        if college_ids else set()
    seen, results = {}, []
    for raw in rows:
        email = raw["email"].strip().lower()
        errors = []
        try:
            email = str(EMAIL.validate_python(email)).lower()
        except ValidationError:
            errors.append("Email address is not valid.")
        parts, name_error = faculty_name(raw)
        if name_error:
            errors.append(name_error)
        if not parts or not parts.first_name or not parts.last_name:
            errors.append("Enter a teacher's first and last name without a title.")
            parts = StudentName("", "", "", "")
        elif (len(parts.first_name) > 100 or len(parts.middle_name) > 100
              or len(parts.last_name) > 100 or len(parts.suffix) > 20):
            errors.append("Name fields exceed their maximum lengths.")
        normalized_name = format_student_name(parts)
        if len(normalized_name) > 150:
            errors.append("Formatted teacher name must be at most 150 characters.")
        college_id = UUID(raw["college_id"]) if raw.get("college_id") else None
        if college_id is not None and college_id not in colleges:
            errors.append("College/program is unavailable.")
        if email in seen:
            errors.append(f"Email repeats row {seen[email]}.")
        seen.setdefault(email, raw["row"])
        account = existing.get(email)
        if account and account.role != "faculty":
            errors.append("Email already belongs to a different account.")
        results.append({"row": raw["row"], "display_name": normalized_name,
                        "first_name": parts.first_name, "middle_name": parts.middle_name,
                        "last_name": parts.last_name, "suffix": parts.suffix, "email": email,
                        "college_id": str(college_id) if college_id else None,
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


def update_faculty_import(db, actor, import_id, rows):
    imp = db.scalar(select(FacultyImport).where(FacultyImport.id == import_id).with_for_update())
    if not imp:
        fail(404, "not_found", "Import not found.")
    if imp.status == "committed":
        fail(409, "import_committed", "This import was already committed.")
    updates = {row.row: row for row in rows}
    if set(updates) != {row["row"] for row in imp.rows}:
        fail(422, "import_rows_mismatch", "Edit the existing preview rows without adding or removing rows.")
    from app.features.academics.models import College
    for row in updates.values():
        if row.college_id is not None:
            college = db.get(College, row.college_id)
            if not college or college.status != "active":
                fail(422, "college_unavailable", "Choose an active college/program for each new teacher.")
    edited = []
    for row in imp.rows:
        update = updates[row["row"]]
        changed = {**row, "email": update.email,
                   "college_id": str(update.college_id) if update.college_id else None}
        if update.first_name is None and update.last_name is None:
            changed["display_name"] = update.display_name
            for field in ("first_name", "middle_name", "last_name", "suffix"):
                changed.pop(field, None)
        else:
            changed.update(first_name=update.first_name, middle_name=update.middle_name,
                           last_name=update.last_name, suffix=update.suffix)
        edited.append(changed)
    imp.rows = edited
    audit(db, actor, "faculty_import.edited", "faculty_import", imp.id,
          {"rows": len(imp.rows)})
    db.commit()
    return imp


def commit_faculty_import(db, actor, import_id):
    imp = db.scalar(select(FacultyImport).where(FacultyImport.id == import_id).with_for_update())
    if not imp:
        fail(404, "not_found", "Import not found.")
    if imp.status == "committed":
        event = db.scalar(select(AuditEvent).where(
            AuditEvent.action == "faculty_import.committed",
            AuditEvent.entity_type == "faculty_import",
            AuditEvent.entity_id == str(imp.id),
        ))
        if not event:
            fail(409, "import_result_unavailable", "This import was committed, but its result is unavailable.")
        return {**event.details, "email_scheduled": 0, "already_committed": True}
    rows = validate_faculty(db, imp.rows)
    if any(row["status"] == "error" for row in rows):
        fail(409, "import_has_errors",
             "Fix the highlighted rows and upload the file again. Nothing was imported.")

    created = 0
    for row in rows:
        if row["status"] != "new":
            continue
        account = Account(email=row["email"], display_name=row["display_name"],
                          first_name=row["first_name"], middle_name=row["middle_name"] or None,
                          last_name=row["last_name"], suffix=row["suffix"] or None,
                          role="faculty",
                          college_id=UUID(row["college_id"]) if row.get("college_id") else None,
                          status="invited")
        db.add(account)
        created += 1

    imp.status, imp.committed_at = "committed", now()
    audit(db, actor, "faculty_import.committed", "faculty_import", imp.id,
          {"created": created, "existing": len(rows) - created})
    db.commit()
    return {"created": created, "existing": len(rows) - created,
            "email_scheduled": 0, "already_committed": False}
