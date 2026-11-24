"""Edit-scores mode: many gradebook cells in one request, all or nothing."""
from helpers import Api, make_account
from test_assessments import make_manual, make_quiz

from app.features.assessments.models import GradePublication


def url(c, path=""):
    return f"/api/teach/offerings/{c['oid']}{path}"


def cell(c, aid, student, score, revision=None, feedback=""):
    return {"assessment_id": aid, "student_id": str(student.id), "score": score, "feedback": feedback,
            "expected_revision": revision}


def book(c):
    return c["fac"].get(url(c, "/gradebook")).json()


def revision_of(c, aid, student):
    row = next(r for r in book(c)["rows"] if r["student_id"] == str(student.id))
    return row["cells"][aid]["revision"], row["cells"][aid]["score"]


def test_create_manual_column_is_included_in_grade_calculation(db, graded):
    c = graded
    student = c["students"][0]
    publication = GradePublication(
        offering_id=c["oid"], student_id=student.id, period="midterm", release_number=1,
        grade="80", remark="passed", policy_version=1, snapshot={"grade": "80"},
        published_by=c["faculty"].id)
    db.add(publication)
    db.commit()
    response = c["fac"].post(url(c, "/gradebook/manual-columns"), {
        "title": "Participation", "max_points": "50",
        "category_key": "exam", "period": "midterm"})
    assert response.status_code == 201, response.text
    column_id = str(response.json()["id"])

    current = book(c)
    column = next(col for col in current["columns"] if col["id"] == column_id)
    assert column == {"id": column_id, "kind": "manual", "title": "Participation",
                      "category_key": "exam", "period": "midterm", "max_points": 50.0,
                      "include_in_grade": True, "section_ids": []}
    saved = c["fac"].put(url(c, "/gradebook/scores"), {"cells": [
        cell(c, column_id, student, "40", 0)]})
    assert saved.status_code == 200, saved.text

    row = next(r for r in book(c)["rows"] if r["student_id"] == str(student.id))
    exam = next(category for category in row["grades"]["midterm"]["categories"]
                if category["key"] == "exam")
    assert exam["status"] == "ok"
    assert float(exam["earned"]) == 40
    assert float(exam["possible"]) == 50
    assert float(exam["raw_percent"]) == 80
    assert row["published"]["midterm"]["grade"] == 80
    assert row["published"]["midterm"]["needs_review"] is True


def test_manual_column_rejects_invalid_policy_scope(graded):
    c = graded
    path = url(c, "/gradebook/manual-columns")
    base = {"title": "Extra grade", "max_points": "10",
            "category_key": "exam", "period": "midterm"}
    attendance = c["fac"].post(path, {**base, "category_key": "attendance"})
    unknown_period = c["fac"].post(path, {**base, "period": "course"})
    unknown_category = c["fac"].post(path, {**base, "category_key": "bonus"})
    invalid_total = c["fac"].post(path, {**base, "max_points": "10.001"})
    assert all(response.status_code == 422 for response in (
        attendance, unknown_period, unknown_category, invalid_total))
    assert c["fac"].get(url(c, "/gradebook")).json()["columns"] == []


def test_manual_column_rejects_invalid_fields_without_creating_columns(graded):
    c = graded
    path = url(c, "/gradebook/manual-columns")
    base = {"title": "Extra grade", "max_points": "10",
            "category_key": "exam", "period": "midterm"}
    invalid = [
        ("empty title", {"title": ""}),
        ("whitespace title", {"title": "   "}),
        ("title too long", {"title": "x" * 201}),
        ("zero total", {"max_points": "0"}),
        ("negative total", {"max_points": "-0.01"}),
        ("total over limit", {"max_points": "100000.01"}),
    ]

    for label, change in invalid:
        response = c["fac"].post(path, {**base, **change})
        assert response.status_code == 422, f"{label}: {response.text}"

    missing_total = c["fac"].post(path, {
        "title": "Extra grade", "category_key": "exam", "period": "midterm"})
    assert missing_total.status_code == 422
    assert c["fac"].get(url(c, "/gradebook")).json()["columns"] == []


def test_manual_column_accepts_total_score_boundaries(graded):
    c = graded
    path = url(c, "/gradebook/manual-columns")
    responses = [
        c["fac"].post(path, {"title": "Minimum", "max_points": "0.01",
                             "category_key": "exam", "period": "midterm"}),
        c["fac"].post(path, {"title": "Maximum", "max_points": "100000",
                             "category_key": "exam", "period": "midterm"}),
    ]
    assert all(response.status_code == 201 for response in responses), [
        response.text for response in responses]
    assert sorted(column["max_points"] for column in
                  c["fac"].get(url(c, "/gradebook")).json()["columns"]) == [0.01, 100000.0]


def test_manual_column_requires_a_published_grading_policy(course):
    c = course
    response = c["fac"].post(url(c, "/gradebook/manual-columns"), {
        "title": "Participation", "max_points": "10",
        "category_key": "exam", "period": "midterm"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "policy_missing"


def test_only_the_offering_teacher_can_create_manual_columns(db, graded):
    c = graded
    path = url(c, "/gradebook/manual-columns")
    body = {"title": "Participation", "max_points": "10",
            "category_key": "exam", "period": "midterm"}
    stranger = Api(make_account(db, "manual-column@example.com", "faculty").email)
    assert stranger.post(path, body).status_code == 404
    assert c["st1"].post(path, body).status_code == 403
    assert c["admin"].post(path, body).status_code == 403


def test_manual_column_cannot_be_added_to_a_closed_term(graded):
    c = graded
    closed = c["admin"].post(f"/api/terms/{c['term']['id']}/close")
    assert closed.status_code in (200, 204), closed.text
    response = c["fac"].post(url(c, "/gradebook/manual-columns"), {
        "title": "Participation", "max_points": "10",
        "category_key": "exam", "period": "midterm"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "term_closed"
    assert c["fac"].get(url(c, "/gradebook")).json()["columns"] == []


def test_manual_column_scores_cannot_exceed_total_and_batch_is_atomic(graded):
    c = graded
    student, other_student = c["students"]
    created = c["fac"].post(url(c, "/gradebook/manual-columns"), {
        "title": "Participation", "max_points": "10",
        "category_key": "exam", "period": "midterm"})
    assert created.status_code == 201, created.text
    column_id = str(created.json()["id"])
    exam = make_manual(c, "exam", "Midterm exam", points="50",
                       period="midterm", category_key="exam")

    over = c["fac"].put(url(c, "/gradebook/scores"), {"cells": [
        cell(c, column_id, student, "10.01", 0),
        cell(c, exam, other_student, "20", 0)]})
    assert over.status_code == 409
    error = over.json()["error"]
    assert error["code"] == "batch_rejected"
    assert list(error["field_errors"]) == [f"{column_id}:{student.id}"]
    assert "above 10" in error["field_errors"][f"{column_id}:{student.id}"]
    assert revision_of(c, column_id, student)[1] is None
    assert revision_of(c, exam, other_student)[1] is None

    negative = c["fac"].put(url(c, "/gradebook/scores"), {"cells": [
        cell(c, column_id, student, "-0.01", 0)]})
    assert negative.status_code == 422
    assert revision_of(c, column_id, student)[1] is None

    at_limit = c["fac"].put(url(c, "/gradebook/scores"), {"cells": [
        cell(c, column_id, student, "10", 0)]})
    assert at_limit.status_code == 200, at_limit.text
    assert float(revision_of(c, column_id, student)[1]) == 10


def test_gradebook_projects_attendance_by_date_and_refreshes_session_changes(graded):
    c = graded
    student_a, student_b = c["students"]
    date = "2026-09-14"
    second_date = "2026-09-15"
    attendance_url = url(c, "/attendance")

    for section, student, status, session_date in (
            (c["sec_a"], student_a, "present", date),
            (c["sec_b"], student_b, "absent", date),
            (c["sec_a"], student_a, "present", second_date)):
        response = c["fac"].put(attendance_url, {
            "section_id": str(section["id"]), "session_date": session_date,
            "period": "midterm", "marks": {str(student.id): status}})
        assert response.status_code == 204, response.text

    current = book(c)
    column = next(column for column in current["columns"]
                  if column["kind"] == "attendance" and column["attendance_date"] == date)
    column_id = column["id"]
    second_column = next(column for column in current["columns"]
                         if column["kind"] == "attendance"
                         and column["attendance_date"] == second_date)
    assert column == {
        "id": f"attendance:{date}:midterm", "kind": "attendance",
        "title": f"Attendance on {date}", "category_key": "attendance",
        "period": "midterm", "max_points": 1.0, "include_in_grade": False,
        "section_ids": sorted([str(c["sec_a"]["id"]), str(c["sec_b"]["id"])]),
        "attendance_date": date,
    }
    assert second_column["section_ids"] == [str(c["sec_a"]["id"])]
    rows = {row["student_id"]: row for row in current["rows"]}
    assert rows[str(student_a.id)]["cells"][column_id] == {
        "attendance_status": "present", "attendance_points": 1.0}
    assert rows[str(student_a.id)]["cells"][second_column["id"]] == {
        "attendance_status": "present", "attendance_points": 1.0}
    assert rows[str(student_b.id)]["cells"][column_id] == {
        "attendance_status": "absent", "attendance_points": 0.0}

    changed = c["fac"].put(attendance_url, {
        "section_id": str(c["sec_a"]["id"]), "session_date": date,
        "period": "midterm", "marks": {str(student_a.id): "late"}})
    assert changed.status_code == 204, changed.text
    assert next(row for row in book(c)["rows"] if row["student_id"] == str(student_a.id)
                )["cells"][column_id] == {
                    "attendance_status": "late", "attendance_points": 0.5}

    excused = c["fac"].put(attendance_url, {
        "section_id": str(c["sec_b"]["id"]), "session_date": date,
        "period": "midterm", "marks": {str(student_b.id): "excused"}})
    assert excused.status_code == 204, excused.text
    assert next(row for row in book(c)["rows"] if row["student_id"] == str(student_b.id)
                )["cells"][column_id] == {
                    "attendance_status": "excused", "attendance_points": None}

    cleared = c["fac"].put(attendance_url, {
        "section_id": str(c["sec_a"]["id"]), "session_date": date,
        "period": "midterm", "marks": {str(student_a.id): None}})
    assert cleared.status_code == 204, cleared.text
    assert next(row for row in book(c)["rows"] if row["student_id"] == str(student_a.id)
                )["cells"][column_id] == {
                    "attendance_status": None, "attendance_points": None}

    for section_id, session_date in (
            (c["sec_a"]["id"], date), (c["sec_a"]["id"], second_date),
            (c["sec_b"]["id"], date)):
        sessions = c["fac"].get(f"{attendance_url}?section_id={section_id}").json()["sessions"]
        session_id = next(session["id"] for session in sessions
                          if session["date"] == session_date)
        deleted = c["fac"].delete(url(c, f"/attendance/{session_id}"))
        assert deleted.status_code == 204, deleted.text
        if section_id == c["sec_a"]["id"] and session_date == date:
            remaining = book(c)
            assert next(column for column in remaining["columns"]
                        if column["kind"] == "attendance")["section_ids"] == [str(c["sec_b"]["id"])]
            assert column_id not in next(row for row in remaining["rows"]
                                        if row["student_id"] == str(student_a.id))["cells"]

    assert not any(column["kind"] == "attendance" for column in book(c)["columns"])


def two_exams(c):
    return (make_manual(c, "exam", "Midterm exam", points="50", period="midterm", category_key="exam"),
            make_manual(c, "exam", "Quiz paper", points="20", period="midterm", category_key="quiz"))


def test_a_batch_saves_every_cell_in_one_request(graded):
    c = graded
    exam, paper = two_exams(c)
    s1, s2 = c["students"]
    done = c["fac"].put(url(c, "/gradebook/scores"), {"cells": [
        cell(c, exam, s1, "44", 0), cell(c, exam, s2, "38.5", 0), cell(c, paper, s1, "18", 0), cell(c, paper, s2, None, 0)]})
    assert done.status_code == 200 and done.json() == {"saved": 4}
    assert float(revision_of(c, exam, s1)[1]) == 44.0
    assert float(revision_of(c, exam, s2)[1]) == 38.5
    assert revision_of(c, paper, s2)[1] is None                                  # a blank stays pending, not zero


def test_one_stale_revision_rejects_the_whole_batch_and_names_the_cell(graded):
    c = graded
    exam, paper = two_exams(c)
    s1, s2 = c["students"]
    first = c["fac"].put(url(c, f"/assessments/{exam}/scores/{s1.id}"), {"score": "40", "feedback": "", "expected_revision": 0})
    assert first.status_code == 200                                              # someone else saved this cell first
    stale = c["fac"].put(url(c, "/gradebook/scores"), {"cells": [
        cell(c, exam, s1, "45", 0),                                              # stale: the cell is now at revision 1
        cell(c, paper, s2, "15", 0)]})                                           # fine on its own
    assert stale.status_code == 409
    body = stale.json()["error"]
    assert body["code"] == "batch_rejected" and "nothing was saved" in body["message"]
    assert list(body["field_errors"]) == [f"{exam}:{s1.id}"] and "changed by someone else" in body["field_errors"][f"{exam}:{s1.id}"]
    assert float(revision_of(c, exam, s1)[1]) == 40.0                           # unchanged
    assert revision_of(c, paper, s2)[1] is None                                 # the valid cell was NOT saved either


def test_invalid_cells_are_named_and_save_nothing(graded):
    c = graded
    exam, paper = two_exams(c)
    s1, s2 = c["students"]
    over = c["fac"].put(url(c, "/gradebook/scores"), {"cells": [cell(c, exam, s1, "51", 0), cell(c, paper, s2, "10", 0)]})
    assert over.status_code == 409 and list(over.json()["error"]["field_errors"]) == [f"{exam}:{s1.id}"]
    assert "above" in over.json()["error"]["field_errors"][f"{exam}:{s1.id}"]
    twice = c["fac"].put(url(c, "/gradebook/scores"), {"cells": [cell(c, exam, s1, "10", 0), cell(c, exam, s1, "11", 0)]})
    assert twice.status_code == 409 and "twice" in next(iter(twice.json()["error"]["field_errors"].values()))
    assert revision_of(c, exam, s1)[1] is None and revision_of(c, paper, s2)[1] is None
    unknown = c["fac"].put(url(c, "/gradebook/scores"), {"cells": [cell(c, "00000000-0000-0000-0000-000000000000", s1, "1", 0)]})
    assert unknown.status_code == 409 and "not found" in next(iter(unknown.json()["error"]["field_errors"].values())).lower()


def test_online_quizzes_cannot_be_scored_manually(graded):
    c = graded
    quiz = make_quiz(c, title="Quiz 1", category_key="quiz", period="midterm")
    s1 = c["students"][0]
    refused = c["fac"].put(url(c, "/gradebook/scores"), {
        "cells": [cell(c, quiz["aid"], s1, "1", None)]})
    assert refused.status_code == 409
    assert "auto-scored" in next(iter(refused.json()["error"]["field_errors"].values()))
    single = c["fac"].put(url(c, f"/assessments/{quiz['aid']}/scores/{s1.id}"), {
        "score": "1", "feedback": "", "expected_revision": None})
    assert single.status_code == 409 and single.json()["error"]["code"] == "auto_scored"


def test_only_the_teacher_can_batch_edit_and_limits_apply(db, graded):
    c = graded
    exam, _ = two_exams(c)
    s1 = c["students"][0]
    body = {"cells": [cell(c, exam, s1, "10", 0)]}
    other = make_account(db, "batcher@example.com", "faculty")
    assert Api(other.email).put(url(c, "/gradebook/scores"), body).status_code == 404
    assert c["st1"].put(url(c, "/gradebook/scores"), body).status_code == 403
    assert c["admin"].put(url(c, "/gradebook/scores"), body).status_code == 403
    assert c["fac"].put(url(c, "/gradebook/scores"), {"cells": []}).status_code == 422
    assert c["fac"].put(url(c, "/gradebook/scores"), {"cells": [cell(c, exam, s1, "1", 0)] * 501}).status_code == 422
    assert c["admin"].post(f"/api/terms/{c['term']['id']}/close").status_code in (200, 204)
    closed = c["fac"].put(url(c, "/gradebook/scores"), body)
    assert closed.status_code == 409 and closed.json()["error"]["code"] == "term_closed"
