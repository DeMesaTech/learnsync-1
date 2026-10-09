"""Learning items (lessons, files, references): versioned drafts, sanitized HTML, targeted sections."""
import nh3
from pydantic import AnyHttpUrl, TypeAdapter
from sqlalchemy import delete, func, select

from app.errors import fail
from app.features.academics.models import OfferingSection
from app.features.accounts.commands import audit
from app.features.accounts.models import now
from app.features.files.models import StoredFile
from app.features.files.storage import save_upload
from app.features.study.index import chunk_count, safe_index
from app.features.study.models import LessonCompletion, ReferenceSnapshot

from .access import targeted
from .models import (
    LearningItem,
    LearningItemRevision,
    LearningItemSection,
    Syllabus,
    SyllabusRevision,
)
from .schemas import node_ids

MATERIAL_TYPES = {".pdf", ".docx", ".pptx", ".xlsx", ".png", ".jpg", ".jpeg"}
TAGS = {"p", "br", "strong", "em", "u", "s", "h1", "h2", "h3", "h4", "ul", "ol", "li",
        "blockquote", "code", "pre", "a", "table", "thead", "tbody", "tr", "th", "td", "hr"}
ATTRIBUTES = {"a": {"href", "title"}, "td": {"colspan", "rowspan"}, "th": {"colspan", "rowspan"}}


def sanitize(html):
    return nh3.clean(html, tags=TAGS, attributes=ATTRIBUTES,
                     url_schemes={"http", "https", "mailto"}, link_rel="noopener noreferrer")


def get_item(db, offering, item_id):
    item = db.get(LearningItem, item_id)
    if not item or item.offering_id != offering.id:
        fail(404, "not_found", "Item not found.")
    return item


def revision(db, item_id, state):
    return db.scalar(select(LearningItemRevision).where(
        LearningItemRevision.item_id == item_id, LearningItemRevision.state == state))


def file_view(db, file_id):
    file = db.get(StoredFile, file_id) if file_id else None
    return {"id": file.id, "name": file.original_name, "size": file.size,
            "content_type": file.content_type} if file else None


def rev_view(db, rev, full=True):
    out = {"version": rev.version, "state": rev.state, "counter": rev.draft_counter,
           "title": rev.title, "anchor_node_id": rev.anchor_node_id,
           "reference_url": rev.reference_url, "reference_note": rev.reference_note,
           "file": file_view(db, rev.file_id), "updated_at": rev.updated_at,
           "published_at": rev.published_at}
    if full:
        out["body_html"] = rev.body_html
    return out


def section_ids_of(db, item_id):
    return set(db.scalars(select(LearningItemSection.section_id)
                          .where(LearningItemSection.item_id == item_id)))


def item_view(db, item, full=False):
    published, draft = revision(db, item.id, "published"), revision(db, item.id, "draft")
    return {"id": item.id, "kind": item.kind, "archived": item.archived, "position": item.position,
            "section_ids": sorted(section_ids_of(db, item.id), key=str),
            "published": ({**rev_view(db, published, full),
                           "study_chunks": chunk_count(db, published.id),
                           "index_state": published.index_state} if published else None),
            "draft": rev_view(db, draft, full) if draft else None}


def faculty_items(db, offering):
    items = db.scalars(select(LearningItem).where(LearningItem.offering_id == offering.id)
                       .order_by(LearningItem.position, LearningItem.created_at)).all()
    return [item_view(db, i) for i in items]


def check_sections(db, offering, section_ids):
    linked = set(db.scalars(select(OfferingSection.section_id)
                            .where(OfferingSection.offering_id == offering.id)))
    if not set(section_ids) <= linked:
        fail(422, "section_invalid", "Choose sections that take this subject.")


def outline_ids(db, offering, states):
    ids = set()
    for rev in db.scalars(select(SyllabusRevision).join(
            Syllabus, Syllabus.id == SyllabusRevision.syllabus_id)
            .where(Syllabus.offering_id == offering.id, SyllabusRevision.state.in_(states))):
        ids |= node_ids(rev.outline)
    return ids


def check_anchor(db, offering, anchor):
    if anchor and str(anchor) not in outline_ids(db, offering, ["draft", "published"]):
        fail(422, "anchor_invalid", "Choose a chapter or topic from this subject's syllabus.")


def create_item(db, actor, offering, data):
    section_ids = list(dict.fromkeys(data.section_ids))
    check_sections(db, offering, section_ids)
    check_anchor(db, offering, data.anchor_node_id)
    last = db.scalar(select(func.max(LearningItem.position))
                     .where(LearningItem.offering_id == offering.id)) or 0
    item = LearningItem(offering_id=offering.id, kind=data.kind, created_by=actor.id, position=last + 1)
    db.add(item)
    db.flush()
    db.add(LearningItemRevision(item_id=item.id, version=1, title=data.title,
                                anchor_node_id=str(data.anchor_node_id) if data.anchor_node_id
                                else None, created_by=actor.id))
    for section_id in section_ids:
        db.add(LearningItemSection(item_id=item.id, section_id=section_id))
    audit(db, actor, "item.created", "learning_item", item.id, {"kind": data.kind})
    db.commit()
    return item


def locked_draft(db, item, expected_counter):
    draft = db.scalar(select(LearningItemRevision).where(
        LearningItemRevision.item_id == item.id, LearningItemRevision.state == "draft")
        .with_for_update())
    if not draft:
        fail(404, "no_draft", "There is no draft to change. Start editing first.")
    if draft.draft_counter != expected_counter:
        fail(409, "draft_revision_conflict",
             "This draft changed elsewhere. Review the newer version before saving.")
    return draft


def start_draft(db, actor, item):
    db.scalar(select(LearningItem.id).where(LearningItem.id == item.id).with_for_update())
    draft = revision(db, item.id, "draft")
    if draft:
        return draft
    published = revision(db, item.id, "published")
    version = (db.scalar(select(func.max(LearningItemRevision.version))
                         .where(LearningItemRevision.item_id == item.id)) or 0) + 1
    draft = LearningItemRevision(
        item_id=item.id, version=version, created_by=actor.id, title=published.title,
        body_html=published.body_html, file_id=published.file_id,
        reference_url=published.reference_url, reference_note=published.reference_note,
        anchor_node_id=published.anchor_node_id)
    db.add(draft)
    db.flush()
    if item.kind == "reference":
        snap = db.scalar(select(ReferenceSnapshot).where(ReferenceSnapshot.revision_id == published.id))
        if snap and snap.source_url == draft.reference_url:
            db.add(ReferenceSnapshot(revision_id=draft.id, source_url=snap.source_url, text=snap.text,
                                     status=snap.status, method=snap.method,
                                     created_by=snap.created_by, approved_by=snap.approved_by,
                                     approved_at=snap.approved_at))
    db.commit()
    return draft


def save_draft(db, actor, offering, item, data):
    draft = locked_draft(db, item, data.expected_counter)
    check_anchor(db, offering, data.anchor_node_id)
    draft.title = data.title
    draft.anchor_node_id = str(data.anchor_node_id) if data.anchor_node_id else None
    if item.kind == "lesson":
        draft.body_html = sanitize(data.body_html)
    if item.kind == "reference":
        if draft.reference_url != data.reference_url:    # a different link needs its own reviewed text
            db.execute(delete(ReferenceSnapshot).where(ReferenceSnapshot.revision_id == draft.id))
        draft.reference_url, draft.reference_note = data.reference_url, data.reference_note
    if item.kind == "file":
        draft.reference_note = data.reference_note   # optional description shown with the file
    draft.draft_counter += 1
    db.commit()
    return {"counter": draft.draft_counter, "updated_at": draft.updated_at,
            "body_html": draft.body_html}


def attach_file(db, actor, item, upload, expected_counter):
    if item.kind != "file":
        fail(422, "kind_mismatch", "Only file items take an uploaded file.")
    draft = locked_draft(db, item, expected_counter)
    file = save_upload(db, upload, "material", actor, MATERIAL_TYPES)
    draft.file_id = file.id
    draft.draft_counter += 1
    db.commit()
    return {"counter": draft.draft_counter, "file": file_view(db, file.id)}


def discard_draft(db, actor, item, expected_counter):
    draft = locked_draft(db, item, expected_counter)
    if not revision(db, item.id, "published"):
        fail(409, "never_published", "This item was never published; delete it instead.")
    db.delete(draft)
    db.commit()


def delete_item(db, actor, item):
    if revision(db, item.id, "published") or db.scalar(select(LearningItemRevision.id).where(
            LearningItemRevision.item_id == item.id, LearningItemRevision.state == "superseded")):
        fail(409, "has_history", "Published items are archived, not deleted.")
    db.execute(delete(LearningItemSection).where(LearningItemSection.item_id == item.id))
    db.execute(delete(LearningItemRevision).where(LearningItemRevision.item_id == item.id))
    audit(db, actor, "item.deleted", "learning_item", item.id)
    db.delete(item)
    db.commit()


def update_settings(db, actor, offering, item, data):
    if data.section_ids is not None:
        section_ids = list(dict.fromkeys(data.section_ids))
        check_sections(db, offering, section_ids)
        db.execute(delete(LearningItemSection).where(LearningItemSection.item_id == item.id))
        for section_id in section_ids:
            db.add(LearningItemSection(item_id=item.id, section_id=section_id))
    if data.archived is not None:
        item.archived = data.archived
    audit(db, actor, "item.settings_changed", "learning_item", item.id,
          data.model_dump(mode="json", exclude_none=True))
    db.commit()


def publish(db, actor, offering, item, expected_counter):
    draft = locked_draft(db, item, expected_counter)
    problems = []
    if not draft.title.strip():
        problems.append("Add a title.")
    if item.kind == "lesson" and not draft.body_html.strip():
        problems.append("Write the lesson content.")
    if item.kind == "file" and not draft.file_id:
        problems.append("Upload a file.")
    if item.kind == "reference":
        try:
            TypeAdapter(AnyHttpUrl).validate_python(draft.reference_url or "")
        except ValueError:
            problems.append("Add a valid web link (starting with http:// or https://).")
    if draft.anchor_node_id and draft.anchor_node_id not in outline_ids(
            db, offering, ["published"]):
        fail(409, "anchor_not_published",
             "This item is attached to a topic that is not in the published syllabus yet. "
             "Publish the syllabus first, or detach the item.")
    if problems:
        fail(422, "item_incomplete", " ".join(problems))
    previous = revision(db, item.id, "published")
    if previous:
        previous.state = "superseded"
        db.flush()
    draft.state, draft.published_at, draft.published_by = "published", now(), actor.id
    safe_index(db, item, draft)       # study help can only ever use what is published
    audit(db, actor, "item.published", "learning_item", item.id, {"version": draft.version})
    db.commit()
    return draft


# ---------- student projection: published revisions of targeted, non-archived items ----------

def node_order(outline):
    """Chapter/topic ids in the order a student reads the syllabus."""
    flat = []
    for chapter in outline.get("chapters", []):
        flat.append(chapter["id"])
        flat += [t["id"] for t in chapter.get("topics", [])]
        for sub in chapter.get("subsections", []):
            flat.append(sub["id"])
            flat += [t["id"] for t in sub.get("topics", [])]
    return {node: index for index, node in enumerate(flat)}


# Lessons, files and links are one sequence: each can be marked done, counts as a step, and can be "Up next".
SEQUENCE_KINDS = ("lesson", "file", "reference")

NO_GROUP = 10 ** 6   # unattached items, or a topic the published syllabus no longer has: "Other materials"


def ordered_published(db, offering, enrollment):
    """[(item, published revision, group index)] the student may see, in teaching order: syllabus order
    first, then the faculty-set position inside a topic. One rule for the list, the dashboard's next
    step and a lesson's Next link."""
    rev = db.scalar(select(SyllabusRevision).join(Syllabus, Syllabus.id == SyllabusRevision.syllabus_id)
                    .where(Syllabus.offering_id == offering.id, SyllabusRevision.state == "published"))
    order = node_order(rev.outline) if rev else {}
    rows = []
    for item in db.scalars(select(LearningItem).where(
            LearningItem.offering_id == offering.id, LearningItem.archived.is_(False))):
        published = revision(db, item.id, "published")
        if published and targeted(section_ids_of(db, item.id), enrollment):
            rows.append((item, published, order.get(published.anchor_node_id, NO_GROUP)))
    rows.sort(key=lambda r: (r[2], r[0].position, r[0].created_at))
    return rows


def completed_lessons(db, student_id):
    """Ids of the lessons this student marked complete."""
    return set(db.scalars(select(LessonCompletion.item_id).where(LessonCompletion.student_id == student_id)))


def student_items(db, offering, enrollment, student_id=None):
    done = completed_lessons(db, student_id)
    rows = ordered_published(db, offering, enrollment)
    first_open = next((i.id for i, _, _ in rows if i.kind in SEQUENCE_KINDS and i.id not in done), None)
    out = []
    for item, published, group in rows:
        out.append({"id": item.id, "kind": item.kind, "title": published.title,
                    "anchor_node_id": published.anchor_node_id if group != NO_GROUP else None,
                    "published_at": published.published_at, "file": file_view(db, published.file_id),
                    "completed": item.id in done if item.kind in SEQUENCE_KINDS else None,
                    "up_next": item.id == first_open})
    return out


def reorder(db, actor, offering, anchor_node_id, expected_ids, item_ids):
    """Faculty set the teaching order inside one chapter/topic (or "Other materials"). `expected_ids` is the
    order the faculty member was looking at; any other change to this group since then is a conflict. The
    group's items swap among the positions they already hold, so other groups are not disturbed."""
    anchor = str(anchor_node_id) if anchor_node_id else None
    group = []
    for item in db.scalars(select(LearningItem).where(LearningItem.offering_id == offering.id)
                           .order_by(LearningItem.position, LearningItem.created_at, LearningItem.id)
                           .with_for_update()):                      # a second tab waits here, then sees the new order
        rev = revision(db, item.id, "published") or revision(db, item.id, "draft")
        if (rev.anchor_node_id if rev else None) == anchor:
            group.append(item)
    if [i.id for i in group] != list(expected_ids) or sorted(item_ids, key=str) != sorted(expected_ids, key=str):
        fail(409, "order_conflict", "This list changed while you were reordering it. Reload and try again.")
    by_id = {i.id: i for i in group}
    for slot, item_id in zip(sorted(i.position for i in group), item_ids, strict=True):
        by_id[item_id].position = slot
    audit(db, actor, "items.reordered", "offering", offering.id, {"group": anchor, "count": len(group)})
    db.commit()


def student_item(db, offering, enrollment, item_id, student_id=None):
    item = db.get(LearningItem, item_id)
    published = revision(db, item.id, "published") if item and item.offering_id == offering.id \
        and not item.archived else None
    if not published or not targeted(section_ids_of(db, item.id), enrollment):
        fail(404, "not_found", "Item not found.")
    return {"id": item.id, "kind": item.kind, "title": published.title,
            "body_html": published.body_html, "reference_url": published.reference_url,
            "reference_note": published.reference_note, "file": file_view(db, published.file_id),
            "anchor_node_id": published.anchor_node_id, "published_at": published.published_at,
            **lesson_position(db, offering, enrollment, item, student_id)}


def lesson_position(db, offering, enrollment, item, student_id):
    """Completion, the next published lesson in the sequence (None after the last one), and whether every
    published lesson is done, so the last lesson never claims the course is finished when earlier ones are not."""
    lessons = [i for i, _, _ in ordered_published(db, offering, enrollment) if i.kind in SEQUENCE_KINDS]
    ids = [i.id for i in lessons]
    if item.kind not in SEQUENCE_KINDS or item.id not in ids:
        return {"completed": None, "next_lesson": None}
    here = ids.index(item.id)
    done = completed_lessons(db, student_id)
    pending = [i for i in lessons if i.id not in done]

    def named(lesson):
        return {"id": lesson.id, "title": revision(db, lesson.id, "published").title, "kind": lesson.kind}

    following = lessons[here + 1] if here + 1 < len(lessons) else None
    return {"completed": item.id in done, "lesson_number": here + 1, "lesson_total": len(ids),
            "next_lesson": named(following) if following else None,
            "all_completed": not pending, "first_incomplete": named(pending[0]) if pending else None}
