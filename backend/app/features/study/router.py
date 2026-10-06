import uuid
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.features.teaching.access import learner_offering, record_offering, teaching_offering
from app.features.teaching.items import get_item
from app.security import current_account, require_role

from . import generation, progress, provider, references, study

router = APIRouter(prefix="/api", tags=["Study"])
student = require_role("student")
faculty = require_role("faculty")
L = "/learn/offerings/{offering_id}"


class SendMessage(BaseModel):
    text: str = Field(default="", max_length=4000)        # empty for a lesson action: the server builds the message
    client_message_id: str = Field(min_length=8, max_length=64)
    selected_item_id: uuid.UUID | None = None
    action: Literal["simplify", "summary", "example", "analogy"] | None = None


@router.get("/ai/status")
def ai_status(actor=Depends(current_account)):
    return provider.status()


@router.get(L + "/study/conversations")
def conversations(offering_id: UUID, limit: int = Query(25, ge=1, le=100), cursor: str | None = None,
                  actor=Depends(student), db: Session = Depends(get_db)):
    # Your own history stays readable after withdrawal or term close; only asking is blocked.
    offering, _ = record_offering(db, offering_id, actor)
    return study.list_conversations(db, actor, offering, limit, cursor)


@router.post(L + "/study/conversations", status_code=201)
def new_conversation(offering_id: UUID, actor=Depends(student), db: Session = Depends(get_db)):
    offering, _ = learner_offering(db, offering_id, actor, write=True)
    c = study.create_conversation(db, actor, offering)
    return {"id": c.id, "title": "New conversation", "updated_at": c.updated_at}


@router.get(L + "/study/conversations/{conversation_id}")
def conversation(offering_id: UUID, conversation_id: UUID, limit: int = Query(50, ge=1, le=200),
                 cursor: str | None = None, actor=Depends(student), db: Session = Depends(get_db)):
    offering, _ = record_offering(db, offering_id, actor)
    c = study.get_conversation(db, actor, offering, conversation_id)
    rows, older = study.messages_of(db, c, limit, cursor)
    return {"id": c.id, "title": c.title, "has_earlier": older is not None, "next_cursor": older,
            "messages": [study.message_view(m) for m in rows]}


@router.delete(L + "/study/conversations/{conversation_id}", status_code=204)
def delete_conversation(offering_id: UUID, conversation_id: UUID, actor=Depends(student),
                        db: Session = Depends(get_db)):
    offering, _ = record_offering(db, offering_id, actor)
    study.delete_conversation(db, actor, offering, conversation_id)
    return Response(status_code=204)


@router.post(L + "/study/conversations/{conversation_id}/messages")
def send_message(offering_id: UUID, conversation_id: UUID, data: SendMessage,
                 actor=Depends(student), db: Session = Depends(get_db)):
    user, reply = study.send(db, actor, offering_id, conversation_id, data.text,
                             data.client_message_id, data.selected_item_id, data.action)
    return {"user": user, "assistant": reply}


class SnapshotSave(BaseModel):
    text: str = Field(max_length=40000)
    approve: bool = False


T = "/teach/offerings/{offering_id}/items/{item_id}/reference"


@router.get(T + "/snapshot")
def get_snapshot(offering_id: UUID, item_id: UUID, actor=Depends(faculty),
                 db: Session = Depends(get_db)):
    offering = teaching_offering(db, offering_id, actor, write=False)
    item = get_item(db, offering, item_id)
    rev, snap = references.current(db, item)
    return {"snapshot": references.view(snap), "revision_state": rev.state if rev else None}


@router.post(T + "/extract")
def extract_reference(offering_id: UUID, item_id: UUID, actor=Depends(faculty),
                      db: Session = Depends(get_db)):
    offering = teaching_offering(db, offering_id, actor)
    return references.extract(db, actor, get_item(db, offering, item_id))


@router.put(T + "/snapshot")
def save_snapshot(offering_id: UUID, item_id: UUID, data: SnapshotSave, actor=Depends(faculty),
                  db: Session = Depends(get_db)):
    offering = teaching_offering(db, offering_id, actor)
    return references.save(db, actor, get_item(db, offering, item_id), data.text, data.approve)


class GenerateQuiz(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    source_item_ids: list[uuid.UUID] = Field(min_length=1, max_length=10)
    multiple_choice: int = Field(default=0, ge=0, le=30)
    true_false: int = Field(default=0, ge=0, le=30)
    short_answer: int = Field(default=0, ge=0, le=30)
    points: Decimal = Field(default=Decimal(1), gt=0, le=100)
    section_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    language: Literal["same", "english", "filipino", "taglish"] = "same"


@router.post("/teach/offerings/{offering_id}/assessments/generate", status_code=201)
def generate_quiz(offering_id: UUID, data: GenerateQuiz, actor=Depends(faculty),
                  db: Session = Depends(get_db)):
    return generation.generate(db, actor, offering_id, data)


@router.post(L + "/lessons/{item_id}/complete")
def complete_lesson(offering_id: UUID, item_id: UUID, actor=Depends(student),
                    db: Session = Depends(get_db)):
    return progress.complete_lesson(db, actor, offering_id, item_id)


@router.get(L + "/progress")
def my_progress(offering_id: UUID, actor=Depends(student), db: Session = Depends(get_db)):
    return progress.student_progress(db, actor, offering_id)


@router.get("/teach/offerings/{offering_id}/progress")
def class_progress(offering_id: UUID, actor=Depends(faculty), db: Session = Depends(get_db)):
    return progress.faculty_progress(db, teaching_offering(db, offering_id, actor, write=False))
