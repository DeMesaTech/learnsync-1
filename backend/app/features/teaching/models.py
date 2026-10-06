import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.features.accounts.models import now


def uid():
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class Syllabus(Base):
    """One syllabus per offering; its revisions carry the content."""
    __tablename__ = "syllabus"
    id: Mapped[uuid.UUID] = uid()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SyllabusRevision(Base):
    """draft -> published -> superseded. Published/superseded rows are immutable."""
    __tablename__ = "syllabus_revision"
    __table_args__ = (
        UniqueConstraint("syllabus_id", "version", name="syllabus_version_unique"),
        CheckConstraint("state IN ('draft','published','superseded')", name="syllabus_state"),
        Index("one_syllabus_draft", "syllabus_id", unique=True,
              postgresql_where=text("state = 'draft'")),
        Index("one_syllabus_published", "syllabus_id", unique=True,
              postgresql_where=text("state = 'published'")),
    )
    id: Mapped[uuid.UUID] = uid()
    syllabus_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("syllabus.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(12), default="draft")
    draft_counter: Mapped[int] = mapped_column(Integer, default=1)
    outline: Mapped[dict] = mapped_column(JSONB)
    grading_policy: Mapped[dict | None] = mapped_column(JSONB)
    source_file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("stored_file.id"))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    published_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now,
                                                 onupdate=now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LearningItem(Base):
    __tablename__ = "learning_item"
    __table_args__ = (
        CheckConstraint("kind IN ('lesson','file','reference')", name="learning_item_kind"),
    )
    id: Mapped[uuid.UUID] = uid()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    kind: Mapped[str] = mapped_column(String(10))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)   # teaching order within its chapter/topic
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class LearningItemRevision(Base):
    __tablename__ = "learning_item_revision"
    __table_args__ = (
        UniqueConstraint("item_id", "version", name="learning_item_version_unique"),
        CheckConstraint("state IN ('draft','published','superseded')",
                        name="learning_item_state"),
        Index("one_item_draft", "item_id", unique=True, postgresql_where=text("state = 'draft'")),
        Index("one_item_published", "item_id", unique=True,
              postgresql_where=text("state = 'published'")),
    )
    id: Mapped[uuid.UUID] = uid()
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("learning_item.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(12), default="draft")
    draft_counter: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(200), default="")
    body_html: Mapped[str] = mapped_column(Text, default="")
    file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("stored_file.id"))
    reference_url: Mapped[str | None] = mapped_column(String(2000))
    reference_note: Mapped[str] = mapped_column(Text, default="")
    anchor_node_id: Mapped[str | None] = mapped_column(String(36))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    published_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now,
                                                 onupdate=now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # study-text outcome of the last indexing: indexed / empty (no readable text) / failed
    index_state: Mapped[str | None] = mapped_column(String(10))


class LearningItemSection(Base):
    """No rows for an item means it targets every section of the offering."""
    __tablename__ = "learning_item_section"
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("learning_item.id"), primary_key=True)
    section_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("section.id"), primary_key=True)


class TeachingCoverage(Base):
    """Faculty-recorded 'covered in class'. Separate from student completion."""
    __tablename__ = "teaching_coverage"
    __table_args__ = (
        UniqueConstraint("offering_id", "section_id", "node_id", name="coverage_unique"),
    )
    id: Mapped[uuid.UUID] = uid()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    section_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("section.id"))
    node_id: Mapped[str] = mapped_column(String(36))
    covered_on: Mapped[date] = mapped_column(Date)
    recorded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Announcement(Base):
    __tablename__ = "announcement"
    __table_args__ = (
        CheckConstraint("state IN ('draft','published','archived')", name="announcement_state"),
    )
    id: Mapped[uuid.UUID] = uid()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(10), default="draft")
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AnnouncementSection(Base):
    """No rows means every section of the offering."""
    __tablename__ = "announcement_section"
    announcement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("announcement.id"),
                                                       primary_key=True)
    section_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("section.id"), primary_key=True)
