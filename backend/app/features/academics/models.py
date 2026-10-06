import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
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


class SchoolYear(Base):
    __tablename__ = "school_year"
    id: Mapped[uuid.UUID] = uid()
    label: Mapped[str] = mapped_column(String(30), unique=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AcademicTerm(Base):
    __tablename__ = "academic_term"
    __table_args__ = (
        UniqueConstraint("school_year_id", "sequence", name="term_sequence_unique"),
        CheckConstraint("status IN ('open','closed')", name="term_status"),
        CheckConstraint("end_date >= start_date", name="term_dates"),
    )
    id: Mapped[uuid.UUID] = uid()
    school_year_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("school_year.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    sequence: Mapped[int] = mapped_column(Integer)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), default="open")
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("account.id"))
    reopened_reason: Mapped[str | None] = mapped_column(Text)


class Subject(Base):
    __tablename__ = "subject"
    __table_args__ = (CheckConstraint("status IN ('active','archived')", name="subject_status"),)
    id: Mapped[uuid.UUID] = uid()
    code: Mapped[str] = mapped_column(String(30), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    units: Mapped[Decimal] = mapped_column(Numeric(4, 1))
    year_level: Mapped[int | None] = mapped_column(Integer)
    semester: Mapped[int | None] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(10), default="active")


class Section(Base):
    __tablename__ = "section"
    __table_args__ = (UniqueConstraint("term_id", "name", name="section_name_unique"),)
    id: Mapped[uuid.UUID] = uid()
    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("academic_term.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    year_level: Mapped[int] = mapped_column(Integer)


class SectionMember(Base):
    __tablename__ = "section_member"
    __table_args__ = (
        UniqueConstraint("section_id", "student_id", name="section_member_unique"),
        CheckConstraint("status IN ('active','withdrawn')", name="section_member_status"),
        # One primary regular section per student per term.
        Index("one_active_section_per_term", "term_id", "student_id", unique=True,
              postgresql_where=text("status = 'active'")),
    )
    id: Mapped[uuid.UUID] = uid()
    section_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("section.id"), index=True)
    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("academic_term.id"))
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Offering(Base):
    __tablename__ = "offering"
    __table_args__ = (
        UniqueConstraint("subject_id", "term_id", "faculty_id", name="offering_unique"),
        CheckConstraint("status IN ('active','archived')", name="offering_status"),
    )
    id: Mapped[uuid.UUID] = uid()
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subject.id"), index=True)
    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("academic_term.id"), index=True)
    faculty_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class OfferingSection(Base):
    __tablename__ = "offering_section"
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), primary_key=True)
    section_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("section.id"), primary_key=True)


class Enrollment(Base):
    __tablename__ = "enrollment"
    __table_args__ = (
        UniqueConstraint("offering_id", "student_id", name="enrollment_unique"),
        CheckConstraint("source IN ('regular','exception')", name="enrollment_source"),
        CheckConstraint("status IN ('enrolled','withdrawn')", name="enrollment_status"),
    )
    id: Mapped[uuid.UUID] = uid()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    section_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("section.id"))
    source: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(10), default="enrolled")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class EnrollmentException(Base):
    __tablename__ = "enrollment_exception"
    __table_args__ = (
        UniqueConstraint("offering_id", "student_id", name="enrollment_exception_unique"),
        CheckConstraint("action IN ('include','exclude')", name="enrollment_exception_action"),
        CheckConstraint("action <> 'include' OR section_id IS NOT NULL",
                        name="include_needs_section"),
    )
    id: Mapped[uuid.UUID] = uid()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    action: Mapped[str] = mapped_column(String(10))
    section_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("section.id"))
    reason: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class StudentImport(Base):
    __tablename__ = "student_import"
    id: Mapped[uuid.UUID] = uid()
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stored_file.id"))
    term_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("academic_term.id"))
    rows: Mapped[list] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(12), default="previewed")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProspectusImport(Base):
    __tablename__ = "prospectus_import"
    id: Mapped[uuid.UUID] = uid()
    file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("stored_file.id"))
    draft: Mapped[list] = mapped_column(JSONB, default=list)
    warnings: Mapped[list] = mapped_column(JSONB, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(12), default="draft")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
