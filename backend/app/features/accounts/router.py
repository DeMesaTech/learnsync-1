from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import fail
from app.security import (
    csrf_session,
    current_account,
    load_session,
    new_session,
    rate_limit,
    require_role,
    verify_password,
)

from . import commands, queries
from .models import Account, now
from .schemas import (
    AcceptToken,
    AccountStatus,
    AccountView,
    BulkSendLinks,
    EmailRequest,
    Handover,
    Invite,
    Login,
    Preferences,
)

router = APIRouter(prefix="/api", tags=["Accounts"])
admin = require_role("admin")

@router.get("/auth/session")
def session_info(request: Request, response: Response, db: Session = Depends(get_db)):
    session = load_session(request, db)
    if not session:
        rate_limit(("anonymous_session", request.client.host), 30)
        session = new_session(db, response)
        db.commit()
    account = db.get(Account, session.account_id) if session.account_id else None
    if account and account.status != "active":
        account = None
    return {"user": AccountView.model_validate(account) if account else None, "csrf": session.csrf}

@router.post("/auth/login")
def login(data: Login, request: Request, response: Response,
          session=Depends(csrf_session), db: Session = Depends(get_db)):
    email = str(data.email).lower()
    rate_limit(("login_ip", request.client.host))
    rate_limit(("login_account", email))
    account = db.scalar(select(Account).where(Account.email == email))
    if not verify_password(data.password, account.password_hash if account else None):
        fail(401, "login_invalid", "Email or password is incorrect.")
    if account.status != "active":
        fail(401, "login_invalid", "Email or password is incorrect.")
    session.revoked_at = now()
    rotated = new_session(db, response, account.id)
    commands.audit(db, account, "account.signed_in", "account", account.id)
    db.commit()
    return {"user": AccountView.model_validate(account), "csrf": rotated.csrf}

@router.post("/auth/logout")
def logout(response: Response, session=Depends(csrf_session), db: Session = Depends(get_db)):
    session.revoked_at = now()
    db.commit()
    from app.config import settings
    response.delete_cookie(settings().session_cookie_name, path="/")
    return {"message": "Signed out."}

@router.post("/auth/reset-request", status_code=202)
def request_reset(data: EmailRequest, request: Request, session=Depends(csrf_session),
                  db: Session = Depends(get_db)):
    email = str(data.email).lower()
    rate_limit(("reset_ip", request.client.host), 5)
    rate_limit(("reset_account", email), 2)
    account = db.scalar(select(Account).where(Account.email == email, Account.status == "active"))
    if account:
        token = commands.issue_token(db, account, "reset")
        commands.send_link(account, token, "reset")
        db.commit()
    return {"message": "If an active account exists, a reset link has been sent."}

@router.post("/auth/accept-invitation")
def accept_invitation(data: AcceptToken, session=Depends(csrf_session), db: Session = Depends(get_db)):
    commands.consume_token(db, data, {"invite", "handover"})
    return {"message": "Your account is ready. Sign in with your new password."}

@router.post("/auth/reset-password")
def reset_password(data: AcceptToken, session=Depends(csrf_session), db: Session = Depends(get_db)):
    commands.consume_token(db, data, {"reset"})
    return {"message": "Password changed. Sign in again."}

@router.get("/accounts", response_model=list[AccountView])
def accounts(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
             search: str = Query("", max_length=150),
             role: str | None = Query(None, pattern="^(admin|faculty|student)$"),
             status: str | None = Query(None, pattern="^(invited|active|inactive)$"),
             actor=Depends(admin), db: Session = Depends(get_db)):
    return queries.list_accounts(db, page, page_size, search, role, status)


@router.get("/accounts/count")
def account_count(search: str = Query("", max_length=150),
                  role: str | None = Query(None, pattern="^(admin|faculty|student)$"),
                  status: str | None = Query(None, pattern="^(invited|active|inactive)$"),
                  actor=Depends(admin), db: Session = Depends(get_db)):
    return {"total": queries.count_accounts(db, search, role, status)}

@router.post("/accounts", response_model=AccountView, status_code=201)
def invite(data: Invite, actor=Depends(admin), db: Session = Depends(get_db)):
    return commands.invite(db, actor, data)

@router.patch("/accounts/{account_id}/status", response_model=AccountView)
def change_status(account_id: UUID, data: AccountStatus, actor=Depends(admin), db: Session = Depends(get_db)):
    account = db.get(Account, account_id)
    if not account:
        fail(404, "not_found", "Account not found.")
    commands.set_status(db, actor, account, data.status)
    return account

@router.post("/accounts/{account_id}/send-link")
def resend(account_id: UUID, actor=Depends(admin), db: Session = Depends(get_db)):
    account = db.get(Account, account_id)
    if not account or account.status == "inactive":
        fail(404, "not_found", "Active or invited account not found.")
    rate_limit(("admin_send", str(account_id)), 2)
    purpose = "invite" if account.status == "invited" else "reset"
    token = commands.issue_token(db, account, purpose, actor)
    commands.send_link(account, token, purpose)
    commands.audit(db, actor, "account.link_sent", "account", account.id, {"purpose": purpose})
    db.commit()
    return {"message": "Link sent."}

@router.post("/accounts/send-links")
def send_account_links(data: BulkSendLinks, actor=Depends(admin), db: Session = Depends(get_db)):
    return commands.send_links(db, actor, data.account_ids)

@router.post("/accounts/{account_id}/handover")
def handover(account_id: UUID, data: Handover, actor=Depends(admin), db: Session = Depends(get_db)):
    account = db.get(Account, account_id)
    if not account or account.role != "admin" or account.status != "active":
        fail(404, "not_found", "Active admin account not found.")
    token = commands.issue_token(db, account, "handover", actor, data.model_dump())
    commands.send_link(account, token, "handover")
    commands.audit(db, actor, "account.handover_initiated", "account", account.id, data.model_dump())
    db.commit()
    return {"message": "Handover link sent to the institutional email."}

@router.patch("/me/preferences", response_model=AccountView)
def preferences(data: Preferences, actor=Depends(current_account), db: Session = Depends(get_db)):
    actor.preferences = data.model_dump()
    db.commit()
    return actor

@router.get("/audit")
def audit(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
          actor=Depends(admin), db: Session = Depends(get_db)):
    return [{"id": row.id, "actor": row.actor_label, "action": row.action,
             "entity_type": row.entity_type, "entity_id": row.entity_id,
             "details": row.details, "created_at": row.created_at}
            for row in queries.list_audit(db, page, page_size)]
