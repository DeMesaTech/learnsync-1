import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Topic(BaseModel):
    id: uuid.UUID
    title: str = Field(default="", max_length=300)


class Subsection(BaseModel):
    id: uuid.UUID
    title: str = Field(default="", max_length=300)
    topics: list[Topic] = Field(default_factory=list, max_length=100)


class Chapter(BaseModel):
    id: uuid.UUID
    kind: Literal["chapter", "exam"] = "chapter"
    title: str = Field(default="", max_length=300)
    weeks: str = Field(default="", max_length=60)
    ilo: str = Field(default="", max_length=3000)
    activities: str = Field(default="", max_length=3000)
    assessment: str = Field(default="", max_length=3000)
    topics: list[Topic] = Field(default_factory=list, max_length=100)
    subsections: list[Subsection] = Field(default_factory=list, max_length=50)


class Outcome(BaseModel):
    id: uuid.UUID
    text: str = Field(default="", max_length=1000)


class CourseInfo(BaseModel):
    code: str = Field(default="", max_length=60)
    name: str = Field(default="", max_length=300)
    description: str = Field(default="", max_length=5000)
    units: str = Field(default="", max_length=10)
    contact_hours: str = Field(default="", max_length=60)
    prerequisite: str = Field(default="", max_length=300)
    values: str = Field(default="", max_length=1000)
    references: str = Field(default="", max_length=10000)
    requirements: str = Field(default="", max_length=5000)
    evaluation_note: str = Field(default="", max_length=3000)


class Outline(BaseModel):
    """Stable UUIDs identify every node so reordering/renaming never breaks anchors."""
    course: CourseInfo = Field(default_factory=CourseInfo)
    outcomes: list[Outcome] = Field(default_factory=list, max_length=50)
    chapters: list[Chapter] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [o.id for o in self.outcomes]
        for chapter in self.chapters:
            ids.append(chapter.id)
            ids += [t.id for t in chapter.topics]
            for sub in chapter.subsections:
                ids.append(sub.id)
                ids += [t.id for t in sub.topics]
        if len(ids) != len(set(ids)):
            raise ValueError("Outline node ids must be unique.")
        return self


def node_ids(outline):
    """Chapter/subsection/topic ids that lessons and coverage can attach to."""
    ids = set()
    for chapter in outline.get("chapters", []):
        ids.add(chapter["id"])
        ids |= {t["id"] for t in chapter.get("topics", [])}
        for sub in chapter.get("subsections", []):
            ids.add(sub["id"])
            ids |= {t["id"] for t in sub.get("topics", [])}
    return ids


class GradingCategory(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    label: str = Field(default="", max_length=80)
    weight: float = Field(default=0, ge=0, le=100)


class GradingPeriod(BaseModel):
    key: Literal["midterm", "finals"]
    label: str = Field(default="", max_length=40)
    share: float = Field(default=0, ge=0, le=100)


class GradingPolicy(BaseModel):
    categories: list[GradingCategory] = Field(default_factory=list, max_length=10)
    periods: list[GradingPeriod] = Field(default_factory=list, max_length=2)
    transmutation: Literal["raw", "transmuted"] = "raw"
    passing: float = Field(default=75, ge=0, le=100)
    late_attendance_fraction: float = Field(default=0.5, ge=0, le=1)


class SyllabusSave(BaseModel):
    expected_counter: int
    outline: Outline
    grading_policy: GradingPolicy | None = None


class Counter(BaseModel):
    expected_counter: int


class ItemCreate(BaseModel):
    kind: Literal["lesson", "file", "reference"]
    title: str = Field(min_length=1, max_length=200)
    section_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    anchor_node_id: uuid.UUID | None = None


class ItemSave(BaseModel):
    expected_counter: int
    title: str = Field(default="", max_length=200)
    body_html: str = Field(default="", max_length=500_000)
    reference_url: str | None = Field(default=None, max_length=2000)
    reference_note: str = Field(default="", max_length=5000)
    anchor_node_id: uuid.UUID | None = None


class ItemOrder(BaseModel):
    anchor_node_id: uuid.UUID | None = None    # the chapter/topic group; none = "Other materials"
    expected_ids: list[uuid.UUID] = Field(max_length=500)   # the order the editor was looking at
    item_ids: list[uuid.UUID] = Field(max_length=500)       # the order they want


class ItemSettings(BaseModel):
    section_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)
    archived: bool | None = None


class AnnouncementInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=5000)
    section_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)


class CoverageInput(BaseModel):
    section_id: uuid.UUID
    node_id: uuid.UUID
    covered_on: date
