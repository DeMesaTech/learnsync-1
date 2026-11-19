import re
from pathlib import Path

import openpyxl
from sqlalchemy import select
from sqlalchemy.orm import Session

from .commands import audit
from .models import Account
from .names import (
    StudentName,
    format_student_name,
    normalized_name,
    split_student_name,
    suffix_from_last_name,
)


def _header(value) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def _text(value) -> str:
    return "" if value is None else str(value).strip()


def _source_names(path: Path) -> tuple[dict[str, list[StudentName]], set[str], int]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    names: dict[str, list[StudentName]] = {}
    conflicts: set[str] = set()
    duplicate_rows = 0
    aliases = {
        "student_number": "student_number",
        "student_no": "student_number",
        "id_number": "student_number",
        "firstname": "first_name",
        "first_name": "first_name",
        "given_name": "first_name",
        "lastname": "last_name",
        "last_name": "last_name",
        "surname": "last_name",
        "middleinitial": "middle_name",
        "middle_initial": "middle_name",
        "middlename": "middle_name",
        "middle_name": "middle_name",
        "suffix": "suffix",
        "generational_suffix": "suffix",
    }
    try:
        for sheet in workbook.worksheets:
            header_row = None
            columns = {}
            for row_number, row in enumerate(
                    sheet.iter_rows(min_row=1, max_row=25, values_only=True), start=1):
                mapped = {
                    aliases[header]: index
                    for index, value in enumerate(row)
                    if (header := _header(value)) in aliases
                }
                student_number = mapped.get("student_number")
                first_name = mapped.get("first_name")
                last_name = mapped.get("last_name")
                if student_number is not None and first_name is not None and last_name is not None:
                    header_row, columns = row_number, mapped
                    break
            if header_row is None:
                continue
            middle_index = columns.get("middle_initial", columns.get("middle_name"))
            suffix_index = columns.get("suffix", columns.get("generational_suffix"))
            for row in sheet.iter_rows(min_row=header_row + 1, values_only=True):
                student_number = _text(row[columns["student_number"]]
                                       if columns["student_number"] < len(row) else "")
                if not student_number:
                    continue
                first_name = _text(row[columns["first_name"]]
                                   if columns["first_name"] < len(row) else "")
                middle_name = _text(row[middle_index]
                                    if middle_index is not None and middle_index < len(row) else "")
                last_name = _text(row[columns["last_name"]]
                                  if columns["last_name"] < len(row) else "")
                suffix = _text(row[suffix_index]
                               if suffix_index is not None and suffix_index < len(row) else "")
                last_name, detected_suffix = suffix_from_last_name(last_name)
                candidate = StudentName(
                    first_name, middle_name, last_name, suffix or detected_suffix)
                previous = names.get(student_number)
                if previous:
                    duplicate_rows += 1
                    same_as_previous = any(
                        tuple(normalized_name(part) for part in (
                            existing.first_name, existing.middle_name, existing.last_name,
                            existing.suffix))
                        == tuple(normalized_name(part) for part in (
                            candidate.first_name, candidate.middle_name, candidate.last_name,
                            candidate.suffix))
                        for existing in previous
                    )
                    if not same_as_previous:
                        conflicts.add(student_number)
                names.setdefault(student_number, []).append(candidate)
    finally:
        workbook.close()
    return names, conflicts, duplicate_rows


def _source_order_name(name: StudentName) -> str:
    return " ".join(part for part in (
        name.first_name, name.middle_name, name.last_name, name.suffix) if part)


def plan_account_name_backfill(db: Session, source: Path) -> tuple[list[tuple[Account, StudentName, str]], dict]:
    source_names, source_conflicts, duplicate_rows = _source_names(source)
    accounts = db.scalars(select(Account).order_by(Account.role, Account.id)).all()
    plan = []
    counts = {
        "accounts": len(accounts),
        "source_exact": 0,
        "fallback_parsed": 0,
        "already_structured": 0,
        "unparsed": 0,
        "source_conflicts": len(source_conflicts),
        "duplicate_source_rows": duplicate_rows,
        "changed": 0,
    }
    for account in accounts:
        if account.first_name and account.last_name:
            name = StudentName(account.first_name, account.middle_name or "",
                               account.last_name, account.suffix or "")
            method = "already_structured"
            counts[method] += 1
        else:
            candidates = source_names.get(account.student_number or "", []) \
                if account.role == "student" else []
            candidate = next((item for item in candidates
                              if normalized_name(account.display_name)
                              == normalized_name(_source_order_name(item))), None)
            if candidate:
                name = candidate
                method = "source_exact"
                counts[method] += 1
            else:
                name = split_student_name(account.display_name)
                method = "fallback_parsed"
                counts[method] += 1
        if not name.first_name or not name.last_name:
            counts["unparsed"] += 1
            continue
        if (len(name.first_name) > 100 or len(name.middle_name) > 100
                or len(name.last_name) > 100 or len(name.suffix) > 20):
            counts["unparsed"] += 1
            continue
        display_name = format_student_name(name)
        if len(display_name) > 150:
            counts["unparsed"] += 1
            continue
        if (account.first_name, account.middle_name or "", account.last_name,
                account.suffix or "", account.display_name) != (
                name.first_name, name.middle_name, name.last_name,
                name.suffix, display_name):
            counts["changed"] += 1
            plan.append((account, name, method))
    return plan, counts


def apply_account_name_backfill(db: Session, source: Path) -> dict:
    plan, counts = plan_account_name_backfill(db, source)
    if counts["unparsed"]:
        raise ValueError(f"{counts['unparsed']} account names could not be split safely.")
    for account, name, _method in plan:
        account.first_name = name.first_name
        account.middle_name = name.middle_name or None
        account.last_name = name.last_name
        account.suffix = name.suffix or None
        account.display_name = format_student_name(name)
    if plan:
        audit(db, None, "account.names_split", "account_names", "bulk-backfill", {
            "accounts_updated": len(plan),
            "source_exact": counts["source_exact"],
            "fallback_parsed": counts["fallback_parsed"],
        })
    db.commit()
    return counts
