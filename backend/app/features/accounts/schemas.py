from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class AccountView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str
    display_name: str
    role: str
    status: str
    student_number: str | None
    preferences: dict

class Login(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

class Invite(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=150)
    role: Literal["admin", "faculty", "student"]
    student_number: str | None = Field(default=None, min_length=1, max_length=50)

    @model_validator(mode="after")
    def student_id_required(self):
        if self.role == "student" and not self.student_number:
            raise ValueError("Student number is required")
        self.display_name = self.display_name.strip()
        if not self.display_name:
            raise ValueError("Name is required")
        return self

class EmailRequest(BaseModel):
    email: EmailStr

class AcceptToken(BaseModel):
    token: str = Field(min_length=32, max_length=128)
    password: str = Field(min_length=12, max_length=128)

class AccountStatus(BaseModel):
    status: Literal["active", "inactive"]

class BulkSendLinks(BaseModel):
    account_ids: list[UUID] = Field(min_length=1, max_length=25)

    @model_validator(mode="after")
    def unique_account_ids(self):
        if len(set(self.account_ids)) != len(self.account_ids):
            raise ValueError("Account IDs must be unique")
        return self

class Handover(BaseModel):
    incoming_owner: str = Field(min_length=1, max_length=150)
    reason: str = Field(min_length=1, max_length=1000)

class Preferences(BaseModel):
    theme: Literal["system", "light", "dark"]
