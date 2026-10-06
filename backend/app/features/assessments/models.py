import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
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

POINTS = Numeric(8, 2)


def uid():
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class Assessment(Base):
    """Common identity for quizzes, activities, exams and manual assessments."""
    __tablename__ = "assessment"
    __table_args__ = (CheckConstraint(
        "kind IN ('online_quiz','offline_quiz','activity','exam','manual')",
        name="assessment_kind"),)
    id: Mapped[uuid.UUID] = uid()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    kind: Mapped[str] = mapped_column(String(14))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AssessmentRevision(Base):
    __tablename__ = "assessment_revision"
    __table_args__ = (
        UniqueConstraint("assessment_id", "version", name="assessment_version_unique"),
        CheckConstraint("state IN ('draft','published','superseded')", name="assessment_state"),
        CheckConstraint("period IS NULL OR period IN ('midterm','finals')",
                        name="assessment_period"),
        CheckConstraint("score_rule IN ('highest','latest')", name="assessment_score_rule"),
        Index("one_assessment_draft", "assessment_id", unique=True,
              postgresql_where=text("state = 'draft'")),
        Index("one_assessment_published", "assessment_id", unique=True,
              postgresql_where=text("state = 'published'")),
    )
    id: Mapped[uuid.UUID] = uid()
    assessment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessment.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(12), default="draft")
    draft_counter: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(200), default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    category_key: Mapped[str | None] = mapped_column(String(40))
    period: Mapped[str | None] = mapped_column(String(10))
    max_points: Mapped[Decimal] = mapped_column(POINTS, default=Decimal(0))
    available_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    allow_late: Mapped[bool] = mapped_column(Boolean, default=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=1)
    score_rule: Mapped[str] = mapped_column(String(8), default="highest")
    include_in_grade: Mapped[bool] = mapped_column(Boolean, default=True)
    anchor_node_id: Mapped[str | None] = mapped_column(String(36))
    # AI-drafted quizzes must be reviewed by faculty: the review is bound to a draft counter, so
    # any later edit (which bumps the counter) silently invalidates it.
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    reviewed_counter: Mapped[int | None] = mapped_column(Integer)
    ai_language: Mapped[str | None] = mapped_column(String(10))   # which language faculty asked the AI to write in
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("account.id"))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    published_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now,
                                                 onupdate=now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AssessmentSection(Base):
    """No rows means every section of the offering."""
    __tablename__ = "assessment_section"
    assessment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessment.id"),
                                                     primary_key=True)
    section_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("section.id"), primary_key=True)


class QuizQuestion(Base):
    """`key` is the stable identity across revisions; answers and scores refer to it."""
    __tablename__ = "quiz_question"
    __table_args__ = (
        UniqueConstraint("revision_id", "key", name="question_key_unique"),
        CheckConstraint("type IN ('multiple_choice','true_false','short_answer')",
                        name="question_type"),
    )
    id: Mapped[uuid.UUID] = uid()
    revision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessment_revision.id"),
                                                   index=True)
    key: Mapped[str] = mapped_column(String(36))
    position: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(16))
    prompt: Mapped[str] = mapped_column(Text, default="")
    choices: Mapped[list] = mapped_column(JSONB, default=list)
    correct: Mapped[object] = mapped_column(JSONB, nullable=True)     # private: never sent to students
    explanation: Mapped[str] = mapped_column(Text, default="")        # private
    source: Mapped[dict | None] = mapped_column(JSONB)                # AI drafts: where it came from
    points: Mapped[Decimal] = mapped_column(POINTS, default=Decimal(1))


class QuizAttempt(Base):
    __tablename__ = "quiz_attempt"
    __table_args__ = (
        UniqueConstraint("assessment_id", "student_id", "attempt_number",
                         name="attempt_number_unique"),
        CheckConstraint("state IN ('in_progress','submitted')", name="attempt_state"),
        Index("one_attempt_in_progress", "assessment_id", "student_id", unique=True,
              postgresql_where=text("state = 'in_progress'")),
    )
    id: Mapped[uuid.UUID] = uid()
    assessment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessment.id"), index=True)
    revision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessment_revision.id"))
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    attempt_number: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(12), default="in_progress")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    score: Mapped[Decimal | None] = mapped_column(POINTS)
    max_score: Mapped[Decimal | None] = mapped_column(POINTS)
    idempotency_key: Mapped[str | None] = mapped_column(String(64))


class QuizAnswer(Base):
    __tablename__ = "quiz_answer"
    __table_args__ = (UniqueConstraint("attempt_id", "question_key", name="answer_unique"),)
    id: Mapped[uuid.UUID] = uid()
    attempt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("quiz_attempt.id"), index=True)
    question_key: Mapped[str] = mapped_column(String(36))
    response: Mapped[object] = mapped_column(JSONB, nullable=True)
    auto_awarded: Mapped[Decimal | None] = mapped_column(POINTS)
    awarded: Mapped[Decimal | None] = mapped_column(POINTS)
    corrected_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("account.id"))
    correction_reason: Mapped[str | None] = mapped_column(Text)


class ActivitySubmission(Base):
    __tablename__ = "activity_submission"
    __table_args__ = (UniqueConstraint("assessment_id", "student_id", "version",
                                       name="submission_version_unique"),)
    id: Mapped[uuid.UUID] = uid()
    assessment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessment.id"), index=True)
    revision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessment_revision.id"))
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stored_file.id"))
    note: Mapped[str] = mapped_column(Text, default="")
    is_late: Mapped[bool] = mapped_column(Boolean, default=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SubmissionPermission(Base):
    """Faculty-granted exception: allows one submission/resubmission after the deadline."""
    __tablename__ = "submission_permission"
    id: Mapped[uuid.UUID] = uid()
    assessment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessment.id"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    reason: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    granted_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AssessmentScore(Base):
    """Working score (faculty-visible). Students only see ResultPublication snapshots."""
    __tablename__ = "assessment_score"
    __table_args__ = (
        UniqueConstraint("assessment_id", "student_id", name="score_unique"),
        CheckConstraint("score IS NULL OR score >= 0", name="score_non_negative"),
    )
    id: Mapped[uuid.UUID] = uid()
    assessment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessment.id"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    score: Mapped[Decimal | None] = mapped_column(POINTS)             # NULL = pending, 0 = zero
    feedback: Mapped[str] = mapped_column(Text, default="")
    selected_attempt_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("quiz_attempt.id"))
    selected_submission_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("activity_submission.id"))
    revision: Mapped[int] = mapped_column(Integer, default=0)   # 0 = never recorded
    graded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("account.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now,
                                                 onupdate=now)


class ResultPublication(Base):
    """Immutable release of one student's result. The latest release is what the student sees."""
    __tablename__ = "result_publication"
    __table_args__ = (UniqueConstraint("assessment_id", "student_id", "release_number",
                                       name="result_release_unique"),)
    id: Mapped[uuid.UUID] = uid()
    assessment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessment.id"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    release_number: Mapped[int] = mapped_column(Integer)
    score: Mapped[Decimal] = mapped_column(POINTS)
    max_points: Mapped[Decimal] = mapped_column(POINTS)
    feedback: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[dict] = mapped_column(JSONB, default=dict)
    published_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("account.id"))
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AttendanceSession(Base):
    __tablename__ = "attendance_session"
    __table_args__ = (
        UniqueConstraint("offering_id", "section_id", "session_date", name="attendance_day"),
        CheckConstraint("period IN ('midterm','finals')", name="attendance_period"),
    )
    id: Mapped[uuid.UUID] = uid()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    section_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("section.id"))
    session_date: Mapped[date] = mapped_column(Date)
    period: Mapped[str] = mapped_column(String(10))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AttendanceMark(Base):
    __tablename__ = "attendance_mark"
    __table_args__ = (
        UniqueConstraint("session_id", "student_id", name="attendance_mark_unique"),
        CheckConstraint("status IN ('present','absent','late','excused')",
                        name="attendance_status"),
    )
    id: Mapped[uuid.UUID] = uid()
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attendance_session.id"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    status: Mapped[str] = mapped_column(String(10))


class GradePublication(Base):
    """Immutable overall grade release (midterm, finals or course) with its calculation snapshot."""
    __tablename__ = "grade_publication"
    __table_args__ = (
        UniqueConstraint("offering_id", "student_id", "period", "release_number",
                         name="grade_release_unique"),
        CheckConstraint("period IN ('midterm','finals','course')", name="grade_period"),
    )
    id: Mapped[uuid.UUID] = uid()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"), index=True)
    period: Mapped[str] = mapped_column(String(10))
    release_number: Mapped[int] = mapped_column(Integer)
    grade: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    remark: Mapped[str] = mapped_column(String(10))
    policy_version: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    published_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class GradeReviewState(Base):
    __tablename__ = "grade_review_state"
    __table_args__ = (UniqueConstraint("offering_id", "student_id", "period",
                                       name="review_context_unique"),)
    id: Mapped[uuid.UUID] = uid()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offering.id"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    period: Mapped[str] = mapped_column(String(10))
    needs_review: Mapped[bool] = mapped_column(Boolean, default=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
