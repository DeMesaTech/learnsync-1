from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import fail
from app.features.academics.queries import offering_summary
from app.security import require_role

from . import announcements, items, syllabus
from .access import learner_offering, record_offering, teaching_offering
from .models import Announcement
from .schemas import (
    AnnouncementInput,
    Counter,
    CoverageInput,
    ItemCreate,
    ItemOrder,
    ItemSave,
    ItemSettings,
    SyllabusSave,
)

router = APIRouter(prefix="/api", tags=["Teaching"])
faculty = require_role("faculty")
student = require_role("student")


def own(db, offering_id, actor, write=True):
    return teaching_offering(db, offering_id, actor, write)


# ---------------- faculty: syllabus ----------------

@router.get("/teach/offerings/{offering_id}/syllabus")
def get_syllabus(offering_id: UUID, actor=Depends(faculty), db: Session = Depends(get_db)):
    return syllabus.faculty_state(db, own(db, offering_id, actor, write=False))


@router.post("/teach/offerings/{offering_id}/syllabus/draft")
def start_syllabus_draft(offering_id: UUID, actor=Depends(faculty), db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    return syllabus.view(db, syllabus.start_draft(db, actor, offering))


@router.put("/teach/offerings/{offering_id}/syllabus/draft")
def save_syllabus_draft(offering_id: UUID, data: SyllabusSave, actor=Depends(faculty),
                        db: Session = Depends(get_db)):
    return syllabus.save_draft(db, actor, own(db, offering_id, actor), data)


@router.delete("/teach/offerings/{offering_id}/syllabus/draft", status_code=204)
def discard_syllabus_draft(offering_id: UUID, expected_counter: int, actor=Depends(faculty),
                           db: Session = Depends(get_db)):
    syllabus.discard_draft(db, actor, own(db, offering_id, actor), expected_counter)
    return Response(status_code=204)


@router.post("/teach/offerings/{offering_id}/syllabus/draft/publish")
def publish_syllabus(offering_id: UUID, data: Counter, actor=Depends(faculty),
                     db: Session = Depends(get_db)):
    rev = syllabus.publish(db, actor, own(db, offering_id, actor), data.expected_counter)
    return syllabus.view(db, rev)


@router.post("/teach/offerings/{offering_id}/syllabus/import", status_code=201)
def import_syllabus(offering_id: UUID, file: UploadFile = File(...), actor=Depends(faculty),
                    db: Session = Depends(get_db)):
    draft, warnings = syllabus.import_source(db, actor, own(db, offering_id, actor), file)
    return {"draft": syllabus.view(db, draft), "warnings": warnings}


# ---------------- faculty: coverage ----------------

@router.get("/teach/offerings/{offering_id}/coverage")
def get_coverage(offering_id: UUID, actor=Depends(faculty), db: Session = Depends(get_db)):
    return syllabus.coverage_rows(db, own(db, offering_id, actor, write=False).id)


@router.put("/teach/offerings/{offering_id}/coverage", status_code=204)
def set_coverage(offering_id: UUID, data: CoverageInput, actor=Depends(faculty),
                 db: Session = Depends(get_db)):
    syllabus.set_coverage(db, actor, own(db, offering_id, actor), data)
    return Response(status_code=204)


@router.delete("/teach/offerings/{offering_id}/coverage", status_code=204)
def clear_coverage(offering_id: UUID, section_id: UUID, node_id: UUID, actor=Depends(faculty),
                   db: Session = Depends(get_db)):
    syllabus.clear_coverage(db, actor, own(db, offering_id, actor), section_id, node_id)
    return Response(status_code=204)


# ---------------- faculty: learning items ----------------

@router.get("/teach/offerings/{offering_id}/items")
def list_items(offering_id: UUID, actor=Depends(faculty), db: Session = Depends(get_db)):
    return items.faculty_items(db, own(db, offering_id, actor, write=False))


@router.post("/teach/offerings/{offering_id}/items", status_code=201)
def create_item(offering_id: UUID, data: ItemCreate, actor=Depends(faculty),
                db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    return items.item_view(db, items.create_item(db, actor, offering, data), full=True)


@router.put("/teach/offerings/{offering_id}/items-order", status_code=204)
def order_items(offering_id: UUID, data: ItemOrder, actor=Depends(faculty),
                db: Session = Depends(get_db)):
    items.reorder(db, actor, own(db, offering_id, actor), data.anchor_node_id, data.expected_ids, data.item_ids)
    return Response(status_code=204)


@router.get("/teach/offerings/{offering_id}/items/{item_id}")
def get_item(offering_id: UUID, item_id: UUID, actor=Depends(faculty),
             db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor, write=False)
    return items.item_view(db, items.get_item(db, offering, item_id), full=True)


@router.post("/teach/offerings/{offering_id}/items/{item_id}/draft")
def start_item_draft(offering_id: UUID, item_id: UUID, actor=Depends(faculty),
                     db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    item = items.get_item(db, offering, item_id)
    items.start_draft(db, actor, item)
    return items.item_view(db, item, full=True)


@router.put("/teach/offerings/{offering_id}/items/{item_id}/draft")
def save_item_draft(offering_id: UUID, item_id: UUID, data: ItemSave, actor=Depends(faculty),
                    db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    return items.save_draft(db, actor, offering, items.get_item(db, offering, item_id), data)


@router.post("/teach/offerings/{offering_id}/items/{item_id}/draft/file")
def upload_item_file(offering_id: UUID, item_id: UUID, file: UploadFile = File(...),
                     expected_counter: int = Form(...), actor=Depends(faculty),
                     db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    return items.attach_file(db, actor, items.get_item(db, offering, item_id), file,
                             expected_counter)


@router.delete("/teach/offerings/{offering_id}/items/{item_id}/draft", status_code=204)
def discard_item_draft(offering_id: UUID, item_id: UUID, expected_counter: int,
                       actor=Depends(faculty), db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    items.discard_draft(db, actor, items.get_item(db, offering, item_id), expected_counter)
    return Response(status_code=204)


@router.post("/teach/offerings/{offering_id}/items/{item_id}/draft/publish")
def publish_item(offering_id: UUID, item_id: UUID, data: Counter, actor=Depends(faculty),
                 db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    item = items.get_item(db, offering, item_id)
    items.publish(db, actor, offering, item, data.expected_counter)
    return items.item_view(db, item, full=True)


@router.patch("/teach/offerings/{offering_id}/items/{item_id}")
def item_settings(offering_id: UUID, item_id: UUID, data: ItemSettings, actor=Depends(faculty),
                  db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    item = items.get_item(db, offering, item_id)
    items.update_settings(db, actor, offering, item, data)
    return items.item_view(db, item)


@router.delete("/teach/offerings/{offering_id}/items/{item_id}", status_code=204)
def delete_item(offering_id: UUID, item_id: UUID, actor=Depends(faculty),
                db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    items.delete_item(db, actor, items.get_item(db, offering, item_id))
    return Response(status_code=204)


# ---------------- faculty: announcements ----------------

@router.get("/teach/offerings/{offering_id}/announcements")
def list_announcements(offering_id: UUID, limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
                       actor=Depends(faculty), db: Session = Depends(get_db)):
    return announcements.faculty_list(db, own(db, offering_id, actor, write=False), limit, offset)


@router.post("/teach/offerings/{offering_id}/announcements", status_code=201)
def create_announcement(offering_id: UUID, data: AnnouncementInput, actor=Depends(faculty),
                        db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    return announcements.view(db, announcements.create(db, actor, offering, data))


def announcement_of(db, offering_id, announcement_id, actor):
    a = db.get(Announcement, announcement_id)
    if not a:
        fail(404, "not_found", "Announcement not found.")
    offering = own(db, a.offering_id, actor)
    if offering.id != offering_id:
        fail(404, "not_found", "Announcement not found.")
    return offering, a


@router.put("/teach/offerings/{offering_id}/announcements/{announcement_id}")
def update_announcement(offering_id: UUID, announcement_id: UUID, data: AnnouncementInput,
                        actor=Depends(faculty), db: Session = Depends(get_db)):
    offering, a = announcement_of(db, offering_id, announcement_id, actor)
    announcements.update(db, actor, offering, a, data)
    return announcements.view(db, a)


@router.post("/teach/offerings/{offering_id}/announcements/{announcement_id}/publish")
def publish_announcement(offering_id: UUID, announcement_id: UUID, actor=Depends(faculty),
                         db: Session = Depends(get_db)):
    _, a = announcement_of(db, offering_id, announcement_id, actor)
    announcements.publish(db, actor, a)
    return announcements.view(db, a)


@router.post("/teach/offerings/{offering_id}/announcements/{announcement_id}/archive")
def archive_announcement(offering_id: UUID, announcement_id: UUID, actor=Depends(faculty),
                         db: Session = Depends(get_db)):
    _, a = announcement_of(db, offering_id, announcement_id, actor)
    announcements.archive(db, actor, a)
    return announcements.view(db, a)


# ---------------- student: published content only ----------------

@router.get("/learn/offerings/{offering_id}")
def learn_offering(offering_id: UUID, actor=Depends(student), db: Session = Depends(get_db)):
    # Header data only: withdrawn students can still reach their own results from here.
    offering, enrollment = record_offering(db, offering_id, actor)
    return {**offering_summary(db, [offering])[0], "enrollment_status": enrollment.status}


@router.get("/learn/offerings/{offering_id}/syllabus")
def learn_syllabus(offering_id: UUID, actor=Depends(student), db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(db, offering_id, actor)
    return syllabus.student_view(db, offering, enrollment)


@router.get("/learn/offerings/{offering_id}/items")
def learn_items(offering_id: UUID, actor=Depends(student), db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(db, offering_id, actor)
    return items.student_items(db, offering, enrollment, actor.id)


@router.get("/learn/offerings/{offering_id}/items/{item_id}")
def learn_item(offering_id: UUID, item_id: UUID, actor=Depends(student),
               db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(db, offering_id, actor)
    return items.student_item(db, offering, enrollment, item_id, actor.id)


@router.get("/learn/offerings/{offering_id}/announcements")
def learn_announcements(offering_id: UUID, limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
                        actor=Depends(student), db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(db, offering_id, actor)
    return announcements.student_page(db, offering, enrollment, limit, offset)
