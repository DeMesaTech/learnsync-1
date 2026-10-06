"""The administrator home page: setup status and account counts. Deliberately NO grades, scores, submissions,
teaching drafts or study conversations: an aggregate of private data is still private data."""
from sqlalchemy import func, select

from app.features.academics.models import (
    AcademicTerm,
    Enrollment,
    Offering,
    SchoolYear,
    Section,
    StudentImport,
    Subject,
)
from app.features.accounts.models import Account, AuditEvent
from app.features.support.models import IssueReport

RECENT = 6
# only changes to people and access: routine sign-ins would bury them
ACCOUNT_CHANGES = ("account.invited", "account.activated", "account.status_changed", "account.bootstrapped",
                   "account.handed_over", "account.handover_initiated", "account.link_sent", "account.password_reset")


def count(db, query):
    return db.scalar(query) or 0


def admin_dashboard(db, admin):
    terms = []
    for term, year in db.execute(select(AcademicTerm, SchoolYear)
                                 .join(SchoolYear, SchoolYear.id == AcademicTerm.school_year_id)
                                 .where(AcademicTerm.status == "open").order_by(AcademicTerm.start_date)):
        terms.append({
            "id": term.id, "name": term.name, "school_year": year.label,
            "sections": count(db, select(func.count()).select_from(Section).where(Section.term_id == term.id)),
            "offerings": count(db, select(func.count()).select_from(Offering).where(Offering.term_id == term.id)),
            "students": count(db, select(func.count(func.distinct(Enrollment.student_id)))
                              .select_from(Enrollment).join(Offering, Offering.id == Enrollment.offering_id)
                              .where(Offering.term_id == term.id, Enrollment.status == "enrolled"))})
    by_role = dict(db.execute(select(Account.role, func.count()).where(Account.status == "active")
                              .group_by(Account.role)).all())
    status = dict(db.execute(select(Account.status, func.count()).group_by(Account.status)).all())
    issues = dict(db.execute(select(IssueReport.status, func.count()).group_by(IssueReport.status)).all())
    recent = [{"action": a.action, "who": a.actor_label, "at": a.created_at}
              for a in db.scalars(select(AuditEvent).where(AuditEvent.action.in_(ACCOUNT_CHANGES))
                                  .order_by(AuditEvent.created_at.desc()).limit(RECENT))]
    return {"name": admin.display_name, "terms": terms,
            "accounts": {"students": by_role.get("student", 0), "faculty": by_role.get("faculty", 0),
                         "admins": by_role.get("admin", 0), "invited": status.get("invited", 0),
                         "inactive": status.get("inactive", 0)},
            "subjects": count(db, select(func.count()).select_from(Subject)),
            "pending_imports": count(db, select(func.count()).select_from(StudentImport)
                                     .where(StudentImport.status == "previewed")),
            "issues": {"open": issues.get("open", 0), "in_progress": issues.get("in_progress", 0)},
            "recent_activity": recent}
