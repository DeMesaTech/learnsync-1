from sqlalchemy import select
from sqlalchemy.orm import Session

from .commands import audit
from .models import Account
from .names import StudentName, format_student_name, normalize_faculty_name_parts


def plan_faculty_name_correction(
    db: Session,
) -> tuple[list[tuple[Account, StudentName]], dict[str, int]]:
    accounts = db.scalars(
        select(Account).where(Account.role == "faculty").order_by(Account.id)
    ).all()
    plan = []
    counts = {
        "faculty_accounts": len(accounts),
        "changed": 0,
        "unchanged": 0,
        "unresolved": 0,
    }
    for account in accounts:
        original = StudentName(
            account.first_name or "",
            account.middle_name or "",
            account.last_name or "",
            account.suffix or "",
        )
        corrected = normalize_faculty_name_parts(original)
        if not corrected:
            counts["unresolved"] += 1
            continue
        display_name = format_student_name(corrected)
        if (
            len(corrected.first_name) > 100
            or len(corrected.middle_name) > 100
            or len(corrected.last_name) > 100
            or len(corrected.suffix) > 20
            or len(display_name) > 150
        ):
            counts["unresolved"] += 1
            continue
        if (
            original.first_name,
            original.middle_name,
            original.last_name,
            original.suffix,
            account.display_name,
        ) == (
            corrected.first_name,
            corrected.middle_name,
            corrected.last_name,
            corrected.suffix,
            display_name,
        ):
            counts["unchanged"] += 1
            continue
        counts["changed"] += 1
        plan.append((account, corrected))
    return plan, counts


def apply_faculty_name_correction(db: Session) -> dict[str, int]:
    plan, counts = plan_faculty_name_correction(db)
    for account, name in plan:
        account.first_name = name.first_name
        account.middle_name = name.middle_name or None
        account.last_name = name.last_name
        account.suffix = name.suffix or None
        account.display_name = format_student_name(name)
    if plan:
        audit(db, None, "account.faculty_names_corrected", "account_names",
              "faculty-name-correction", {
                  "accounts_updated": len(plan),
                  "unresolved": counts["unresolved"],
              })
    db.commit()
    return counts
