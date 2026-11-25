import logging
import secrets
import smtplib
from datetime import timedelta
from email.message import EmailMessage

from fastapi import HTTPException
from sqlalchemy import select, update

from app.config import settings
from app.errors import fail
from app.security import digest, passwords, rate_limit

from .models import Account, AccountToken, AuditEvent, AuthSession, now
from .names import format_student_name, split_faculty_name, split_student_name


def audit(db, actor, action, entity_type, entity_id, details=None, actor_label=None):
    db.add(AuditEvent(actor_id=actor.id if actor else None,
                      actor_label=actor_label or (actor.display_name if actor else "setup"),
                      ownership_generation=actor.ownership_generation if actor else None,
                      action=action, entity_type=entity_type, entity_id=str(entity_id),
                      details=details or {}))


def issue_token(db, account, purpose, actor=None, payload=None):
    db.execute(update(AccountToken).where(AccountToken.account_id == account.id,
               AccountToken.purpose == purpose, AccountToken.consumed_at.is_(None))
               .values(consumed_at=now()))
    raw = secrets.token_urlsafe(32)
    ttl = settings().reset_ttl_seconds if purpose == "reset" else settings().invitation_ttl_seconds
    db.add(AccountToken(account_id=account.id, purpose=purpose, token_hash=digest(raw),
                        expires_at=now() + timedelta(seconds=ttl),
                        initiated_by=actor.id if actor else None, payload=payload or {}))
    db.flush()
    return raw


SUBJECTS = {"invite": "You are invited to LearnSync: set up your account",
            "reset": "Reset your LearnSync password",
            "handover": "LearnSync: confirm the administrator ownership transfer"}
logger = logging.getLogger("learnsync.imports")


def send_link_to(email, display_name, raw, purpose):
    route = "reset-password" if purpose == "reset" else "accept-invitation"
    message = EmailMessage()
    message["From"] = settings().mail_from
    message["To"] = email
    message["Subject"] = SUBJECTS.get(purpose, "LearnSync account link")
    message.set_content(f"Hello {display_name},\n\nOpen this single-use link to choose your password:\n"
                        f"{settings().app_origin}/{route}#token={raw}\n\n"
                        "If you did not expect this message, contact your school administrator.")
    try:
        with smtplib.SMTP(settings().smtp_host, settings().smtp_port, timeout=10) as smtp:
            if settings().smtp_use_tls:
                smtp.starttls()
            if settings().smtp_username:
                smtp.login(settings().smtp_username, settings().smtp_password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException):
        fail(503, "email_unavailable", "Email could not be sent. Please try again.")


def send_link(account, raw, purpose):
    send_link_to(account.email, account.display_name, raw, purpose)


def send_import_invitation_batch(invitations, import_type, import_id):
    failed = 0
    for email, display_name, token in invitations:
        try:
            send_link_to(email, display_name, token, "invite")
        except HTTPException:
            failed += 1
    if failed:
        logger.warning("%s invitation delivery failed: import_id=%s failed=%s total=%s",
                       import_type, import_id, failed, len(invitations))


def invite(db, actor, data):
    email = str(data.email).lower()
    if data.role == "faculty":
        if data.college_id is not None:
            from app.features.academics.models import College
            college = db.get(College, data.college_id)
            if not college or college.status != "active":
                fail(422, "college_unavailable", "Choose an active college/program for this teacher.")
    elif data.college_id is not None:
        fail(422, "college_role_mismatch", "Only faculty accounts can be assigned to a college/program.")
    if db.scalar(select(Account.id).where(Account.email == email)):
        fail(409, "email_exists", "An account already uses this email.")
    if data.student_number and db.scalar(select(Account.id).where(Account.student_number == data.student_number)):
        fail(409, "student_number_exists", "An account already uses this student number.")
    account = Account(email=email, display_name=data.display_name, role=data.role,
                      first_name=data.first_name, middle_name=data.middle_name,
                      last_name=data.last_name, suffix=data.suffix,
                      college_id=data.college_id if data.role == "faculty" else None,
                      student_number=data.student_number, status="invited")
    db.add(account)
    db.flush()
    token = issue_token(db, account, "invite", actor)
    audit(db, actor, "account.invited", "account", account.id)
    send_link(account, token, "invite")
    db.commit()
    return account


def set_faculty_college(db, actor, account, college_id):
    if account.role != "faculty":
        fail(409, "not_faculty", "Only faculty accounts can be assigned to a college/program.")
    if college_id is not None:
        from app.features.academics.models import College
        college = db.get(College, college_id)
        if not college or college.status != "active":
            fail(422, "college_unavailable", "Choose an active college/program for this teacher.")
    previous_college_id = account.college_id
    if previous_college_id == college_id:
        return account
    account.college_id = college_id
    audit(db, actor, "account.faculty_college_updated", "account", account.id, {
        "previous_college_id": str(previous_college_id) if previous_college_id else None,
        "college_id": str(college_id) if college_id else None,
    })
    db.commit()
    return account


def update_faculty_profile(db, actor, account, data):
    if account.role != "faculty":
        fail(409, "not_faculty", "Only faculty accounts can be edited here.")
    if data.college_id is not None and data.college_id != account.college_id:
        from app.features.academics.models import College
        college = db.get(College, data.college_id)
        if not college or college.status != "active":
            fail(422, "college_unavailable", "Choose an active college/program for this teacher.")

    email = str(data.email).lower()
    if db.scalar(select(Account.id).where(Account.email == email, Account.id != account.id)):
        fail(409, "email_exists", "Another account already uses this email.")
    name_changed = account.display_name != data.display_name
    name_parts = split_faculty_name(data.display_name) if name_changed else None
    changed = {
        field for field, value in (
            ("display_name", data.display_name),
            ("email", email),
            ("college_id", data.college_id),
        ) if getattr(account, field) != value
    }
    if name_parts:
        changed.update(field for field, value in (
            ("first_name", name_parts.first_name),
            ("middle_name", name_parts.middle_name or None),
            ("last_name", name_parts.last_name),
            ("suffix", name_parts.suffix or None),
        ) if getattr(account, field) != value)
    if not changed:
        return account
    email_changed = account.email != email
    if email_changed and account.status == "inactive":
        fail(409, "account_inactive", "Reactivate the account before changing its email.")

    previous_college_id = account.college_id
    if name_parts:
        account.display_name = data.display_name
        account.first_name = name_parts.first_name
        account.middle_name = name_parts.middle_name or None
        account.last_name = name_parts.last_name
        account.suffix = name_parts.suffix or None
    account.email = email
    account.college_id = data.college_id
    if email_changed:
        account.email_verified_at = None
        account.status = "invited"
        db.execute(update(AuthSession).where(
            AuthSession.account_id == account.id).values(revoked_at=now()))
        db.execute(update(AccountToken).where(
            AccountToken.account_id == account.id,
            AccountToken.consumed_at.is_(None)).values(consumed_at=now()))
        token = issue_token(db, account, "invite", actor)
        send_link(account, token, "invite")
    audit(db, actor, "account.faculty_profile_updated", "account", account.id, {
        "fields": sorted(changed),
        "previous_college_id": str(previous_college_id) if previous_college_id else None,
        "college_id": str(data.college_id) if data.college_id else None,
        "email_changed_requires_verification": email_changed,
    })
    db.commit()
    return account


def consume_token(db, data, purposes):
    token = db.scalar(select(AccountToken).where(AccountToken.token_hash == digest(data.token))
                      .with_for_update())
    if not token or token.purpose not in purposes or token.consumed_at or token.expires_at <= now():
        fail(422, "token_invalid", "This link is invalid or expired. Request a new one.")
    account = db.scalar(select(Account).where(Account.id == token.account_id).with_for_update())
    if account.status == "inactive":
        fail(403, "account_inactive", "Contact your administrator to reactivate this account.")
    if token.purpose == "handover":
        audit(db, account, "account.handed_over", "account", account.id,
              {"previous_owner": account.display_name, "incoming_owner": token.payload["incoming_owner"],
               "reason": token.payload["reason"]})
        parts = split_student_name(token.payload["incoming_owner"])
        account.display_name = format_student_name(parts)
        account.first_name = parts.first_name
        account.middle_name = parts.middle_name or None
        account.last_name = parts.last_name
        account.suffix = parts.suffix or None
        account.ownership_generation += 1
    else:
        audit(db, account, f"account.{token.purpose}_accepted", "account", account.id)
    account.password_hash = passwords.hash(data.password)
    account.status = "active"
    account.email_verified_at = account.email_verified_at or now()
    token.consumed_at = now()
    db.execute(update(AuthSession).where(AuthSession.account_id == account.id).values(revoked_at=now()))
    db.execute(update(AccountToken).where(AccountToken.account_id == account.id,
               AccountToken.consumed_at.is_(None)).values(consumed_at=now()))
    db.commit()
    return account


def set_status(db, actor, account, status):
    # Lock all admins in a stable order: concurrent deactivation cannot remove the last admin.
    admins = db.scalars(select(Account).where(Account.role == "admin").order_by(Account.id)
                        .with_for_update().execution_options(populate_existing=True)).all()
    if account.status == "invited":
        fail(409, "activation_required", "An invited account must first accept its invitation.")
    if (
        account.role == "admin"
        and status == "inactive"
        and account.status == "active"
        and sum(a.status == "active" for a in admins) <= 1
    ):
        fail(409, "last_admin", "Keep at least one active admin account.")
    account.status = status
    if status == "inactive":
        db.execute(update(AuthSession).where(AuthSession.account_id == account.id).values(revoked_at=now()))
        db.execute(update(AccountToken).where(AccountToken.account_id == account.id,
                   AccountToken.consumed_at.is_(None)).values(consumed_at=now()))
    audit(db, actor, "account.status_changed", "account", account.id, {"status": status})
    db.commit()


def send_links(db, actor, account_ids):
    accounts = db.scalars(select(Account).where(Account.id.in_(account_ids))).all()
    by_id = {account.id: account for account in accounts}
    if len(by_id) != len(account_ids):
        fail(404, "account_not_found", "One or more selected accounts were not found.")
    if any(by_id[account_id].status == "inactive" for account_id in account_ids):
        fail(409, "account_inactive", "Inactive accounts cannot receive account links.")

    results = []
    for account_id in account_ids:
        account = by_id[account_id]
        purpose = "invite" if account.status == "invited" else "reset"
        try:
            rate_limit(("admin_send", str(account.id)), 2)
            token = issue_token(db, account, purpose, actor)
            send_link(account, token, purpose)
            audit(db, actor, "account.link_sent", "account", account.id, {"purpose": purpose})
            db.commit()
            results.append({"id": account.id, "email": account.email, "status": "sent",
                            "message": "Link sent."})
        except HTTPException as exc:
            db.rollback()
            detail = exc.detail
            message = detail.get("message", "Email could not be sent.") if isinstance(detail, dict) else str(detail)
            results.append({"id": account_id, "email": account.email, "status": "failed",
                            "message": message})

    return {"sent": sum(result["status"] == "sent" for result in results),
            "failed": sum(result["status"] == "failed" for result in results),
            "results": results}
