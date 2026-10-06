import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.features.accounts.models import now


def uid():
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class ContentChunk(Base):
    """Searchable text of one PUBLISHED learning-item revision. Only learning items ever produce
    chunks, so assessments, answer keys, scores and submissions cannot be retrieved by design;
    retrieval additionally re-checks that the revision is still the published one."""
    __tablename__ = "content_chunk"
    __table_args__ = (
        Index("content_chunk_tsv", "tsv", postgresql_using="gin"),
        UniqueConstraint("revision_id", "ordinal", name="chunk_ordinal_unique"),
    )
    id: Mapped[uuid.UUID] = uid()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("learning_item.id"), index=True)
    revision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("learning_item_revision.id"),
                                                   index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    locator: Mapped[str] = mapped_column(String(80), default="")
    anchor_node_id: Mapped[str | None] = mapped_column(String(36))
    text: Mapped[str] = mapped_column(Text)
    tsv: Mapped[str] = mapped_column(TSVECTOR, Computed(
        "to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || text)", persisted=True))


class ReferenceSnapshot(Base):
    """Faculty-reviewed text for a reference link. A link alone is never source text."""
    __tablename__ = "reference_snapshot"
    __table_args__ = (
        UniqueConstraint("revision_id", name="snapshot_revision_unique"),
        CheckConstraint("status IN ('extracted','approved')", name="snapshot_status"),
        CheckConstraint("method IN ('fetched','manual')", name="snapshot_method"),
    )
    id: Mapped[uuid.UUID] = uid()
    revision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("learning_item_revision.id"))
    source_url: Mapped[str] = mapped_column(String(2000))
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="extracted")
    method: Mapped[str] = mapped_column(String(8), default="fetched")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class StudyConversation(Base):
    """Private to the student. Faculty get progress views, never these chats."""
    __tablename__ = "study_conversation"
    id: Mapped[uuid.UUID] = uid()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    title: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now,
                                                 onupdate=now)


class StudyMessage(Base):
    __tablename__ = "study_message"
    __table_args__ = (
        CheckConstraint("role IN ('user','assistant')", name="study_role"),
        # A retried send with the same client id never stores a second copy of the question,
        # and a question never gets two replies.
        Index("one_client_message", "conversation_id", "client_message_id", unique=True,
              postgresql_where=text("client_message_id IS NOT NULL")),
        Index("one_reply", "reply_to_id", unique=True, postgresql_where=text("reply_to_id IS NOT NULL")),
    )
    id: Mapped[uuid.UUID] = uid()
    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("study_conversation.id"),
                                                       index=True)
    role: Mapped[str] = mapped_column(String(10))
    content: Mapped[str] = mapped_column(Text)
    sources: Mapped[list] = mapped_column(JSONB, default=list)
    suggestions: Mapped[list] = mapped_column(JSONB, default=list)   # lessons worth opening; never citations
    analogy: Mapped[str | None] = mapped_column(Text)                # an illustration checked by the model, never a source
    model: Mapped[str | None] = mapped_column(String(80))
    client_message_id: Mapped[str | None] = mapped_column(String(64))
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("study_message.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AiGeneration(Base):
    """Audit record of one quiz-generation request (no student data is ever sent to the provider)."""
    __tablename__ = "ai_generation"
    __table_args__ = (CheckConstraint("status IN ('succeeded','failed','invalid')",
                                      name="generation_status"),)
    id: Mapped[uuid.UUID] = uid()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    faculty_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    assessment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assessment.id"))
    source_item_ids: Mapped[list] = mapped_column(JSONB, default=list)
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)
    model: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(10))
    error_code: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class LessonCompletion(Base):
    """Explicitly student-reported. Opening a lesson is never completion."""
    __tablename__ = "lesson_completion"
    __table_args__ = (UniqueConstraint("student_id", "item_id", name="completion_unique"),)
    id: Mapped[uuid.UUID] = uid()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("learning_item.id"))
    revision_version: Mapped[int] = mapped_column(Integer)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class LearningEvent(Base):
    """A valid progress event: unique per (student, type, ref) so retries cannot inflate counts."""
    __tablename__ = "learning_event"
    __table_args__ = (
        UniqueConstraint("student_id", "event_type", "ref_id", name="event_unique"),
        CheckConstraint("event_type IN ('lesson_completed','quiz_submitted','activity_submitted')",
                        name="event_type"),
    )
    id: Mapped[uuid.UUID] = uid()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(20))
    resource_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))   # lesson / quiz / activity
    ref_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))        # item / attempt / submission
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
