import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.config import settings
from app.features.academics.models import ProspectusImport, Subject
from app.features.accounts.models import AuditEvent
from app.features.files.models import StoredFile
from app.prospectus_cleanup import clean_prospectus_data


def test_cleanup_preview_and_apply_preserves_committed_and_referenced_history(
        db, world, actors, monkeypatch, tmp_path):
    upload_root = tmp_path / "uploads"
    monkeypatch.setattr(settings(), "upload_root", upload_root)
    draft_file_id = uuid.uuid4()
    key = f"{draft_file_id.hex[:2]}/{draft_file_id.hex}"
    stored_path = upload_root / key
    stored_path.parent.mkdir(parents=True)
    stored_path.write_bytes(b"old prospectus")
    db.add_all([
        StoredFile(id=draft_file_id, original_name="old.docx",
                   content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                   size=len(b"old prospectus"), sha256="0" * 64, storage_key=key,
                   purpose="prospectus", uploader_id=actors[0].id),
        ProspectusImport(file_id=draft_file_id, draft=[], warnings=[], created_by=actors[0].id),
        ProspectusImport(file_id=None, draft=[], warnings=[], status="committed",
                         committed_at=datetime.now(UTC), created_by=actors[0].id),
        Subject(code="UNUSED 101", title="Unused subject", units=3),
    ])
    db.commit()
    unused_id = db.scalar(select(Subject.id).where(Subject.code == "UNUSED 101"))

    preview = clean_prospectus_data(db, apply=False, upload_root=upload_root)

    assert preview["drafts_deleted"] == 1
    assert preview["committed_imports_preserved"] == 1
    assert preview["subject_codes_deleted"] == ["UNUSED 101"]
    assert preview["subject_codes_archived"] == ["ENT 101"]
    assert preview["upload_files_deleted"] == 1
    assert db.get(ProspectusImport, db.scalar(select(ProspectusImport.id).where(
        ProspectusImport.status == "draft"))) is not None
    assert db.get(Subject, unused_id) is not None
    assert db.get(Subject, world["subject"]["id"]).status == "active"

    result = clean_prospectus_data(db, apply=True, upload_root=upload_root)

    assert result["applied"] is True
    assert db.scalar(select(ProspectusImport.id).where(ProspectusImport.status == "draft")) is None
    assert db.scalar(select(ProspectusImport.id).where(ProspectusImport.status == "committed")) is not None
    assert db.get(Subject, unused_id) is None
    assert db.get(Subject, world["subject"]["id"]).status == "archived"
    assert db.get(StoredFile, draft_file_id) is None
    assert not stored_path.exists()
    event = db.scalars(select(AuditEvent).where(AuditEvent.action == "prospectus.cleanup")).one()
    assert event.details["subjects_deleted"] == ["UNUSED 101"]
