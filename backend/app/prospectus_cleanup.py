"""Safely remove uncommitted prospectus previews and unused catalog subjects."""
import re
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import Base
from app.features.academics.models import Offering, ProspectusImport, Subject
from app.features.accounts.models import AuditEvent
from app.features.files.models import StoredFile


def _stored_file_references(db: Session, deleted_draft_ids: set | None = None) -> set:
    references = set()
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if any(fk.column.table.name == StoredFile.__tablename__
                   for fk in column.foreign_keys):
                query = select(column).where(column.is_not(None)).distinct()
                if table.name == ProspectusImport.__tablename__ and deleted_draft_ids:
                    query = query.where(table.c.id.not_in(deleted_draft_ids))
                references.update(db.scalars(query))
    return references


def clean_prospectus_data(db: Session, apply: bool, upload_root: Path) -> dict:
    draft_query = select(ProspectusImport).where(ProspectusImport.status == "draft")
    subject_query = select(Subject).order_by(Subject.code)
    if apply:
        draft_query = draft_query.with_for_update()
        subject_query = subject_query.with_for_update()
    drafts = db.scalars(draft_query).all()
    draft_file_ids = {draft.file_id for draft in drafts if draft.file_id is not None}
    committed = db.scalar(select(func.count()).select_from(ProspectusImport)
                          .where(ProspectusImport.status != "draft"))
    subjects = db.scalars(subject_query).all()
    referenced_ids = set(db.scalars(select(Offering.subject_id).distinct()))
    unused = [subject for subject in subjects if subject.id not in referenced_ids]
    referenced_active = [subject for subject in subjects
                         if subject.id in referenced_ids and subject.status == "active"]

    report = {
        "drafts_deleted": len(drafts),
        "committed_imports_preserved": committed,
        "subjects_deleted": len(unused),
        "subjects_archived": len(referenced_active),
        "subject_codes_deleted": [subject.code for subject in unused],
        "subject_codes_archived": [subject.code for subject in referenced_active],
        "upload_files_deleted": 0,
        "upload_file_cleanup_warnings": [],
        "applied": apply,
    }
    if not apply:
        remaining_references = _stored_file_references(
            db, {draft.id for draft in drafts})
        report["upload_files_deleted"] = len(draft_file_ids - remaining_references)
        return report

    upload_root = upload_root.resolve()
    for draft in drafts:
        db.delete(draft)
    for subject in unused:
        db.delete(subject)
    for subject in referenced_active:
        subject.status = "archived"
    db.flush()

    still_referenced_files = _stored_file_references(db)
    files_to_unlink = []
    removable_files = []
    for file_id in draft_file_ids - still_referenced_files:
        stored_file = db.get(StoredFile, file_id)
        if stored_file is None:
            continue
        if not re.fullmatch(r"[0-9a-f]{2}/[0-9a-f]{32}", stored_file.storage_key):
            raise ValueError("Refusing to remove an upload with an unexpected storage key.")
        path = (upload_root / stored_file.storage_key).resolve()
        if not path.is_relative_to(upload_root):
            raise ValueError("Refusing to remove an upload outside the configured upload root.")
        removable_files.append(stored_file)
        files_to_unlink.append((stored_file.storage_key, path))

    for stored_file in removable_files:
        db.delete(stored_file)

    if drafts or unused or referenced_active or removable_files:
        db.add(AuditEvent(
            actor_label="maintenance",
            action="prospectus.cleanup",
            entity_type="maintenance",
            entity_id="prospectus",
            details={
                "drafts_deleted": report["drafts_deleted"],
                "committed_imports_preserved": committed,
                "subjects_deleted": report["subject_codes_deleted"],
                "subjects_archived": report["subject_codes_archived"],
                "upload_files_deleted": len(removable_files),
            },
        ))
    db.commit()

    for storage_key, path in files_to_unlink:
        try:
            path.unlink(missing_ok=True)
        except OSError as error:
            report["upload_file_cleanup_warnings"].append(
                f"Could not remove stored upload {storage_key}: {error}")
    report["upload_files_deleted"] = len(removable_files) - len(
        report["upload_file_cleanup_warnings"])
    return report
