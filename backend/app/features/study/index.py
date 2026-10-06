"""Build and maintain the searchable chunks of PUBLISHED learning-item revisions."""
import logging

from sqlalchemy import delete, func, select

from app.features.files.models import StoredFile
from app.features.files.storage import path_of
from app.features.teaching.models import LearningItem, LearningItemRevision

from .chunker import chunk_sections
from .extract import file_sections, html_to_text
from .models import ContentChunk, ReferenceSnapshot

log = logging.getLogger("learnsync.study")


def sections_for(db, item, rev):
    """[(locator, text)] for a revision. A reference only counts once faculty approved its text."""
    if item.kind == "lesson":
        text = html_to_text(rev.body_html)
        return [("Lesson", text)] if text else []
    if item.kind == "file" and rev.file_id:
        file = db.get(StoredFile, rev.file_id)
        return file_sections(path_of(file), file.original_name) if file else []
    if item.kind == "reference":
        snap = db.scalar(select(ReferenceSnapshot).where(
            ReferenceSnapshot.revision_id == rev.id, ReferenceSnapshot.status == "approved"))
        return [("Reference", snap.text)] if snap and snap.text.strip() else []
    return []


def index_revision(db, item, rev):
    """Replace the chunks of one revision. Safe to call repeatedly."""
    db.execute(delete(ContentChunk).where(ContentChunk.revision_id == rev.id))
    chunks = chunk_sections(sections_for(db, item, rev))
    for ordinal, chunk in enumerate(chunks):
        db.add(ContentChunk(offering_id=item.offering_id, item_id=item.id, revision_id=rev.id,
                            ordinal=ordinal, title=rev.title[:200], locator=chunk["locator"],
                            anchor_node_id=rev.anchor_node_id, text=chunk["text"]))
    db.flush()
    return len(chunks)


def drop_old_revisions(db, item_id, keep_revision_id):
    db.execute(delete(ContentChunk).where(ContentChunk.item_id == item_id,
                                          ContentChunk.revision_id != keep_revision_id))


def safe_index(db, item, rev):
    """Publishing must never fail because text could not be read or stored: report it and carry on.
    The work runs in a SAVEPOINT, so even a failed database write cannot poison the publish."""
    item_id, rev_id = item.id, rev.id
    try:
        with db.begin_nested():
            count = index_revision(db, item, rev)
            drop_old_revisions(db, item_id, rev_id)
        rev.index_state = "indexed" if count else "empty"
        return count
    except Exception:   # noqa: BLE001 - a content or storage problem here is not a publish error
        log.warning("Could not index revision %s of item %s", rev_id, item_id)
        with db.begin_nested():
            db.execute(delete(ContentChunk).where(ContentChunk.revision_id == rev_id))
        rev.index_state = "failed"
        return 0


def chunk_count(db, revision_id):
    return db.scalar(select(func.count()).select_from(ContentChunk)
                     .where(ContentChunk.revision_id == revision_id)) or 0


def reindex_all(db):
    """Maintenance: rebuild chunks for every currently published, non-archived revision."""
    done = 0
    for item, rev in db.execute(
            select(LearningItem, LearningItemRevision)
            .join(LearningItemRevision, LearningItemRevision.item_id == LearningItem.id)
            .where(LearningItemRevision.state == "published", LearningItem.archived.is_(False))):
        safe_index(db, item, rev)
        done += 1
    db.commit()
    return done
