from fastapi.testclient import TestClient
from helpers import Api, make_account

from app.main import app


def roster(api, offering_id):
    response = api.get(f"/api/offerings/{offering_id}/students")
    assert response.status_code == 200, response.text
    return {r["student_id"]: r for r in response.json()}


def add_member(w, section, student):
    return w["admin"].post(f"/api/sections/{section['id']}/members",
                           {"student_id": str(student.id)})


def test_only_admin_can_administer(db, actors):
    assert TestClient(app).get("/api/school-years").status_code == 401
    for email in ("faculty@example.com", "student@example.com"):
        api = Api(email)
        assert api.get("/api/school-years").status_code == 403
        assert api.post("/api/subjects", {"code": "X", "title": "X", "units": "1"}).status_code == 403


def test_subject_code_normalised_and_unique(world):
    assert world["subject"]["code"] == "ENT 101"
    again = world["admin"].post("/api/subjects", {"code": "Ent 101", "title": "Dup", "units": "3"})
    assert again.status_code == 409


def test_assigned_faculty_and_enrolled_students_see_offering(db, world):
    s1, s2 = world["students"]
    assert add_member(world, world["sections"][0], s1).status_code == 204
    assert add_member(world, world["sections"][1], s2).status_code == 204
    oid = world["offering"]["id"]

    faculty = Api("faculty@example.com")
    mine = faculty.get("/api/me/offerings").json()
    assert [o["id"] for o in mine] == [oid] and mine[0]["enrolled"] == 1
    assert list(roster(faculty, oid)) == [str(s1.id)]

    student1 = Api("s1@example.com")
    assert [s["offering_id"] for s in student1.get("/api/me/subjects").json()] == [oid]
    student2 = Api("s2@example.com")   # in 1B, which the offering is not linked to
    assert student2.get("/api/me/subjects").json() == []
    # Students cannot read rosters; other faculty cannot read this offering's roster.
    assert student1.get(f"/api/offerings/{oid}/students").status_code == 403
    other = make_account(db, "other@example.com", "faculty")
    other_api = Api(other.email)
    assert other_api.get(f"/api/offerings/{oid}/students").status_code == 404
    assert other_api.get("/api/me/offerings").json() == []
    # Faculty and students cannot use the enrolment management endpoints.
    assert faculty.put(f"/api/offerings/{oid}/exceptions/{s2.id}",
                       {"action": "exclude", "reason": "nope"}).status_code == 403


def test_placement_mismatch_is_rejected(world):
    admin = world["admin"]
    wrong = admin.post(f"/api/terms/{world['term']['id']}/sections",
                       {"name": "2A", "year_level": 2}).json()
    response = admin.patch(f"/api/offerings/{world['offering']['id']}",
                           {"section_ids": [wrong["id"]]})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "placement_mismatch"


def test_one_active_section_per_term_and_withdrawal_history(world):
    s1 = world["students"][0]
    a, b = world["sections"]
    admin, oid = world["admin"], world["offering"]["id"]
    assert add_member(world, a, s1).status_code == 204
    second = add_member(world, b, s1)
    assert second.status_code == 409 and second.json()["error"]["code"] == "already_in_section"
    assert admin.delete(f"/api/sections/{a['id']}/members/{s1.id}").status_code == 204
    # A withdrawn student stays visible as history rather than being deleted.
    assert roster(admin, oid)[str(s1.id)]["status"] == "withdrawn"
    assert Api("faculty@example.com").get("/api/me/offerings").json()[0]["enrolled"] == 0
    assert add_member(world, a, s1).status_code == 204   # re-admit
    assert roster(admin, oid)[str(s1.id)]["status"] == "enrolled"


def test_irregular_enrollment_exceptions(world):
    s1, s2 = world["students"]
    admin, oid = world["admin"], world["offering"]["id"]
    sec_a, sec_b = world["sections"]
    add_member(world, sec_a, s1)
    add_member(world, sec_b, s2)          # regular in 1B, which has no offering
    put = admin.put(f"/api/offerings/{oid}/exceptions/{s2.id}", {
        "action": "include", "section_id": sec_a["id"], "reason": "Irregular, retaking"})
    assert put.status_code == 204
    r = roster(admin, oid)
    assert r[str(s2.id)]["source"] == "exception" and r[str(s2.id)]["status"] == "enrolled"
    # The teaching section must be one the offering is linked to.
    bad = admin.put(f"/api/offerings/{oid}/exceptions/{s2.id}", {
        "action": "include", "section_id": sec_b["id"], "reason": "Wrong section"})
    assert bad.status_code == 422
    admin.put(f"/api/offerings/{oid}/exceptions/{s1.id}",
              {"action": "exclude", "reason": "Credited elsewhere"})
    assert roster(admin, oid)[str(s1.id)]["status"] == "withdrawn"
    assert admin.delete(f"/api/offerings/{oid}/exceptions/{s1.id}").status_code == 204
    assert roster(admin, oid)[str(s1.id)]["status"] == "enrolled"
    assert admin.delete(f"/api/offerings/{oid}/exceptions/{s1.id}").status_code == 404


def test_excluded_student_without_prior_enrollment_is_visible_to_admin(world):
    s2 = world["students"][1]
    admin, oid = world["admin"], world["offering"]["id"]
    admin.put(f"/api/offerings/{oid}/exceptions/{s2.id}",
              {"action": "exclude", "reason": "Pre-emptive"})
    assert roster(admin, oid)[str(s2.id)]["status"] == "excluded"
    # ...but faculty never sees excluded students.
    assert str(s2.id) not in roster(Api("faculty@example.com"), oid)


def test_closed_term_blocks_writes_and_reopen_needs_reason(world):
    admin, term = world["admin"], world["term"]
    s1 = world["students"][0]
    assert admin.post(f"/api/terms/{term['id']}/close").status_code == 200
    blocked = add_member(world, world["sections"][0], s1)
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "term_closed"
    assert admin.post(f"/api/terms/{term['id']}/sections",
                      {"name": "3A", "year_level": 3}).status_code == 409
    assert admin.post(f"/api/terms/{term['id']}/reopen", {"reason": ""}).status_code == 422
    assert admin.post(f"/api/terms/{term['id']}/reopen",
                      {"reason": "Late grade correction"}).status_code == 200
    assert add_member(world, world["sections"][0], s1).status_code == 204
    actions = [e["action"] for e in admin.get("/api/audit").json()]
    assert "term.closed" in actions and "term.reopened" in actions


def test_new_year_copies_structure_and_keeps_history(world):
    s1 = world["students"][0]
    admin, oid = world["admin"], world["offering"]["id"]
    add_member(world, world["sections"][0], s1)
    admin.post(f"/api/terms/{world['term']['id']}/close")
    year = admin.post("/api/school-years", {
        "label": "2027-2028", "start_date": "2027-06-01", "end_date": "2028-04-30",
        "terms": [{"name": "First Semester", "sequence": 1, "start_date": "2027-06-01",
                   "end_date": "2027-10-31", "copy_from_term_id": world["term"]["id"],
                   "copy_offerings": True}]})
    assert year.status_code == 201, year.text
    new_term = year.json()["terms"][0]
    offerings = admin.get(f"/api/terms/{new_term['id']}/offerings").json()
    assert len(offerings) == 1 and offerings[0]["enrolled"] == 0 and offerings[0]["id"] != oid
    assert [s["name"] for s in admin.get(f"/api/terms/{new_term['id']}/sections").json()] \
        == ["1A", "1B"]
    # The closed term's roster and the student's history are untouched.
    assert roster(admin, oid)[str(s1.id)]["status"] == "enrolled"
    subjects = Api("s1@example.com").get("/api/me/subjects").json()
    assert [s["offering_id"] for s in subjects] == [oid] and subjects[0]["term_status"] == "closed"


def test_duplicate_offering_and_invalid_assignees(world):
    admin, term = world["admin"], world["term"]
    body = {"subject_id": world["subject"]["id"], "faculty_id": str(world["faculty"].id),
            "section_ids": []}
    assert admin.post(f"/api/terms/{term['id']}/offerings", body).status_code == 409
    student_as_teacher = {**body, "faculty_id": str(world["students"][0].id)}
    assert admin.post(f"/api/terms/{term['id']}/offerings", student_as_teacher).status_code == 422
    assert add_member(world, world["sections"][0], world["faculty"]).status_code == 422


def test_copy_without_offerings_brings_sections_only(world):
    admin = world["admin"]
    year = admin.post("/api/school-years", {
        "label": "2027-2028", "start_date": "2027-06-01", "end_date": "2028-04-30",
        "terms": [{"name": "First Semester", "sequence": 1, "start_date": "2027-06-01",
                   "end_date": "2027-10-31", "copy_from_term_id": world["term"]["id"]}]}).json()
    new_term = year["terms"][0]["id"]
    assert admin.get(f"/api/terms/{new_term}/offerings").json() == []
    assert len(admin.get(f"/api/terms/{new_term}/sections").json()) == 2


def test_placement_override_needs_reason_and_is_audited(world):
    admin, term = world["admin"], world["term"]
    wrong = admin.post(f"/api/terms/{term['id']}/sections", {"name": "2A", "year_level": 2}).json()
    url = f"/api/offerings/{world['offering']['id']}"
    assert admin.patch(url, {"section_ids": [wrong["id"]]}).status_code == 422
    assert admin.patch(url, {"section_ids": [wrong["id"]],
                             "placement_override_reason": "ab"}).status_code == 422   # too short
    ok = admin.patch(url, {"section_ids": [wrong["id"]],
                           "placement_override_reason": "Off-semester offering approved"})
    assert ok.status_code == 200 and [s["name"] for s in ok.json()["sections"]] == ["2A"]
    audit = [e for e in admin.get("/api/audit").json() if e["action"] == "offering.updated"]
    assert audit[0]["details"]["placement_override"]["reason"] == "Off-semester offering approved"


def test_faculty_roster_defaults_to_active_students(world):
    s1 = world["students"][0]
    admin, oid = world["admin"], world["offering"]["id"]
    add_member(world, world["sections"][0], s1)
    admin.delete(f"/api/sections/{world['sections'][0]['id']}/members/{s1.id}")
    faculty = Api("faculty@example.com")
    assert faculty.get(f"/api/offerings/{oid}/students").json() == []
    history = faculty.get(f"/api/offerings/{oid}/students?history=true").json()
    assert [r["status"] for r in history] == ["withdrawn"]
