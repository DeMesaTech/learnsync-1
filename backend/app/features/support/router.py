from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import fail
from app.security import current_account, require_role

from . import issues

router = APIRouter(prefix="/api", tags=["Support"])
admin = require_role("admin")


def reporter(account=Depends(current_account)):
    if account.role == "admin":
        fail(403, "role_forbidden", "Administrators review reports; they do not send them.")
    return account


@router.post("/issues", status_code=201)
def create_issue(data: issues.IssueIn, actor=Depends(reporter), db: Session = Depends(get_db)):
    return issues.create(db, actor, data)


@router.get("/issues")
def my_issues(limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
              actor=Depends(reporter), db: Session = Depends(get_db)):
    return issues.mine(db, actor, limit, offset)


@router.get("/admin/issues")
def all_issues(status: Literal["open", "in_progress", "resolved"] | None = None,
               type: Literal["bug", "account", "content", "other"] | None = None,
               q: str = Query("", max_length=100), page: int = Query(1, ge=1),
               page_size: int = Query(25, ge=1, le=100),
               actor=Depends(admin), db: Session = Depends(get_db)):
    return issues.listing(db, status, type, q, page, page_size)


@router.patch("/admin/issues/{issue_id}")
def review_issue(issue_id: UUID, data: issues.IssueReview, actor=Depends(admin),
                 db: Session = Depends(get_db)):
    return issues.review(db, actor, issue_id, data)
