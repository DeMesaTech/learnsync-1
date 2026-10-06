import uuid
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.features.academics.models import AcademicTerm, Subject
from app.features.accounts.commands import audit
from app.features.accounts.models import now
from app.features.assessments.standing import student_standing
from app.features.teaching.access import teaching_offering
from app.security import require_role

from .render import safe_filename, to_pdf, to_xlsx
from .standing_pdf import to_standing_pdf
from .tables import grade_table, local_stamp

router = APIRouter(prefix="/api", tags=["Exports"])
faculty = require_role("faculty")   # administrators run the school, not a teacher's gradebook

TYPES = {"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
         "pdf": "application/pdf"}


@router.get("/teach/offerings/{offering_id}/exports/grades")
def export_grades(offering_id: UUID, format: Literal["pdf", "xlsx"],
                  period: Literal["midterm", "finals", "course"],
                  basis: Literal["published", "working"] = "published",
                  section_id: uuid.UUID | None = Query(default=None), rank: bool = False,
                  actor=Depends(faculty), db: Session = Depends(get_db)):
    offering = teaching_offering(db, offering_id, actor, write=False)   # own offering; closed terms stay readable
    table = grade_table(db, actor, offering, period, basis, section_id, rank)
    body = to_pdf(table) if format == "pdf" else to_xlsx(table)
    audit(db, actor, "grades.exported", "offering", offering.id,
          {"format": format, "period": period, "basis": basis, "ranked": rank,
           "section_id": str(section_id) if section_id else None, "students": len(table["rows"])})
    db.commit()
    name = safe_filename(table["filename"] + ("-PREVIEW" if basis == "working" else "")) + f".{format}"
    return Response(body, media_type=TYPES[format], headers={
        "Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"})


@router.get("/teach/offerings/{offering_id}/students/{student_id}/standing.pdf")
def export_standing(offering_id: UUID, student_id: UUID, basis: Literal["published", "working"] = "published",
                    actor=Depends(faculty), db: Session = Depends(get_db)):
    offering = teaching_offering(db, offering_id, actor, write=False)
    data = student_standing(db, offering, student_id)               # 404 for a student who is not in this subject
    subject, term = db.get(Subject, offering.subject_id), db.get(AcademicTerm, offering.term_id)
    body = to_standing_pdf(data, {"subject": f"{subject.code} {subject.title}", "term": term.name,
                                  "faculty": actor.display_name, "generated_at": local_stamp(now())}, basis)
    audit(db, actor, "standing.exported", "offering", offering.id, {"student_id": str(student_id), "basis": basis})
    db.commit()
    name = safe_filename(f"standing-{subject.code}-{data['student']['student_number']}" + ("-FACULTY-COPY" if basis == "working" else "")) + ".pdf"
    return Response(body, media_type=TYPES["pdf"], headers={
        "Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"})


@router.get("/teach/offerings/{offering_id}/class-standing")
def class_standing(offering_id: UUID, period: Literal["midterm", "finals", "course"],
                   basis: Literal["published", "working"] = "published",
                   section_id: uuid.UUID | None = Query(default=None),
                   actor=Depends(faculty), db: Session = Depends(get_db)):
    """Grades and rank of the enrolled students, for the assigned teacher only; never exposed to students."""
    offering = teaching_offering(db, offering_id, actor, write=False)
    table = grade_table(db, actor, offering, period, basis, section_id, rank=True)
    return {"banner": table["banner"], "meta": table["meta"], "notes": table["notes"], "columns": table["columns"],
            "rows": table["rows"], "student_ids": table["student_ids"], "counts": table["counts"],
            "ranking": table["ranking"]}
