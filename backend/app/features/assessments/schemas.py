import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field


class Choice(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    text: str = Field(default="", max_length=500)


class QuestionIn(BaseModel):
    """Drafts accept anything structurally valid; completeness is checked at publish."""
    key: uuid.UUID
    type: Literal["multiple_choice", "true_false", "short_answer"]
    prompt: str = Field(default="", max_length=5000)
    choices: list[Choice] = Field(default_factory=list, max_length=8)
    correct: Any = None
    explanation: str = Field(default="", max_length=5000)
    points: Decimal = Field(default=Decimal(1), ge=0, le=1000)
    source: dict | None = None   # where an AI-drafted question came from


class AssessmentCreate(BaseModel):
    kind: Literal["online_quiz", "offline_quiz", "activity", "exam", "manual"]
    title: str = Field(min_length=1, max_length=200)
    section_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)


class AssessmentDraftSave(BaseModel):
    expected_counter: int
    title: str = Field(default="", max_length=200)
    instructions: str = Field(default="", max_length=10000)
    category_key: str | None = Field(default=None, max_length=40)
    period: Literal["midterm", "finals"] | None = None
    max_points: Decimal = Field(default=Decimal(0), ge=0, le=100000)
    available_from: datetime | None = None
    deadline: datetime | None = None
    allow_late: bool = False
    max_attempts: int = Field(default=1, ge=1, le=10)
    score_rule: Literal["highest", "latest"] = "highest"
    include_in_grade: bool = True
    anchor_node_id: uuid.UUID | None = None
    questions: list[QuestionIn] = Field(default_factory=list, max_length=100)


class AssessmentSettings(BaseModel):
    section_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)
    archived: bool | None = None


class AnswersSave(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)


class AttemptSubmit(BaseModel):
    idempotency_key: str = Field(min_length=8, max_length=64)
    answers: dict[str, Any] | None = None


class Correction(BaseModel):
    awarded: Decimal = Field(ge=0, le=1000)
    reason: str = Field(min_length=3, max_length=1000)


class ScoreInput(BaseModel):
    score: Decimal | None = Field(default=None, ge=0, le=100000)
    feedback: str = Field(default="", max_length=5000)
    expected_revision: int | None = None


class ReleaseInput(BaseModel):
    student_ids: list[uuid.UUID] | None = Field(default=None, max_length=1000)


class PermissionInput(BaseModel):
    student_id: uuid.UUID
    reason: str = Field(min_length=3, max_length=1000)
    expires_at: datetime


class AttendanceInput(BaseModel):
    section_id: uuid.UUID
    session_date: date
    period: Literal["midterm", "finals"]
    marks: dict[uuid.UUID, Literal["present", "absent", "late", "excused"] | None] = Field(
        default_factory=dict)   # null returns a student to "not marked"


class GradePublishInput(BaseModel):
    period: Literal["midterm", "finals", "course"]
    student_ids: list[uuid.UUID] | None = Field(default=None, max_length=1000)


class PlanItem(BaseModel):
    kind: Literal["online_quiz", "offline_quiz", "activity", "exam", "manual"]
    title: str = Field(min_length=1, max_length=200)
    category_key: str | None = Field(default=None, max_length=40)
    period: Literal["midterm", "finals"] | None = None


class PlanInput(BaseModel):
    plan_key: str = Field(min_length=8, max_length=64)       # a repeat of the same key returns the first result
    items: list[PlanItem] = Field(min_length=1, max_length=30)


class ScheduleInput(BaseModel):
    meeting_days: int = Field(ge=0, le=127)


class ParseInput(BaseModel):
    text: str = Field(max_length=200000)
