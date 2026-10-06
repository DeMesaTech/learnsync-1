"""The grading policy lives on the PUBLISHED syllabus revision; its version is recorded in snapshots."""
from sqlalchemy import select

from app.errors import fail
from app.features.teaching.models import Syllabus, SyllabusRevision

from .models import Assessment, AssessmentRevision


def published_policy(db, offering_id):
    """(policy dict | None, syllabus version | None)."""
    rev = db.scalar(select(SyllabusRevision)
                    .join(Syllabus, Syllabus.id == SyllabusRevision.syllabus_id)
                    .where(Syllabus.offering_id == offering_id,
                           SyllabusRevision.state == "published"))
    if not rev or not rev.grading_policy or not rev.grading_policy.get("categories"):
        return None, (rev.version if rev else None)
    return rev.grading_policy, rev.version


def require_policy(db, offering_id):
    policy, version = published_policy(db, offering_id)
    if not policy:
        fail(422, "policy_missing",
             "Publish a syllabus with a confirmed grading policy first. LearnSync does not "
             "guess category weights.")
    return policy, version


def category_keys(policy):
    return {c["key"] for c in policy["categories"]}


def period_keys(policy):
    return {p["key"] for p in policy.get("periods", [])}


def assessments_outside_policy(db, offering_id, policy):
    """Titles of live graded assessments whose category or period the given policy lacks.

    Grades only count work that matches the policy, so such work would silently vanish from
    the calculation if the policy were published as it is."""
    categories = {c["key"] for c in (policy or {}).get("categories", [])}
    periods = {p["key"] for p in (policy or {}).get("periods", [])}
    titles = []
    rows = db.execute(
        select(AssessmentRevision.title, AssessmentRevision.category_key, AssessmentRevision.period)
        .join(Assessment, Assessment.id == AssessmentRevision.assessment_id)
        .where(Assessment.offering_id == offering_id, Assessment.archived.is_(False),
               AssessmentRevision.state == "published",
               AssessmentRevision.include_in_grade.is_(True)))
    for title, category, period in rows:
        if category not in categories or period not in periods:
            titles.append(title)
    return sorted(set(titles))
