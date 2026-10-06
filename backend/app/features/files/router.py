"""Authorized file delivery. Files are never served statically; access follows what the file is
attached to, and unauthorized or unknown ids look identical (404)."""
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import fail
from app.features.academics.models import Enrollment, Offering
from app.features.assessments.models import ActivitySubmission, Assessment
from app.features.teaching.access import targeted
from app.features.teaching.items import section_ids_of
from app.features.teaching.models import (
    LearningItem,
    LearningItemRevision,
    Syllabus,
    SyllabusRevision,
)
from app.security import current_account

from .models import StoredFile
from .storage import path_of

router = APIRouter(prefix="/api", tags=["Files"])


def may_download(db, file, actor):
    if file.purpose in {"prospectus", "student_import"}:
        return actor.role == "admin"
    if file.purpose == "syllabus_source":
        offering_id = db.scalar(select(Syllabus.offering_id).join(
            SyllabusRevision, SyllabusRevision.syllabus_id == Syllabus.id)
            .where(SyllabusRevision.source_file_id == file.id))
        offering = db.get(Offering, offering_id) if offering_id else None
        return bool(offering and actor.role == "faculty" and offering.faculty_id == actor.id)
    if file.purpose == "submission":
        row = db.scalar(select(ActivitySubmission).where(ActivitySubmission.file_id == file.id))
        if not row:
            return False
        if actor.role == "student":
            return row.student_id == actor.id          # their own work, even after withdrawal
        offering = db.get(Offering, db.get(Assessment, row.assessment_id).offering_id)
        return actor.role == "faculty" and offering.faculty_id == actor.id
    if file.purpose == "material":
        # A file can be referenced by several revisions of an item (drafts and superseded
        # versions share it), so judge the item by what students could actually see.
        rows = db.execute(select(LearningItemRevision, LearningItem)
                          .join(LearningItem, LearningItem.id == LearningItemRevision.item_id)
                          .where(LearningItemRevision.file_id == file.id)).all()
        if not rows:
            return False
        offering = db.get(Offering, rows[0][1].offering_id)
        if actor.role == "faculty":
            return offering.faculty_id == actor.id
        if actor.role == "student":
            enrollment = db.scalar(select(Enrollment).where(
                Enrollment.offering_id == offering.id, Enrollment.student_id == actor.id,
                Enrollment.status == "enrolled"))
            return bool(enrollment and any(
                revision.state == "published" and not item.archived
                and targeted(section_ids_of(db, item.id), enrollment) for revision, item in rows))
    return False


@router.get("/files/{file_id}/download")
def download(file_id: UUID, actor=Depends(current_account), db: Session = Depends(get_db)):
    file = db.get(StoredFile, file_id)
    if not file or not may_download(db, file, actor) or not path_of(file).is_file():
        fail(404, "not_found", "File not found.")
    return FileResponse(path_of(file), media_type=file.content_type, filename=file.original_name,
                        content_disposition_type="attachment")
