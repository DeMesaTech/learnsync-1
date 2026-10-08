"""The attendance grid saves one change at a time, so the server must treat a save as PARTIAL: only the students named
change, everyone else on that date is left exactly as they were."""
from helpers import Api, make_account


def url(c, path=""):
    return f"/api/teach/offerings/{c['oid']}/attendance{path}"


def second_student(db, c):
    s3 = make_account(db, "s3@example.com", "student", "S-3")
    assert c["admin"].post(f"/api/sections/{c['sec_a']['id']}/members", {"student_id": str(s3.id)}).status_code in (200, 201, 204)
    return s3


def marks_on(c, date):
    data = c["fac"].get(url(c) + f"?section_id={c['sec_a']['id']}").json()
    day = next((s for s in data["sessions"] if s["date"] == date), None)
    return day["marks"] if day else None


def save(c, date, marks, period="midterm", who="fac"):
    return c[who].put(url(c), {"section_id": c["sec_a"]["id"], "session_date": date, "period": period, "marks": marks})


def test_a_save_only_changes_the_students_it_names(db, graded):
    c = graded
    s1, s3 = c["students"][0], second_student(db, c)
    assert save(c, "2026-07-06", {str(s1.id): "present", str(s3.id): "late"}).status_code == 204
    assert marks_on(c, "2026-07-06") == {str(s1.id): "present", str(s3.id): "late"}
    assert save(c, "2026-07-06", {str(s1.id): "absent"}).status_code == 204                 # one cell edited in the grid
    assert marks_on(c, "2026-07-06") == {str(s1.id): "absent", str(s3.id): "late"}           # the other student is untouched
    assert save(c, "2026-07-06", {str(s1.id): None}).status_code == 204                       # a cleared cell
    assert marks_on(c, "2026-07-06") == {str(s3.id): "late"}
    assert save(c, "2026-07-06", {str(s1.id): "present"}).status_code == 204 and len(marks_on(c, "2026-07-06")) == 2


def test_each_date_is_its_own_session_and_a_dates_period_cannot_change_once_recorded(db, graded):
    c = graded
    s1 = c["students"][0]
    assert save(c, "2026-07-06", {str(s1.id): "present"}, period="midterm").status_code == 204
    assert save(c, "2026-07-08", {str(s1.id): "late"}, period="finals").status_code == 204
    assert marks_on(c, "2026-07-06") == {str(s1.id): "present"} and marks_on(c, "2026-07-08") == {str(s1.id): "late"}
    clash = save(c, "2026-07-06", {str(s1.id): "absent"}, period="finals")
    assert clash.status_code == 409 and clash.json()["error"]["code"] == "period_locked"
    assert marks_on(c, "2026-07-06") == {str(s1.id): "present"}                                 # the clash changed nothing


def test_only_students_of_the_section_can_be_marked_and_only_by_their_teacher(db, graded):
    c = graded
    s1, outsider = c["students"][0], c["students"][1]                                           # s2 is in section 1B, not 1A
    stray = save(c, "2026-07-06", {str(outsider.id): "present"})
    assert stray.status_code == 422 and stray.json()["error"]["code"] == "student_invalid"
    other = make_account(db, "attendance-other@example.com", "faculty")
    assert Api(other.email).put(url(c), {"section_id": c["sec_a"]["id"], "session_date": "2026-07-06", "period": "midterm", "marks": {str(s1.id): "present"}}).status_code == 404
    assert save(c, "2026-07-06", {str(s1.id): "present"}, who="st1").status_code == 403
    assert save(c, "2026-07-06", {str(s1.id): "present"}, who="admin").status_code == 403
    assert marks_on(c, "2026-07-06") is None
    assert c["admin"].post(f"/api/terms/{c['term']['id']}/close").status_code in (200, 204)
    closed = save(c, "2026-07-06", {str(s1.id): "present"})
    assert closed.status_code == 409 and closed.json()["error"]["code"] == "term_closed"
