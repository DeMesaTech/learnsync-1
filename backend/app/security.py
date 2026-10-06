import hashlib
import secrets
from collections import defaultdict, deque
from datetime import timedelta
from threading import Lock
from time import monotonic

from fastapi import Depends, Request, Response
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .errors import fail
from .features.accounts.models import Account, AuthSession, now

passwords = PasswordHash.recommended()
_dummy_hash = passwords.hash("a-dummy-password-for-timing")
# ponytail: single-process pilot limiter; use shared storage before running multiple workers.
_limits = defaultdict(deque)
_limit_lock = Lock()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def rate_limit(key, limit=5):
    stamp = monotonic()
    with _limit_lock:
        bucket = _limits[key]
        while bucket and bucket[0] < stamp - 60:
            bucket.popleft()
        if len(bucket) >= limit:
            fail(429, "rate_limited", "Please wait a minute and try again.")
        bucket.append(stamp)
        if len(_limits) > 10000:
            for old_key in list(_limits):
                if not _limits[old_key] or _limits[old_key][-1] < stamp - 60:
                    del _limits[old_key]


def verify_password(value, stored):
    valid = passwords.verify(value, stored or _dummy_hash)
    return bool(stored) and valid


def new_session(db, response: Response, account_id=None):
    token = secrets.token_urlsafe(32)
    session = AuthSession(account_id=account_id, token_hash=digest(token),
                          csrf=secrets.token_urlsafe(32),
                          expires_at=now() + timedelta(seconds=settings().session_max_age_seconds))
    db.add(session)
    db.flush()
    response.set_cookie(settings().session_cookie_name, token, httponly=True,
                        secure=settings().session_cookie_secure, samesite="lax", path="/",
                        max_age=settings().session_max_age_seconds)
    return session


def load_session(request: Request, db: Session):
    token = request.cookies.get(settings().session_cookie_name)
    if not token:
        return None
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == digest(token)))
    if not session or session.revoked_at or session.expires_at <= now():
        return None
    if session.last_seen_at + timedelta(seconds=settings().session_idle_timeout_seconds) <= now():
        return None
    return session


def csrf_session(request: Request, db: Session = Depends(get_db)):
    session = load_session(request, db)
    if not session:
        fail(401, "session_expired", "Your session expired. Sign in again.")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if request.headers.get("origin") != settings().app_origin:
            fail(403, "origin_invalid", "This request did not come from the application.")
        if not secrets.compare_digest(request.headers.get("x-csrf-token", ""), session.csrf):
            fail(403, "csrf_invalid", "Refresh the page and try again.")
    return session


def current_account(session=Depends(csrf_session), db: Session = Depends(get_db)):
    account = db.get(Account, session.account_id) if session.account_id else None
    if not account or account.status != "active":
        fail(401, "authentication_required", "Sign in to continue.")
    if session.last_seen_at + timedelta(seconds=60) < now():
        session.last_seen_at = now()
        db.commit()
    return account


def require_role(role):
    def dependency(account=Depends(current_account)):
        if account.role != role:
            fail(403, "role_forbidden", "Your account cannot perform this action.")
        return account
    return dependency
