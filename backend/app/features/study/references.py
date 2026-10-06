"""Reference snapshots: the faculty-reviewed text that lets a link feed study help."""
from sqlalchemy import select

from app.errors import fail
from app.features.accounts.commands import audit
from app.features.accounts.models import now
from app.features.teaching.items import revision

from .models import ReferenceSnapshot
from .reference_fetch import MAX_PAGE_CHARS, ReferenceFetchError, fetch_reference_text


def snapshot_of(db, revision_id):
    return db.scalar(select(ReferenceSnapshot).where(ReferenceSnapshot.revision_id == revision_id))


def view(s):
    return None if s is None else {"id": s.id, "status": s.status, "method": s.method,
                                   "source_url": s.source_url, "text": s.text,
                                   "approved_at": s.approved_at}


def current(db, item):
    """The draft's snapshot while editing, otherwise the published revision's."""
    for state in ("draft", "published"):
        rev = revision(db, item.id, state)
        if rev:
            return rev, snapshot_of(db, rev.id)
    return None, None


def editable_draft(db, item):
    if item.kind != "reference":
        fail(422, "kind_mismatch", "Only reference links have extracted text.")
    draft = revision(db, item.id, "draft")
    if not draft:
        fail(404, "no_draft", "Start editing the link first.")
    return draft


def extract(db, actor, item):
    draft = editable_draft(db, item)
    if not draft.reference_url:
        fail(422, "no_url", "Add the link address first.")
    try:
        text = fetch_reference_text(draft.reference_url)     # faculty-initiated, never student-triggered
    except ReferenceFetchError as error:
        fail(422, "reference_unreadable", str(error))
    snap = snapshot_of(db, draft.id)
    if snap is None:
        snap = ReferenceSnapshot(revision_id=draft.id, source_url=draft.reference_url, text=text,
                                 created_by=actor.id)
        db.add(snap)
    snap.source_url, snap.text, snap.status, snap.method = draft.reference_url, text, "extracted", "fetched"
    snap.approved_by = snap.approved_at = None
    audit(db, actor, "reference.extracted", "learning_item", item.id)
    db.commit()
    return view(snap)


def save(db, actor, item, text, approve):
    """Faculty edit the text (or paste it themselves) and, when satisfied, approve it."""
    draft = editable_draft(db, item)
    text = text.strip()
    if len(text) > MAX_PAGE_CHARS:
        fail(422, "text_too_long", f"Keep the reviewed text under {MAX_PAGE_CHARS} characters.")
    if approve and len(text) < 40:
        fail(422, "text_too_short", "Add the relevant text before approving it.")
    snap = snapshot_of(db, draft.id)
    if snap is None:
        snap = ReferenceSnapshot(revision_id=draft.id, source_url=draft.reference_url or "",
                                 text=text, method="manual", created_by=actor.id)
        db.add(snap)
    elif snap.text != text:
        snap.method = "manual" if snap.method == "manual" else "fetched"
    snap.text = text
    if approve:
        snap.status, snap.approved_by, snap.approved_at = "approved", actor.id, now()
        audit(db, actor, "reference.approved", "learning_item", item.id)
    else:
        snap.status, snap.approved_by, snap.approved_at = "extracted", None, None
    db.commit()
    return view(snap)
