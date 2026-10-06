from datetime import timedelta

from helpers import Api
from sqlalchemy import select

from app.features.accounts.models import now
from app.features.support.models import IssueReport

REPORT = {"type": "bug", "title": "Quiz page is blank", "description": "I open the quiz and see nothing at all.",
          "page": "/student/offerings/x/work"}


def test_students_and_faculty_report_and_follow_their_own_reports(world):
    student, teacher = Api("s1@example.com"), Api("faculty@example.com")
    first = student.post("/api/issues", REPORT)
    assert first.status_code == 201 and first.json()["status"] == "open" and first.json()["admin_note"] == ""
    teacher.post("/api/issues", {**REPORT, "type": "content", "title": "Typo in the syllabus form"})
    assert [i["title"] for i in student.get("/api/issues").json()["items"]] == ["Quiz page is blank"]     # only their own
    assert [i["title"] for i in teacher.get("/api/issues").json()["items"]] == ["Typo in the syllabus form"]
    assert "reporter" not in first.json()                                                          # no one else's identity


def test_an_administrator_works_a_report_through_its_lifecycle(db, world):
    student, admin = Api("s1@example.com"), world["admin"]
    issue = student.post("/api/issues", REPORT).json()
    overview = admin.get("/api/admin/issues").json()
    assert overview["counts"] == {"open": 1, "in_progress": 0, "resolved": 0}
    row = overview["issues"][0]
    assert row["reporter"]["email"] == "s1@example.com" and row["reporter"]["role"] == "student"
    started = admin.patch(f"/api/admin/issues/{issue['id']}", {"status": "in_progress", "admin_note": "Looking into it."})
    assert started.status_code == 200 and started.json()["status"] == "in_progress"
    assert student.get("/api/issues").json()["items"][0]["admin_note"] == "Looking into it."            # the reporter sees the note
    done = admin.patch(f"/api/admin/issues/{issue['id']}", {"status": "resolved"})
    assert done.json()["status"] == "resolved" and done.json()["admin_note"] == "Looking into it."
    reopened = admin.patch(f"/api/admin/issues/{issue['id']}", {"status": "open"})
    assert reopened.json()["status"] == "open"
    assert admin.get("/api/admin/issues?status=resolved").json()["issues"] == []
    assert len(admin.get("/api/admin/issues?status=open").json()["issues"]) == 1
    events = [e for e in admin.get("/api/audit").json() if e["action"] == "issue.reviewed"]
    assert [(e["details"]["from"], e["details"]["to"]) for e in reversed(events)] == [
        ("open", "in_progress"), ("in_progress", "resolved"), ("resolved", "open")]
    stored = db.scalar(select(IssueReport))
    assert stored.reviewed_by is not None and stored.reviewed_at is not None


def test_roles_are_enforced_on_both_sides(world):
    student, teacher, admin = Api("s1@example.com"), Api("faculty@example.com"), world["admin"]
    issue = student.post("/api/issues", REPORT).json()
    assert admin.post("/api/issues", REPORT).status_code == 403            # admins review, they do not report
    assert admin.get("/api/issues").status_code == 403
    for who in (student, teacher):
        assert who.get("/api/admin/issues").status_code == 403
        assert who.patch(f"/api/admin/issues/{issue['id']}", {"status": "resolved"}).status_code == 403
    assert admin.patch("/api/admin/issues/00000000-0000-0000-0000-000000000000", {"status": "resolved"}).status_code == 404
    from fastapi.testclient import TestClient

    from app.main import app
    assert TestClient(app).post("/api/issues", json=REPORT).status_code == 401


def test_reports_are_validated_and_rate_limited(db, world):
    student = Api("s1@example.com")
    for bad in ({**REPORT, "type": "praise"}, {**REPORT, "title": "ab"}, {**REPORT, "description": "short"},
                {**REPORT, "title": "x" * 121}, {**REPORT, "description": "x" * 4001}):
        assert student.post("/api/issues", bad).status_code == 422
    assert student.get("/api/issues").json()["items"] == []
    sneaky = student.post("/api/issues", {**REPORT, "status": "resolved", "admin_note": "fixed"}).json()
    assert sneaky["status"] == "open" and sneaky["admin_note"] == ""        # a client cannot set review fields
    student.get("/api/issues")
    for n in range(9):
        assert student.post("/api/issues", {**REPORT, "title": f"Report number {n}"}).status_code == 201
    blocked = student.post("/api/issues", REPORT)
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "too_many_reports"
    assert Api("faculty@example.com").post("/api/issues", REPORT).status_code == 201     # per person, not global
    for issue in db.scalars(select(IssueReport).where(IssueReport.title.like("Report number%"))):
        issue.created_at = now() - timedelta(hours=2)
    db.commit()
    assert student.post("/api/issues", REPORT).status_code == 201                   # the window moves on


def test_report_text_is_stored_as_plain_text(world):
    student = Api("s1@example.com")
    sent = student.post("/api/issues", {**REPORT, "title": "<script>alert(1)</script> help", "description": "<img src=x onerror=alert(1)> broken"})
    assert sent.status_code == 201 and sent.json()["title"] == "<script>alert(1)</script> help"   # returned as data; React escapes it


def test_the_page_is_kept_only_as_a_local_path(world):
    student = Api("s1@example.com")
    for sent, kept in (("/student/offerings/1/work?token=abc#x", "/student/offerings/1/work"),
                       ("https://evil.example/steal", ""), ("//evil.example/x", ""), ("", ""), ("javascript:1", "")):
        assert student.post("/api/issues", {**REPORT, "page": sent}).json()["page"] == kept


def test_admin_reports_are_paged_and_filterable_without_a_silent_cap(db, world):
    student, admin = Api("s1@example.com"), world["admin"]
    for n in range(7):
        student.post("/api/issues", {**REPORT, "title": f"Report number {n}", "type": "content" if n % 2 else "bug"})
    first = admin.get("/api/admin/issues?page_size=3").json()
    assert first["total"] == 7 and len(first["issues"]) == 3 and first["counts"]["open"] == 7
    last = admin.get("/api/admin/issues?page_size=3&page=3").json()
    assert len(last["issues"]) == 1                                                     # 7 = 3 + 3 + 1, nothing dropped
    assert admin.get("/api/admin/issues?type=content").json()["total"] == 3
    assert admin.get("/api/admin/issues?q=number 5").json()["total"] == 1
    assert admin.get("/api/admin/issues?page_size=101").status_code == 422


def test_a_reporters_own_list_is_paged(db, world):
    student = Api("s1@example.com")
    for n in range(5):
        student.post("/api/issues", {**REPORT, "title": f"Mine {n}"})
    first = student.get("/api/issues?limit=2").json()
    assert len(first["items"]) == 2 and first["has_more"] is True
    last = student.get("/api/issues?limit=2&offset=4").json()
    assert len(last["items"]) == 1 and last["has_more"] is False
