from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from .names import (
    StudentName,
    canonical_suffix,
    format_student_name,
    normalize_faculty_name_parts,
    split_faculty_name,
    split_student_name,
    suffix_from_last_name,
)


class AccountView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str
    display_name: str
    first_name: str | None
    middle_name: str | None
    last_name: str | None
    suffix: str | None
    role: str
    status: str
    college_id: UUID | None
    student_number: str | None
    preferences: dict

class Login(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

class Invite(BaseModel):
    email: EmailStr
    display_name: str | None = Field(default=None, max_length=150)
    first_name: str | None = Field(default=None, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    suffix: str | None = Field(default=None, max_length=20)
    role: Literal["admin", "faculty", "student"]
    college_id: UUID | None = None
    student_number: str | None = Field(default=None, min_length=1, max_length=50)

    @model_validator(mode="after")
    def student_id_required(self):
        if self.role == "student" and not self.student_number:
            raise ValueError("Student number is required")
        if self.first_name or self.last_name:
            self.first_name = (self.first_name or "").strip()
            self.middle_name = (self.middle_name or "").strip() or None
            last_name, detected_suffix = suffix_from_last_name(self.last_name or "")
            self.last_name = last_name.strip()
            supplied_suffix = (self.suffix or "").strip()
            normalized_suffix = canonical_suffix(supplied_suffix)
            if supplied_suffix and not normalized_suffix:
                raise ValueError("Use a valid generational suffix such as Jr., Sr., II, or III")
            self.suffix = normalized_suffix or detected_suffix or None
            if not self.first_name or not self.last_name:
                raise ValueError("First and last names are required")
            parts = StudentName(
                self.first_name, self.middle_name or "", self.last_name, self.suffix or "")
        else:
            parts = (split_faculty_name(self.display_name or "")
                     if self.role == "faculty"
                     else split_student_name(self.display_name or ""))
            if not parts.first_name or not parts.last_name:
                raise ValueError("Enter a name as Last name, First name Middle name")
            self.first_name = parts.first_name
            self.middle_name = parts.middle_name or None
            self.last_name = parts.last_name
            self.suffix = parts.suffix or None
        if self.role == "faculty":
            parts = normalize_faculty_name_parts(parts)
            if not parts:
                raise ValueError("Enter a teacher's name without a title and include a first and last name")
        self.first_name = parts.first_name
        self.middle_name = parts.middle_name or None
        self.last_name = parts.last_name
        self.suffix = parts.suffix or None
        self.display_name = format_student_name(parts)
        return self

class EmailRequest(BaseModel):
    email: EmailStr

class AcceptToken(BaseModel):
    token: str = Field(min_length=32, max_length=128)
    password: str = Field(min_length=12, max_length=128)

class AccountStatus(BaseModel):
    status: Literal["active", "inactive"]

class FacultyCollegeUpdate(BaseModel):
    college_id: UUID | None

class FacultyProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=150)
    email: EmailStr = Field(max_length=254)
    college_id: UUID | None

    @model_validator(mode="after")
    def clean_values(self):
        name = split_faculty_name(self.display_name.strip())
        if not name.first_name or not name.last_name:
            raise ValueError("Enter a teacher's name without a title and include a first and last name")
        self.display_name = format_student_name(name)
        self.email = str(self.email).strip().lower()
        return self

class BulkSendLinks(BaseModel):
    account_ids: list[UUID] = Field(min_length=1, max_length=25)

    @model_validator(mode="after")
    def unique_account_ids(self):
        if len(set(self.account_ids)) != len(self.account_ids):
            raise ValueError("Account IDs must be unique")
        return self

class FacultyImportRowUpdate(BaseModel):
    row: int = Field(ge=2)
    display_name: str | None = Field(default=None, max_length=150)
    first_name: str | None = Field(default=None, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    suffix: str | None = Field(default=None, max_length=20)
    email: str = Field(max_length=254)
    college_id: UUID | None = None

    @model_validator(mode="after")
    def name_required(self):
        if self.display_name is None and (not self.first_name or not self.last_name):
            raise ValueError("Provide either display_name or first_name and last_name")
        return self

class FacultyImportUpdate(BaseModel):
    rows: list[FacultyImportRowUpdate] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def unique_rows(self):
        if len({row.row for row in self.rows}) != len(self.rows):
            raise ValueError("Import row numbers must be unique")
        return self

class Handover(BaseModel):
    incoming_owner: str = Field(min_length=1, max_length=150)
    reason: str = Field(min_length=1, max_length=1000)

class Preferences(BaseModel):
    theme: Literal["system", "light", "dark"]
