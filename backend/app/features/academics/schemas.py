import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class TermInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    sequence: int = Field(ge=1, le=4)
    start_date: date
    end_date: date
    copy_from_term_id: uuid.UUID | None = None
    copy_offerings: bool = False

    @model_validator(mode="after")
    def dates(self):
        if self.end_date < self.start_date:
            raise ValueError("End date must not be before the start date.")
        return self


class SchoolYearInput(BaseModel):
    label: str = Field(min_length=1, max_length=30)
    start_date: date
    end_date: date
    terms: list[TermInput] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def dates(self):
        if self.end_date < self.start_date:
            raise ValueError("End date must not be before the start date.")
        return self


class TermUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    start_date: date | None = None
    end_date: date | None = None


class Reason(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class SubjectInput(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    title: str = Field(min_length=1, max_length=200)
    units: Decimal = Field(ge=0, le=99)
    year_level: int | None = Field(default=None, ge=1, le=6)
    semester: int | None = Field(default=None, ge=1, le=4)
    description: str = Field(default="", max_length=5000)


class SubjectUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    units: Decimal | None = Field(default=None, ge=0, le=99)
    year_level: int | None = Field(default=None, ge=1, le=6)
    semester: int | None = Field(default=None, ge=1, le=4)
    description: str | None = Field(default=None, max_length=5000)
    status: Literal["active", "archived"] | None = None


class SectionInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    year_level: int = Field(ge=1, le=6)


class MemberInput(BaseModel):
    student_id: uuid.UUID


class OfferingInput(BaseModel):
    subject_id: uuid.UUID
    faculty_id: uuid.UUID
    section_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    placement_override_reason: str | None = Field(default=None, min_length=3, max_length=1000)


class OfferingUpdate(BaseModel):
    faculty_id: uuid.UUID | None = None
    section_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)
    placement_override_reason: str | None = Field(default=None, min_length=3, max_length=1000)


class ExceptionInput(BaseModel):
    action: Literal["include", "exclude"]
    section_id: uuid.UUID | None = None
    reason: str = Field(min_length=3, max_length=1000)

    @model_validator(mode="after")
    def include_needs_section(self):
        if self.action == "include" and not self.section_id:
            raise ValueError("Choose the teaching section for an included student.")
        return self


class DraftSubject(BaseModel):
    """Lenient on purpose: drafts may be saved with errors and are validated for review."""
    code: str = Field(default="", max_length=60)
    title: str = Field(default="", max_length=300)
    units: str | int | float | None = None
    year_level: int | None = None
    semester: int | None = None


class DraftSave(BaseModel):
    expected_revision: int
    subjects: list[DraftSubject] = Field(max_length=500)


class Revision(BaseModel):
    expected_revision: int
