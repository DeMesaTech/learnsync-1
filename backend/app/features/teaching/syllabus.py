"""Syllabus: server-side drafts with compare-and-swap autosave, immutable published revisions."""
import uuid
from pathlib import Path

from sqlalchemy import func, select

from app.errors import fail
from app.features.academics.models import OfferingSection, Subject
from app.features.accounts.commands import audit
from app.features.accounts.models import now
from app.features.assessments.policy import assessments_outside_policy
from app.features.assessments.reviews import flag_review
from app.features.files.models import StoredFile
from app.features.files.storage import path_of, save_upload

from . import documents
from .models import (
    LearningItem,
    LearningItemRevision,
    Syllabus,
    SyllabusRevision,
    TeachingCoverage,
)
from .schemas import CourseInfo, GradingPolicy, Outline, node_ids

SOURCE_TYPES = {".docx", ".pdf"}


def view(db, rev):
    source = db.get(StoredFile, rev.source_file_id) if rev.source_file_id else None
    return {"id": rev.id, "version": rev.version, "state": rev.state,
            "counter": rev.draft_counter, "outline": rev.outline,
            "grading_policy": rev.grading_policy, "updated_at": rev.updated_at,
            "published_at": rev.published_at,
            "source_file": {"id": source.id, "name": source.original_name} if source else None}


def syllabus_row(db, offering_id, lock=False):
    """The offering's syllabus row, created on first use. Locking serialises draft changes."""
    query = select(Syllabus).where(Syllabus.offering_id == offering_id)
    row = db.scalar(query.with_for_update() if lock else query)
    if row:
        return row
    db.add(Syllabus(offering_id=offering_id))
    db.flush()
    return db.scalar(query.with_for_update() if lock else query)


def revision(db, syllabus_id, state):
    return db.scalar(select(SyllabusRevision).where(SyllabusRevision.syllabus_id == syllabus_id,
                                                    SyllabusRevision.state == state))


def faculty_state(db, offering):
    syllabus = db.scalar(select(Syllabus).where(Syllabus.offering_id == offering.id))
    if not syllabus:
        return {"published": None, "draft": None, "history": []}
    published, draft = revision(db, syllabus.id, "published"), revision(db, syllabus.id, "draft")
    history = db.scalars(select(SyllabusRevision).where(
        SyllabusRevision.syllabus_id == syllabus.id, SyllabusRevision.state != "draft")
        .order_by(SyllabusRevision.version.desc())).all()
    return {"published": view(db, published) if published else None,
            "draft": view(db, draft) if draft else None,
            "history": [{"version": r.version, "state": r.state, "published_at": r.published_at}
                        for r in history]}


def next_version(db, syllabus_id):
    return (db.scalar(select(func.max(SyllabusRevision.version))
                      .where(SyllabusRevision.syllabus_id == syllabus_id)) or 0) + 1


def locked_draft(db, offering, expected_counter):
    syllabus = syllabus_row(db, offering.id, lock=True)
    draft = db.scalar(select(SyllabusRevision).where(
        SyllabusRevision.syllabus_id == syllabus.id, SyllabusRevision.state == "draft")
        .with_for_update())
    if not draft:
        fail(404, "no_draft", "There is no draft to change. Start editing first.")
    if draft.draft_counter != expected_counter:
        fail(409, "draft_revision_conflict",
             "This draft changed elsewhere. Review the newer version before saving.")
    return syllabus, draft


def start_draft(db, actor, offering):
    syllabus = syllabus_row(db, offering.id, lock=True)
    draft = revision(db, syllabus.id, "draft")
    if draft:
        return draft
    published = revision(db, syllabus.id, "published")
    if published:
        outline, policy = published.outline, published.grading_policy
    else:
        subject = db.get(Subject, offering.subject_id)
        outline = Outline(course=CourseInfo(code=subject.code, name=subject.title,
                                            units=str(subject.units))).model_dump(mode="json")
        policy = None
    draft = SyllabusRevision(syllabus_id=syllabus.id, version=next_version(db, syllabus.id),
                             outline=outline, grading_policy=policy, created_by=actor.id)
    db.add(draft)
    audit(db, actor, "syllabus.draft_started", "offering", offering.id)
    db.commit()
    return draft


def save_draft(db, actor, offering, data):
    _, draft = locked_draft(db, offering, data.expected_counter)
    draft.outline = data.outline.model_dump(mode="json")
    draft.grading_policy = data.grading_policy.model_dump(mode="json") \
        if data.grading_policy else None
    draft.draft_counter += 1
    db.commit()
    return {"counter": draft.draft_counter, "updated_at": draft.updated_at}


def discard_draft(db, actor, offering, expected_counter):
    _, draft = locked_draft(db, offering, expected_counter)
    db.delete(draft)
    audit(db, actor, "syllabus.draft_discarded", "offering", offering.id)
    db.commit()


def import_source(db, actor, offering, upload):
    """Read a DOCX/PDF syllabus into a new draft; faculty reviews it before publishing."""
    syllabus = syllabus_row(db, offering.id, lock=True)
    if revision(db, syllabus.id, "draft"):
        fail(409, "draft_exists", "Finish or discard the current draft before importing.")
    file = save_upload(db, upload, "syllabus_source", actor, SOURCE_TYPES)
    ext = Path(file.original_name).suffix.lower()
    try:
        outline, warnings = documents.parse_syllabus(path_of(file), ext)
    except Exception:   # noqa: BLE001 - unreadable files fall back to manual editing
        outline, warnings = None, []
    if outline is None or not (outline.chapters or outline.outcomes):
        warnings = [("This file could not be read into an outline (scanned documents are not "
                     "supported). Build the syllabus manually; the file stays attached as a "
                     "source.")]
        subject = db.get(Subject, offering.subject_id)
        outline = Outline(course=CourseInfo(code=subject.code, name=subject.title,
                                            units=str(subject.units)))
    draft = SyllabusRevision(syllabus_id=syllabus.id, version=next_version(db, syllabus.id),
                             outline=outline.model_dump(mode="json"), source_file_id=file.id,
                             created_by=actor.id)
    db.add(draft)
    audit(db, actor, "syllabus.imported", "offering", offering.id, {"file": file.original_name})
    db.commit()
    return draft, warnings


def policy_errors(policy):
    if not policy:
        return []
    errors = []
    policy = GradingPolicy.model_validate(policy)
    if any(not c.label.strip() for c in policy.categories):
        errors.append("Name every grading category.")
    if len({c.key for c in policy.categories}) != len(policy.categories) \
            or len({p.key for p in policy.periods}) != len(policy.periods):
        errors.append("Category keys and period keys must be unique.")
    if policy.categories and abs(sum(c.weight for c in policy.categories) - 100) > 0.01:
        errors.append("Category weights must total 100%.")
    if policy.periods and abs(sum(p.share for p in policy.periods) - 100) > 0.01:
        errors.append("Period shares must total 100%.")
    return errors


def publish(db, actor, offering, expected_counter):
    syllabus, draft = locked_draft(db, offering, expected_counter)
    outline = draft.outline
    problems = []
    if not outline["course"]["name"].strip():
        problems.append("Add the course name.")
    if not any(c["title"].strip() for c in outline["chapters"]):
        problems.append("Add at least one chapter with a title.")
    if any(not t["title"].strip() for c in outline["chapters"] for t in c["topics"]):
        problems.append("Every topic needs a title.")
    problems += policy_errors(draft.grading_policy)
    dropped = assessments_outside_policy(db, offering.id, draft.grading_policy)
    if dropped:
        problems.append("Graded work would no longer match this grading policy (its category or "
                        "period is missing). Keep the category/period or archive: "
                        + ", ".join(dropped) + ".")
    ids = node_ids(outline)
    orphaned = db.scalars(
        select(LearningItemRevision.title)
        .join(LearningItem, LearningItem.id == LearningItemRevision.item_id)
        .where(LearningItem.offering_id == offering.id, LearningItem.archived.is_(False),
               LearningItemRevision.state.in_(["draft", "published"]),
               LearningItemRevision.anchor_node_id.is_not(None),
               LearningItemRevision.anchor_node_id.not_in(ids or {""}))).all()
    if orphaned:
        problems.append("These items point at topics you removed; re-attach or archive them: "
                        + ", ".join(sorted(set(orphaned))) + ".")
    if problems:
        fail(422, "syllabus_incomplete", " ".join(problems))
    previous = revision(db, syllabus.id, "published")
    if previous:
        if previous.grading_policy != draft.grading_policy:
            flag_review(db, offering.id, "The grading policy changed.")
        previous.state = "superseded"
        db.flush()
    draft.state, draft.published_at, draft.published_by = "published", now(), actor.id
    audit(db, actor, "syllabus.published", "offering", offering.id, {"version": draft.version})
    db.commit()
    return draft


# ---------- teaching coverage (faculty-recorded; separate from student completion) ----------

def coverage_rows(db, offering_id, section_id=None):
    query = select(TeachingCoverage).where(TeachingCoverage.offering_id == offering_id)
    if section_id:
        query = query.where(TeachingCoverage.section_id == section_id)
    return [{"section_id": c.section_id, "node_id": c.node_id, "covered_on": c.covered_on}
            for c in db.scalars(query)]


def set_coverage(db, actor, offering, data):
    if not db.scalar(select(OfferingSection.section_id).where(
            OfferingSection.offering_id == offering.id,
            OfferingSection.section_id == data.section_id)):
        fail(422, "section_invalid", "Choose one of this subject's sections.")
    published = db.scalar(select(SyllabusRevision).join(
        Syllabus, Syllabus.id == SyllabusRevision.syllabus_id)
        .where(Syllabus.offering_id == offering.id, SyllabusRevision.state == "published"))
    if not published or str(data.node_id) not in node_ids(published.outline):
        fail(422, "node_invalid", "Choose a chapter or topic from the published syllabus.")
    row = db.scalar(select(TeachingCoverage).where(
        TeachingCoverage.offering_id == offering.id,
        TeachingCoverage.section_id == data.section_id,
        TeachingCoverage.node_id == str(data.node_id)))
    if row:
        row.covered_on, row.recorded_by = data.covered_on, actor.id
    else:
        db.add(TeachingCoverage(offering_id=offering.id, section_id=data.section_id,
                                node_id=str(data.node_id), covered_on=data.covered_on,
                                recorded_by=actor.id))
    db.commit()


def clear_coverage(db, actor, offering, section_id: uuid.UUID, node_id: uuid.UUID):
    row = db.scalar(select(TeachingCoverage).where(
        TeachingCoverage.offering_id == offering.id, TeachingCoverage.section_id == section_id,
        TeachingCoverage.node_id == str(node_id)))
    if not row:
        fail(404, "not_found", "No coverage is recorded for this topic.")
    db.delete(row)
    db.commit()


# ---------- student projection ----------

def student_view(db, offering, enrollment):
    syllabus = db.scalar(select(Syllabus).where(Syllabus.offering_id == offering.id))
    published = revision(db, syllabus.id, "published") if syllabus else None
    if not published:
        return {"published": None, "covered": []}
    covered = coverage_rows(db, offering.id, enrollment.section_id)
    return {"published": {"version": published.version, "published_at": published.published_at,
                          "outline": published.outline,
                          "grading_policy": published.grading_policy},
            "covered": [{"node_id": c["node_id"], "covered_on": c["covered_on"]}
                        for c in covered]}

