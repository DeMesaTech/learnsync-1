"""Edit-scores mode: many gradebook cells in one request, all or nothing."""
from helpers import Api, make_account
from test_assessments import make_manual, make_quiz, start, submit


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


def test_an_online_quiz_with_a_submitted_attempt_cannot_be_overwritten_by_hand(graded):
    c = graded
    quiz = make_quiz(c, title="Quiz 1", category_key="quiz", period="midterm")
    attempt = start(c["st1"], c, quiz["aid"]).json()
    assert submit(c["st1"], c, attempt["id"], quiz["correct"]).status_code == 200
    s1 = c["students"][0]
    refused = c["fac"].put(url(c, "/gradebook/scores"), {"cells": [cell(c, quiz["aid"], s1, "1", None)]})
    assert refused.status_code == 409 and "correct an answer" in next(iter(refused.json()["error"]["field_errors"].values()))


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
