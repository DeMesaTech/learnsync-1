import pytest
from test_grading import full_term, publish_grades
from test_study import file_item, lesson, make_pdf

from app import backup
from app.config import settings


def url():
    return settings().database_url


def test_a_backup_manifest_covers_files_history_and_schema(course):
    lesson(course, "Readable", "<p>Some lesson text for the backup.</p>")
    file_item(course, "reading.pdf", make_pdf(["Reading text"]), "Reading")
    manifest = backup.snapshot(url(), settings().upload_root)
    assert manifest["alembic_revision"] and manifest["tables"]["stored_file"] == 1
    assert len(manifest["files"]) == 1 and len(manifest["files"][0]["sha256"]) == 64
    assert manifest["fingerprints"]["learning_item_revision"]["rows"] >= 2
    assert "auth_session" not in manifest["fingerprints"] and "audit_event" in manifest["fingerprints"]
    assert backup.verify(manifest, url(), settings().upload_root) == []        # an untouched copy is intact


def test_a_backup_refuses_a_missing_or_altered_file(course):
    file_item(course, "reading.pdf", make_pdf(["Reading text"]), "Reading")
    stored = next(p for p in settings().upload_root.rglob("*") if p.is_file())
    original = stored.read_bytes()
    stored.write_bytes(original + b" tampered")
    with pytest.raises(backup.BackupError, match="checksum"):
        backup.snapshot(url(), settings().upload_root)
    stored.unlink()
    with pytest.raises(backup.BackupError, match="missing file"):
        backup.snapshot(url(), settings().upload_root)


def test_verification_detects_lost_history_and_changed_files(db, graded):
    full_term(graded)
    publish_grades(graded, "midterm")
    file_item(graded, "reading.pdf", make_pdf(["Reading text"]), "Reading")
    manifest = backup.snapshot(url(), settings().upload_root)
    publish_grades(graded, "finals")                                            # history changed after the backup
    problems = backup.verify(manifest, url(), settings().upload_root)
    assert any("grade_publication" in p for p in problems)
    assert backup.verify(manifest, url(), settings().upload_root / "nowhere")[0].startswith("missing file")


def test_restored_copies_lose_sessions_and_pending_links(db, world):
    from helpers import Api
    Api("s1@example.com")                                                       # signs in: one session exists
    before = backup.snapshot(url(), settings().upload_root)
    assert before["tables"]["auth_session"] >= 1
    result = backup.revoke_restored(url())
    assert result["sessions_removed"] >= 1
    assert backup.snapshot(url(), settings().upload_root)["tables"]["auth_session"] == 0
    assert backup.verify(before, url(), settings().upload_root) == []            # a restore is still "intact" without logins


def test_verification_detects_changed_content_not_just_missing_rows(db, graded):
    from sqlalchemy import text
    full_term(graded)
    publish_grades(graded, "midterm")
    lesson(graded, "Readable", "<p>Original lesson text.</p>")
    manifest = backup.snapshot(url(), settings().upload_root)
    cases = {
        "grade_publication": "UPDATE grade_publication SET snapshot = '{\"tampered\": true}'::jsonb",
        "audit_event": "UPDATE audit_event SET action = 'something.else' WHERE id = (SELECT id FROM audit_event LIMIT 1)",
        "learning_item_revision": "UPDATE learning_item_revision SET body_html = '<p>Changed.</p>' WHERE state = 'published'",
        "assessment_score": "UPDATE assessment_score SET feedback = 'edited after the backup'",
    }
    for table, change in cases.items():
        db.execute(text(change))
        db.commit()
        problems = backup.verify(manifest, url(), settings().upload_root)
        assert any(f"history differs: {table}" in p for p in problems), (table, problems)
        db.rollback()
        db.execute(text("SELECT 1"))
    assert backup.snapshot(url(), settings().upload_root)["tables"]["grade_publication"] == manifest["tables"]["grade_publication"]


def test_the_command_line_manifest_covers_every_table(course, tmp_path):
    """The CLI is a separate process that only imports what it needs; it once covered just a few tables."""
    import json
    import subprocess
    import sys
    from pathlib import Path

    from sqlalchemy import create_engine, text
    out = tmp_path / "manifest.json"
    done = subprocess.run([sys.executable, "-m", "app.cli", "backup-manifest", "--uploads", str(settings().upload_root),
                           "--out", str(out), "--database-url", url()], cwd=Path(__file__).parents[1],
                          capture_output=True, text=True, check=False)
    assert done.returncode == 0, done.stderr
    manifest = json.loads(out.read_text(encoding="utf-8"))
    with create_engine(url()).connect() as db:
        real = {r[0] for r in db.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'alembic_version'"))}
    assert set(manifest["tables"]) == real, sorted(real ^ set(manifest["tables"]))
    assert set(manifest["fingerprints"]) == real - {"auth_session", "account_token"}
