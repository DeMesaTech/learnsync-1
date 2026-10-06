"""Backup manifest and restore verification (used by scripts/backup.ps1 and scripts/restore.ps1).

A backup is a pg_dump plus a copy of the private upload root, recorded together with a manifest:
schema revision, per-table row counts, a checksum of every stored file, and a content fingerprint of
every table (so published grade snapshots, revisions, scores and the audit trail are all covered).
Nothing here modifies the database it inspects, except `revoke_restored`, which is only for a
restored COPY."""
import hashlib
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine, text

from .db import Base
from .features.academics import (
    models as _academics,  # noqa: F401  (every model must be registered, or the
)
from .features.accounts import (
    models as _accounts,  # noqa: F401   manifest silently skips its tables)
)
from .features.assessments import models as _assessments  # noqa: F401
from .features.files import models as _files  # noqa: F401
from .features.study import models as _study  # noqa: F401
from .features.support import models as _support  # noqa: F401
from .features.teaching import models as _teaching  # noqa: F401

# Tables a restore deliberately changes (it ends every login and emailed link): counted but not hashed.
VOLATILE = {"auth_session", "account_token"}


class BackupError(Exception):
    pass


def sha256_of(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fingerprint(db, table):
    """SHA-256 over the COMPLETE content of every row (each row as JSON, sorted), so a changed snapshot,
    revision body, score, feedback or audit entry is detected, not just a changed row count."""
    digest, count = hashlib.sha256(), 0
    for (row,) in db.execute(text(f'SELECT row_to_json(t)::text FROM "{table}" t ORDER BY 1')):
        digest.update(row.encode() + b"\n")
        count += 1
    return {"rows": count, "sha256": digest.hexdigest()}


def snapshot(database_url, uploads):
    """Describe a database + upload root. Raises BackupError when a referenced file is missing or
    does not match the checksum recorded when it was uploaded: such a backup would be unusable."""
    engine = create_engine(database_url)
    uploads = Path(uploads)
    with engine.connect() as db:
        revision = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
        tables = {name: db.execute(text(f'SELECT count(*) FROM "{name}"')).scalar()
                  for name in sorted(Base.metadata.tables)}
        files, problems = [], []
        for key, size, expected in db.execute(text(
                "SELECT storage_key, size, sha256 FROM stored_file ORDER BY storage_key")):
            path = uploads / key
            if not path.is_file():
                problems.append(f"missing file {key}")
                continue
            actual = sha256_of(path)
            if actual != expected or path.stat().st_size != size:
                problems.append(f"file {key} does not match its recorded checksum")
            files.append({"key": key, "size": size, "sha256": actual})
        prints = {name: fingerprint(db, name) for name in sorted(Base.metadata.tables) if name not in VOLATILE}
    engine.dispose()
    if problems:
        raise BackupError("; ".join(problems[:10]) + (f" (+{len(problems) - 10} more)" if len(problems) > 10 else ""))
    return {"created_at": datetime.now(UTC).isoformat(), "alembic_revision": revision,
            "tables": tables, "files": files, "fingerprints": prints}


def verify(manifest, database_url, uploads):
    """Compare a restored copy with the manifest. Returns a list of problems (empty = intact)."""
    try:
        now = snapshot(database_url, uploads)
    except BackupError as error:
        return [str(error)]
    problems = []
    if now["alembic_revision"] != manifest["alembic_revision"]:
        problems.append(f"schema revision {now['alembic_revision']} != {manifest['alembic_revision']}")
    for name, count in manifest["tables"].items():
        if name == "auth_session":      # a restored copy deliberately starts with no logins
            continue
        if now["tables"].get(name) != count:
            problems.append(f"table {name}: {now['tables'].get(name)} rows, expected {count}")
    if {f["key"]: f["sha256"] for f in now["files"]} != {f["key"]: f["sha256"] for f in manifest["files"]}:
        problems.append("the set of uploaded files or their checksums differs")
    unknown = set(manifest["fingerprints"]) - set(now["fingerprints"])
    if unknown:
        problems.append("the manifest was made by an older version (different fingerprints); take a new backup")
    for name, expected in manifest["fingerprints"].items():
        if name in now["fingerprints"] and now["fingerprints"][name] != expected:
            problems.append(f"history differs: {name}")
    return problems


def revoke_restored(database_url):
    """A restored copy must not honour logins or emailed links from the moment of the backup."""
    engine = create_engine(database_url)
    with engine.begin() as db:
        sessions = db.execute(text("DELETE FROM auth_session")).rowcount
        tokens = db.execute(text("UPDATE account_token SET consumed_at = now() WHERE consumed_at IS NULL")).rowcount
    engine.dispose()
    return {"sessions_removed": sessions, "tokens_revoked": tokens}
