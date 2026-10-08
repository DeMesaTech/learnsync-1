from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import fail
from app.security import current_account, require_role

from . import commands, imports, queries
from .schemas import (
    BulkOfferingInput,
    DraftSave,
    ExceptionInput,
    MemberInput,
    OfferingInput,
    OfferingUpdate,
    Reason,
    Revision,
    SchoolYearInput,
    SectionInput,
    SubjectInput,
    SubjectUpdate,
    TermUpdate,
)

router = APIRouter(prefix="/api", tags=["Academics"])
admin = require_role("admin")
faculty = require_role("faculty")
student = require_role("student")


def roster_actor(account=Depends(current_account)):
    if account.role not in {"admin", "faculty"}:
        fail(403, "role_forbidden", "Your account cannot perform this action.")
    return account


# ---- school years and terms (admin) ----

@router.get("/school-years")
def school_years(actor=Depends(admin), db: Session = Depends(get_db)):
    return queries.school_years(db)


@router.post("/school-years", status_code=201)
def create_school_year(data: SchoolYearInput, actor=Depends(admin), db: Session = Depends(get_db)):
    year = commands.create_school_year(db, actor, data)
    return next(y for y in queries.school_years(db) if y["id"] == year.id)


@router.patch("/terms/{term_id}")
def update_term(term_id: UUID, data: TermUpdate, actor=Depends(admin),
                db: Session = Depends(get_db)):
    return queries.term_view(commands.update_term(db, actor, term_id, data))


@router.post("/terms/{term_id}/close")
def close_term(term_id: UUID, actor=Depends(admin), db: Session = Depends(get_db)):
    return queries.term_view(commands.close_term(db, actor, term_id))


@router.post("/terms/{term_id}/reopen")
def reopen_term(term_id: UUID, data: Reason, actor=Depends(admin),
                db: Session = Depends(get_db)):
    return queries.term_view(commands.reopen_term(db, actor, term_id, data.reason))


@router.post("/terms/{term_id}/copy-structure", status_code=204)
def copy_structure(term_id: UUID, source_term_id: UUID, offerings: bool = False,
                   actor=Depends(admin), db: Session = Depends(get_db)):
    commands.copy_term_structure(db, actor, term_id, source_term_id, offerings)
    return Response(status_code=204)


# ---- subject catalog (admin) ----

@router.get("/subjects")
def subjects(include_archived: bool = False, actor=Depends(admin), db: Session = Depends(get_db)):
    return queries.subjects(db, include_archived)


@router.post("/subjects", status_code=201)
def create_subject(data: SubjectInput, actor=Depends(admin), db: Session = Depends(get_db)):
    return queries.subject_view(commands.create_subject(db, actor, data))


@router.patch("/subjects/{subject_id}")
def update_subject(subject_id: UUID, data: SubjectUpdate, actor=Depends(admin),
                   db: Session = Depends(get_db)):
    return queries.subject_view(commands.update_subject(db, actor, subject_id, data))


# ---- sections and rosters (admin) ----

@router.get("/terms/{term_id}/sections")
def sections(term_id: UUID, actor=Depends(admin), db: Session = Depends(get_db)):
    return queries.sections(db, term_id)


@router.post("/terms/{term_id}/sections", status_code=201)
def create_section(term_id: UUID, data: SectionInput, actor=Depends(admin),
                   db: Session = Depends(get_db)):
    section = commands.create_section(db, actor, term_id, data)
    return {"id": section.id, "term_id": section.term_id, "name": section.name,
            "year_level": section.year_level, "member_count": 0}


@router.get("/sections/{section_id}/members")
def section_members(section_id: UUID, actor=Depends(admin), db: Session = Depends(get_db)):
    return queries.section_members(db, section_id)


@router.post("/sections/{section_id}/members", status_code=204)
def add_member(section_id: UUID, data: MemberInput, actor=Depends(admin),
               db: Session = Depends(get_db)):
    commands.add_member(db, actor, section_id, data.student_id)
    return Response(status_code=204)


@router.get("/sections/{section_id}/roster")
def section_roster(section_id: UUID, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                   search: str = Query("", max_length=100), status: str = Query("active", pattern="^(active|withdrawn|all)$"),
                   actor=Depends(admin), db: Session = Depends(get_db)):
    return queries.section_roster_page(db, section_id, page, page_size, search, status)


@router.get("/sections/{section_id}/candidates")
def section_candidates(section_id: UUID, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                       search: str = Query("", max_length=100),
                       account: str = Query("all", pattern="^(all|active|invited)$"),
                       actor=Depends(admin), db: Session = Depends(get_db)):
    return queries.section_candidates(db, section_id, page, page_size, search, account)


@router.delete("/sections/{section_id}/members/{student_id}", status_code=204)
def withdraw_member(section_id: UUID, student_id: UUID, reason: str = Query(max_length=1000),
                    actor=Depends(admin), db: Session = Depends(get_db)):
    commands.withdraw_member(db, actor, section_id, student_id, reason)
    return Response(status_code=204)


# ---- offerings and enrollment ----

@router.get("/terms/{term_id}/offerings")
def term_offerings(term_id: UUID, actor=Depends(admin), db: Session = Depends(get_db)):
    return queries.term_offerings(db, term_id)


@router.post("/terms/{term_id}/offerings", status_code=201)
def create_offering(term_id: UUID, data: OfferingInput, actor=Depends(admin),
                    db: Session = Depends(get_db)):
    offering = commands.create_offering(db, actor, term_id, data)
    return queries.offering_summary(db, [offering])[0]


@router.post("/terms/{term_id}/offerings/bulk", status_code=201)
def create_offerings_bulk(term_id: UUID, data: BulkOfferingInput, actor=Depends(admin),
                          db: Session = Depends(get_db)):
    made = commands.create_offerings_bulk(db, actor, term_id, data)
    return queries.offering_summary(db, made)


@router.patch("/offerings/{offering_id}")
def update_offering(offering_id: UUID, data: OfferingUpdate, actor=Depends(admin),
                    db: Session = Depends(get_db)):
    offering = commands.update_offering(db, actor, offering_id, data)
    return queries.offering_summary(db, [offering])[0]


@router.get("/offerings/{offering_id}")
def offering_detail(offering_id: UUID, actor=Depends(roster_actor), db: Session = Depends(get_db)):
    return queries.offering_detail(db, offering_id, actor)


@router.get("/offerings/{offering_id}/students")
def offering_students(offering_id: UUID, history: bool = False, actor=Depends(roster_actor),
                      db: Session = Depends(get_db)):
    return queries.offering_roster(db, offering_id, actor, history)


@router.put("/offerings/{offering_id}/exceptions/{student_id}", status_code=204)
def set_exception(offering_id: UUID, student_id: UUID, data: ExceptionInput,
                  actor=Depends(admin), db: Session = Depends(get_db)):
    commands.set_exception(db, actor, offering_id, student_id, data)
    return Response(status_code=204)


@router.delete("/offerings/{offering_id}/exceptions/{student_id}", status_code=204)
def clear_exception(offering_id: UUID, student_id: UUID, actor=Depends(admin),
                    db: Session = Depends(get_db)):
    commands.clear_exception(db, actor, offering_id, student_id)
    return Response(status_code=204)


# ---- role-scoped views ----

@router.get("/me/offerings")
def my_offerings(actor=Depends(faculty), db: Session = Depends(get_db)):
    return queries.my_offerings(db, actor)


@router.get("/me/subjects")
def my_subjects(actor=Depends(student), db: Session = Depends(get_db)):
    return queries.my_subjects(db, actor)


# ---- reviewed imports (admin) ----

@router.post("/student-imports", status_code=201)
def create_student_import(file: UploadFile = File(...), term_id: UUID | None = Form(None),
                          actor=Depends(admin), db: Session = Depends(get_db)):
    imp = imports.create_student_import(db, actor, file, term_id)
    return imports.student_preview(db, imp)


@router.get("/student-imports/{import_id}")
def student_import(import_id: UUID, actor=Depends(admin), db: Session = Depends(get_db)):
    imp = commands.get_or_404(db, imports.StudentImport, import_id, "Import")
    return imports.student_preview(db, imp)


@router.post("/student-imports/{import_id}/commit")
def commit_student_import(import_id: UUID, actor=Depends(admin), db: Session = Depends(get_db)):
    return imports.commit_student_import(db, actor, import_id)


@router.post("/prospectus-imports", status_code=201)
def create_prospectus_import(file: UploadFile | None = File(None), actor=Depends(admin),
                             db: Session = Depends(get_db)):
    return imports.prospectus_view(db, imports.create_prospectus_import(db, actor, file))


@router.get("/prospectus-imports/{import_id}")
def prospectus_import(import_id: UUID, actor=Depends(admin), db: Session = Depends(get_db)):
    return imports.prospectus_view(
        db, commands.get_or_404(db, imports.ProspectusImport, import_id, "Prospectus import"))


@router.put("/prospectus-imports/{import_id}")
def save_prospectus_draft(import_id: UUID, data: DraftSave, actor=Depends(admin),
                          db: Session = Depends(get_db)):
    imp = imports.save_prospectus_draft(db, actor, import_id, data.expected_revision,
                                        data.subjects)
    return imports.prospectus_view(db, imp)


@router.post("/prospectus-imports/{import_id}/commit")
def commit_prospectus(import_id: UUID, data: Revision, actor=Depends(admin),
                      db: Session = Depends(get_db)):
    return imports.commit_prospectus(db, actor, import_id, data.expected_revision)
