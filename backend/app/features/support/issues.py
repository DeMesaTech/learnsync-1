from datetime import timedelta
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.errors import fail
from app.features.accounts.commands import audit
from app.features.accounts.models import Account, now

from .models import IssueReport

HOURLY_LIMIT = 10


class IssueIn(BaseModel):
    type: Literal["bug", "account", "content", "other"]
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=10, max_length=4000)
    page: str = Field(default="", max_length=200)


class IssueReview(BaseModel):
    status: Literal["open", "in_progress", "resolved"] | None = None
    admin_note: str | None = Field(default=None, max_length=2000)


def local_path(value):
    """Only where in the app it happened: a path, never a query string or fragment (those can hold
    tokens or personal data), and nothing that is not a local path."""
    path = value.strip().split("?")[0].split("#")[0]
    return path[:200] if path.startswith("/") and not path.startswith("//") else ""


def own_view(i):
    return {"id": i.id, "type": i.type, "title": i.title, "description": i.description,
            "page": i.page, "status": i.status, "admin_note": i.admin_note,
            "created_at": i.created_at, "updated_at": i.updated_at}


def admin_view(db, i):
    who = db.get(Account, i.reporter_id)
    return {**own_view(i), "reporter": {"id": who.id, "name": who.display_name,
                                        "email": who.email, "role": who.role},
            "reviewed_at": i.reviewed_at}


def create(db, actor, data):
    recent = db.scalar(select(func.count()).select_from(IssueReport).where(
        IssueReport.reporter_id == actor.id, IssueReport.created_at > now() - timedelta(hours=1)))
    if recent >= HOURLY_LIMIT:
        fail(429, "too_many_reports", "You have sent several reports in the last hour. Please wait "
                                     "before sending another, or add detail to an open report.")
    issue = IssueReport(reporter_id=actor.id, type=data.type, title=data.title.strip(),
                        description=data.description.strip(), page=local_path(data.page))
    db.add(issue)
    db.commit()
    return own_view(issue)


def mine(db, actor, limit=25, offset=0):
    rows = db.scalars(select(IssueReport).where(IssueReport.reporter_id == actor.id)
                      .order_by(IssueReport.created_at.desc(), IssueReport.id).offset(offset).limit(limit + 1)).all()
    return {"items": [own_view(i) for i in rows[:limit]], "has_more": len(rows) > limit}


def listing(db, status, kind=None, search="", page=1, page_size=25):
    """Newest first, one page at a time. `counts` is by status over everything; `total` is this filter's size."""
    query = select(IssueReport)
    if status:
        query = query.where(IssueReport.status == status)
    if kind:
        query = query.where(IssueReport.type == kind)
    if search.strip():
        like = f"%{search.strip()}%"
        query = query.where(IssueReport.title.ilike(like) | IssueReport.description.ilike(like))
    counts = dict(db.execute(select(IssueReport.status, func.count()).group_by(IssueReport.status)).all())
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(IssueReport.created_at.desc(), IssueReport.id)
                      .offset((page - 1) * page_size).limit(page_size))
    return {"counts": {s: counts.get(s, 0) for s in ("open", "in_progress", "resolved")},
            "total": total, "page": page, "page_size": page_size,
            "issues": [admin_view(db, i) for i in rows]}


def review(db, actor, issue_id, data):
    issue = db.get(IssueReport, issue_id)
    if not issue:
        fail(404, "not_found", "Report not found.")
    before = issue.status
    if data.status is not None:
        issue.status = data.status
    if data.admin_note is not None:
        issue.admin_note = data.admin_note.strip()
    issue.reviewed_by, issue.reviewed_at = actor.id, now()
    audit(db, actor, "issue.reviewed", "issue_report", issue.id,
          {"from": before, "to": issue.status, "note_changed": data.admin_note is not None})
    db.commit()
    return admin_view(db, issue)
