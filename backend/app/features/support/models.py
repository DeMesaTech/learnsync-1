import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.features.accounts.models import now

TYPES = ("bug", "account", "content", "other")
STATUSES = ("open", "in_progress", "resolved")


class IssueReport(Base):
    """A problem report from a student or teacher, reviewed by an administrator."""
    __tablename__ = "issue_report"
    __table_args__ = (
        CheckConstraint("type IN ('bug','account','content','other')", name="issue_type"),
        CheckConstraint("status IN ('open','in_progress','resolved')", name="issue_status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reporter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    type: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    page: Mapped[str] = mapped_column(String(200), default="")   # where the reporter was, as plain text
    status: Mapped[str] = mapped_column(String(12), default="open", index=True)
    admin_note: Mapped[str] = mapped_column(Text, default="")    # visible to the reporter
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("account.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
