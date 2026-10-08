"""Skeleton-first setup: plan many hidden draft assessments at once, store the class meeting days, and copy a
previous subject into an EMPTY one. Everything created here is a draft; nothing is visible to students or
counted in grades until it is finished and published the normal way."""
import copy
import shutil
import uuid

from sqlalchemy import func, select

from app.config import settings
from app.errors import fail
from app.features.accounts.commands import audit
from app.features.accounts.models import AuditEvent
from app.features.files.models import StoredFile
from app.features.files.storage import path_of
from app.features.teaching.models import (
    LearningItem,
    LearningItemRevision,
    Syllabus,
    SyllabusRevision,
)

from .definitions import section_ids_of
from .models import Assessment, AssessmentRevision, AssessmentSection, QuizQuestion


def draft_or_published_policy(db, offering_id):
    """The policy being edited (draft) else the published one: the wizard sets it before planning."""
    for state in ("draft", "published"):
        rev = db.scalar(select(SyllabusRevision).join(Syllabus, Syllabus.id == SyllabusRevision.syllabus_id)
                        .where(Syllabus.offering_id == offering_id, SyllabusRevision.state == state))
        if rev and rev.grading_policy and rev.grading_policy.get("categories"):
            return rev.grading_policy
    return None


def plan(db, actor, offering, data):
    earlier = db.scalar(select(AuditEvent).where(
        AuditEvent.action == "assessment.planned", AuditEvent.entity_id == str(offering.id),
        AuditEvent.details["plan_key"].astext == data.plan_key))
    if earlier:
        return {"ids": earlier.details["ids"], "repeat": True}
    policy = draft_or_published_policy(db, offering.id)
    if policy:
        known = {c["key"] for c in policy["categories"]}
        periods = {p["key"] for p in policy.get("periods", [])}
        for item in data.items:
            if item.category_key and item.category_key not in known:
                fail(422, "category_unknown", f"“{item.title}” uses a grading category the policy does not have.")
            if item.period and item.period not in periods:
                fail(422, "period_unknown", f"“{item.title}” uses a grading period the policy does not have.")
    ids = []
    for item in data.items:
        a = Assessment(offering_id=offering.id, kind=item.kind, created_by=actor.id)
        db.add(a)
        db.flush()
        db.add(AssessmentRevision(assessment_id=a.id, version=1, title=item.title, created_by=actor.id,
                                  category_key=item.category_key, period=item.period,
                                  max_attempts=1, include_in_grade=True))
        ids.append(str(a.id))
    audit(db, actor, "assessment.planned", "offering", offering.id,
          {"plan_key": data.plan_key, "count": len(ids), "ids": ids})
    db.commit()
    return {"ids": ids, "repeat": False}


def set_schedule(db, actor, offering, days):
    offering.meeting_days = days
    audit(db, actor, "offering.schedule_set", "offering", offering.id, {"meeting_days": days})
    db.commit()
    return {"meeting_days": days}


def is_empty(db, offering_id):
    return not (db.scalar(select(func.count()).select_from(Syllabus).where(Syllabus.offering_id == offering_id))
                or db.scalar(select(func.count()).select_from(LearningItem).where(LearningItem.offering_id == offering_id))
                or db.scalar(select(func.count()).select_from(Assessment).where(Assessment.offering_id == offering_id)))


def best(db, model, owner_column, owner_id):
    """The published revision, else the draft: what the previous subject was actually teaching."""
    for state in ("published", "draft"):
        rev = db.scalar(select(model).where(owner_column == owner_id, model.state == state))
        if rev:
            return rev
    return None


def duplicate_file(db, actor, file):
    """A new stored file with the same bytes: material access is judged per offering, so subjects never share a blob."""
    source = path_of(file)
    if not source.is_file():
        return None
    new_id = uuid.uuid4()
    key = f"{new_id.hex[:2]}/{new_id.hex}"
    dest = settings().upload_root / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, dest)
    clone = StoredFile(id=new_id, original_name=file.original_name, content_type=file.content_type,
                       size=file.size, sha256=file.sha256, storage_key=key, purpose=file.purpose,
                       uploader_id=actor.id)
    db.add(clone)
    db.flush()
    return clone


def copy_from(db, actor, target, source):
    """Copy a previous subject of the same teacher into an empty one, as drafts only (never sections, dates,
    attempts, scores, submissions, students, announcements or attendance)."""
    if source.id == target.id:
        fail(422, "copy_same", "Choose a different subject to copy from.")
    if not is_empty(db, target.id):
        fail(409, "subject_not_empty", "This subject already has a syllabus, materials or assessments, "
             "so nothing was copied. Copying only fills an empty subject.")
    result = {"syllabus": False, "items": 0, "assessments": 0, "skipped_files": 0}
    row = db.scalar(select(Syllabus).where(Syllabus.offering_id == source.id))
    base = best(db, SyllabusRevision, SyllabusRevision.syllabus_id, row.id) if row else None
    if base:
        syllabus = Syllabus(offering_id=target.id)
        db.add(syllabus)
        db.flush()
        db.add(SyllabusRevision(syllabus_id=syllabus.id, version=1, outline=copy.deepcopy(base.outline),
                                grading_policy=copy.deepcopy(base.grading_policy), created_by=actor.id))
        result["syllabus"] = True
    items = db.scalars(select(LearningItem).where(LearningItem.offering_id == source.id,
                                                  LearningItem.archived.is_(False))
                       .order_by(LearningItem.position, LearningItem.created_at)).all()
    for position, item in enumerate(items, start=1):
        rev = best(db, LearningItemRevision, LearningItemRevision.item_id, item.id)
        if not rev:
            continue
        file_id = None
        if item.kind == "file":
            clone = duplicate_file(db, actor, db.get(StoredFile, rev.file_id)) if rev.file_id else None
            if not clone:
                result["skipped_files"] += 1
                continue
            file_id = clone.id
        new = LearningItem(offering_id=target.id, kind=item.kind, created_by=actor.id, position=position)
        db.add(new)
        db.flush()
        db.add(LearningItemRevision(item_id=new.id, version=1, title=rev.title, body_html=rev.body_html,
                                    file_id=file_id, reference_url=rev.reference_url,
                                    reference_note=rev.reference_note, anchor_node_id=rev.anchor_node_id,
                                    created_by=actor.id))
        result["items"] += 1
    for a in db.scalars(select(Assessment).where(Assessment.offering_id == source.id,
                                                 Assessment.archived.is_(False)).order_by(Assessment.created_at)):
        rev = best(db, AssessmentRevision, AssessmentRevision.assessment_id, a.id)
        if not rev:
            continue
        new = Assessment(offering_id=target.id, kind=a.kind, created_by=actor.id)
        db.add(new)
        db.flush()
        draft = AssessmentRevision(
            assessment_id=new.id, version=1, created_by=actor.id, title=rev.title, instructions=rev.instructions,
            category_key=rev.category_key, period=rev.period, max_points=rev.max_points, allow_late=rev.allow_late,
            max_attempts=rev.max_attempts, score_rule=rev.score_rule, include_in_grade=rev.include_in_grade,
            anchor_node_id=rev.anchor_node_id, ai_generated=rev.ai_generated, ai_language=rev.ai_language)
        db.add(draft)    # dates are left empty: last semester's deadlines mean nothing now
        db.flush()
        for q in db.scalars(select(QuizQuestion).where(QuizQuestion.revision_id == rev.id)
                            .order_by(QuizQuestion.position)):
            db.add(QuizQuestion(revision_id=draft.id, key=q.key, position=q.position, type=q.type, prompt=q.prompt,
                                choices=q.choices, correct=q.correct, explanation=q.explanation, points=q.points,
                                source=q.source))
        result["assessments"] += 1
    audit(db, actor, "subject.copied", "offering", target.id, {"from": str(source.id), **result})
    db.commit()
    return result


def duplicate(db, actor, offering, assessment):
    """A new hidden draft with the same settings and questions; dates and records are never copied."""
    rev = best(db, AssessmentRevision, AssessmentRevision.assessment_id, assessment.id)
    if not rev:
        fail(409, "nothing_to_copy", "This assessment has no content to copy.")
    new = Assessment(offering_id=offering.id, kind=assessment.kind, created_by=actor.id)
    db.add(new)
    db.flush()
    draft = AssessmentRevision(
        assessment_id=new.id, version=1, created_by=actor.id, title=f"Copy of {rev.title}"[:200],
        instructions=rev.instructions, category_key=rev.category_key, period=rev.period, max_points=rev.max_points,
        allow_late=rev.allow_late, max_attempts=rev.max_attempts, score_rule=rev.score_rule,
        include_in_grade=rev.include_in_grade, anchor_node_id=rev.anchor_node_id, ai_generated=rev.ai_generated,
        ai_language=rev.ai_language)
    db.add(draft)
    db.flush()
    for q in db.scalars(select(QuizQuestion).where(QuizQuestion.revision_id == rev.id).order_by(QuizQuestion.position)):
        db.add(QuizQuestion(revision_id=draft.id, key=q.key, position=q.position, type=q.type, prompt=q.prompt,
                            choices=q.choices, correct=q.correct, explanation=q.explanation, points=q.points,
                            source=q.source))
    for section_id in section_ids_of(db, assessment.id):
        db.add(AssessmentSection(assessment_id=new.id, section_id=section_id))
    audit(db, actor, "assessment.duplicated", "assessment", new.id, {"from": str(assessment.id)})
    db.commit()
    return new
