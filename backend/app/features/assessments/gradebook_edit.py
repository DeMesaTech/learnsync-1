"""Edit-scores mode: save many gradebook cells in one request, all or nothing."""
from fastapi import HTTPException

from app.errors import fail

from . import scores, submissions
from .definitions import get_assessment
from .schemas import ScoreInput


def save_batch(db, actor, offering, cells):
    """Every cell goes through the same checks as a single score (published, student applies, not above the maximum,
    quiz rules, and the expected revision). If ANY cell is rejected nothing at all is saved and every rejected cell is
    named, so the teacher never ends up with half a table saved."""
    problems, seen, assessments = {}, set(), {}
    for cell in cells:
        key = f"{cell.assessment_id}:{cell.student_id}"
        if key in seen:
            problems[key] = "This cell is listed twice."
            continue
        seen.add(key)
        try:
            if cell.assessment_id not in assessments:
                assessments[cell.assessment_id] = get_assessment(db, offering, cell.assessment_id)
            assessment = assessments[cell.assessment_id]
            last = submissions.latest(db, assessment.id, cell.student_id) if assessment.kind == "activity" else None
            scores.apply_score(db, actor, offering, assessment, cell.student_id,
                               ScoreInput(score=cell.score, feedback=cell.feedback,
                                          expected_revision=cell.expected_revision), last.id if last else None)
        except HTTPException as error:
            problems[key] = error.detail["message"] if isinstance(error.detail, dict) else str(error.detail)
    if problems:
        db.rollback()
        fail(409, "batch_rejected",
             f"{len(problems)} score{'s' if len(problems) != 1 else ''} could not be saved, so nothing was saved.",
             problems)
    db.commit()
    return {"saved": len(cells)}
