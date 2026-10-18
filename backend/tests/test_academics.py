import uuid
from datetime import date

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from helpers import Api, make_account
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.features.academics import commands
from app.features.academics.models import AcademicTerm, SchoolYear
from app.features.accounts.commands import issue_token
from app.features.accounts.models import AccountToken, AuditEvent
from app.main import app


def roster(api, offering_id):
    response = api.get(f"/api/offerings/{offering_id}/students")
    assert response.status_code == 200, response.text
    return {r["student_id"]: r for r in response.json()}


def add_member(w, section, student):
    return w["admin"].post(f"/api/sections/{section['id']}/members",
                           {"student_id": str(student.id)})


def school_year_body(label="2032-2033", start="2032-08-01", end="2033-05-31"):
    return {
        "label": label,
        "start_date": start,
        "end_date": end,
        "terms": [
            {"name": "1st semester", "sequence": 1, "start_date": "2032-08-01",
             "end_date": "2032-12-15"},
            {"name": "2nd semester", "sequence": 2, "start_date": "2032-12-16",
             "end_date": "2033-05-31"},
        ],
    }


def close_school_year(admin, first, second):
    assert admin.post(f"/api/terms/{first['id']}/close").status_code == 200
    assert admin.post(f"/api/terms/{second['id']}/schedule").status_code == 200
    assert admin.post(f"/api/terms/{second['id']}/activate").status_code == 200
    assert admin.post(f"/api/terms/{second['id']}/close").status_code == 200


def test_school_year_creation_creates_two_draft_semesters(actors):
    admin = Api("admin@example.com")

    response = admin.post("/api/school-years", school_year_body())

    assert response.status_code == 201, response.text
    year = response.json()
    assert year["label"] == "2032-2033"
    assert [term["sequence"] for term in year["terms"]] == [1, 2]
    assert [term["status"] for term in year["terms"]] == ["draft", "draft"]


def test_school_year_creation_rejects_duplicate_label(actors):
    admin = Api("admin@example.com")
    assert admin.post("/api/school-years", school_year_body()).status_code == 201

    duplicate = admin.post("/api/school-years", school_year_body())

    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "school_year_exists"


def test_school_year_creation_rejects_overlapping_year_dates(actors):
    admin = Api("admin@example.com")
    assert admin.post("/api/school-years", school_year_body()).status_code == 201
    overlapping = school_year_body("2033-2034", "2033-05-01", "2034-04-30")
    overlapping["terms"] = [
        {"name": "1st semester", "sequence": 1, "start_date": "2033-05-01",
         "end_date": "2033-09-30"},
        {"name": "2nd semester", "sequence": 2, "start_date": "2033-10-01",
         "end_date": "2034-04-30"},
    ]

    response = admin.post("/api/school-years", overlapping)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "school_year_dates_overlap"


def test_school_year_creation_rejects_invalid_term_dates_and_label(actors):
    admin = Api("admin@example.com")
    outside_year = school_year_body()
    outside_year["terms"][0]["start_date"] = "2032-07-31"
    response = admin.post("/api/school-years", outside_year)
    assert response.status_code == 422

    overlapping_terms = school_year_body()
    overlapping_terms["terms"][1]["start_date"] = "2032-12-15"
    response = admin.post("/api/school-years", overlapping_terms)
    assert response.status_code == 422

    zero_length_term = school_year_body()
    zero_length_term["terms"][0]["end_date"] = zero_length_term["terms"][0]["start_date"]
    response = admin.post("/api/school-years", zero_length_term)
    assert response.status_code == 422

    wrong_label = school_year_body("2031-2032")
    response = admin.post("/api/school-years", wrong_label)
    assert response.status_code == 422
    assert "label must match" in response.json()["error"]["field_errors"][""].lower()

    invalid_date = school_year_body()
    invalid_date["start_date"] = "August 1, 2032"
    response = admin.post("/api/school-years", invalid_date)
    assert response.status_code == 422


def test_school_year_creation_rolls_back_after_late_failure(db, actors, monkeypatch):
    admin = Api("admin@example.com")
    body = school_year_body("2032-2033")

    def fail_audit(*_args, **_kwargs):
        raise HTTPException(status_code=404, detail={"code": "test_failure", "message": "Injected failure."})

    monkeypatch.setattr(commands, "audit", fail_audit)

    response = admin.post("/api/school-years", body)

    assert response.status_code == 404
    db.expire_all()
    assert db.scalar(select(SchoolYear.id).where(SchoolYear.label == "2032-2033")) is None
    assert db.scalar(select(AcademicTerm.id).join(SchoolYear).where(
        SchoolYear.label == "2032-2033")) is None


def test_only_admin_can_administer(db, actors):
    unauthenticated = TestClient(app).get("/api/school-years")
    assert unauthenticated.status_code == 401

    admin = Api("admin@example.com")
    assert admin.get("/api/school-years").status_code == 200

    for email in ("faculty@example.com", "student@example.com"):
        api = Api(email)
        response = api.get("/api/school-years")
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "role_forbidden"
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
    section_roster = world["admin"].get(
        f"/api/sections/{world['sections'][0]['id']}/roster?offering_id={oid}")
    assert section_roster.status_code == 200, section_roster.text
    assert [row["student_id"] for row in section_roster.json()["items"]] == [str(s1.id)]
    not_assigned = world["admin"].get(
        f"/api/sections/{world['sections'][1]['id']}/roster?offering_id={oid}")
    assert not_assigned.status_code == 404

    faculty = Api("faculty@example.com")
    mine = faculty.get("/api/me/offerings").json()
    assert [o["id"] for o in mine] == [oid] and mine[0]["enrolled"] == 1
    faculty_roster = roster(faculty, oid)
    assert list(faculty_roster) == [str(s1.id)]
    assert faculty_roster[str(s1.id)]["section_id"] == world["sections"][0]["id"]

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


def test_section_roster_college_filter_scopes_by_section_college(world):
    admin = world["admin"]
    college_a = admin.post("/api/colleges", {"code": "COLA", "name": "College A"}).json()
    college_b = admin.post("/api/colleges", {"code": "COLB", "name": "College B"}).json()
    term_id = world["term"]["id"]
    section_a = admin.post(f"/api/terms/{term_id}/sections/bulk", {
        "college_id": college_a["id"], "year_level": 1, "count": 1}).json()["sections"][0]
    section_b = admin.post(f"/api/terms/{term_id}/sections/bulk", {
        "college_id": college_b["id"], "year_level": 1, "count": 1}).json()["sections"][0]
    student_a, student_b = world["students"]
    assert add_member(world, section_a, student_a).status_code == 204
    assert add_member(world, section_b, student_b).status_code == 204

    roster_a = admin.get(
        f"/api/sections/{section_a['id']}/roster?college_id={college_a['id']}")
    assert roster_a.status_code == 200, roster_a.text
    assert [row["student_id"] for row in roster_a.json()["items"]] == [str(student_a.id)]
    wrong_college = admin.get(
        f"/api/sections/{section_b['id']}/roster?college_id={college_a['id']}")
    assert wrong_college.status_code == 404
    roster_b = admin.get(
        f"/api/sections/{section_b['id']}/roster?college_id={college_b['id']}")
    assert roster_b.status_code == 200, roster_b.text
    assert [row["student_id"] for row in roster_b.json()["items"]] == [str(student_b.id)]

    conflict = admin.get(
        f"/api/sections/{section_a['id']}/roster?college_id={college_a['id']}"
        f"&offering_id={world['offering']['id']}")
    assert conflict.status_code == 422


def test_invite_all_sends_links_to_invited_students_in_selected_section(db, world, monkeypatch):
    admin = world["admin"]
    section_a, section_b = world["sections"]
    first = make_account(db, "invite-a@example.com", "student", "INV-A")
    second = make_account(db, "invite-b@example.com", "student", "INV-B")
    elsewhere = make_account(db, "invite-other@example.com", "student", "INV-OTHER")
    for student in (first, second, elsewhere):
        student.status = "invited"
        student.email_verified_at = None
    db.commit()
    assert add_member(world, section_a, first).status_code == 204
    assert add_member(world, section_a, second).status_code == 204
    assert add_member(world, section_b, elsewhere).status_code == 204
    sent = []
    monkeypatch.setattr(
        "app.features.accounts.commands.send_link",
        lambda account, token, purpose: sent.append((account.email, purpose)))

    roster_response = admin.get(f"/api/sections/{section_a['id']}/roster?page_size=1")
    assert roster_response.status_code == 200, roster_response.text
    assert roster_response.json()["invitation_count"] == 2
    response = admin.post(f"/api/sections/{section_a['id']}/send-invitations", {})

    assert response.status_code == 200, response.text
    assert response.json()["sent"] == 2
    assert response.json()["failed"] == 0
    assert {email for email, purpose in sent} == {first.email, second.email}
    assert {purpose for _, purpose in sent} == {"invite"}


def test_college_sections_use_college_codes_without_creating_offerings(world):
    admin = world["admin"]
    college_a = admin.post("/api/colleges", {"code": "BSE", "name": "Business"}).json()
    college_b = admin.post("/api/colleges", {"code": "BSIS", "name": "Information Systems"}).json()
    term_id = world["term"]["id"]
    before = admin.get(f"/api/terms/{term_id}/offerings").json()

    sections_a = admin.post(f"/api/terms/{term_id}/sections/bulk", {
        "college_id": college_a["id"], "year_level": 1, "count": 2})
    sections_b = admin.post(f"/api/terms/{term_id}/sections/bulk", {
        "college_id": college_b["id"], "year_level": 1, "count": 2})

    assert sections_a.status_code == 201, sections_a.text
    assert sections_b.status_code == 201, sections_b.text
    assert [section["name"] for section in sections_a.json()["sections"]] == ["BSE 1A", "BSE 1B"]
    assert [section["name"] for section in sections_b.json()["sections"]] == ["BSIS 1A", "BSIS 1B"]
    assert all(section["college_id"] == college_a["id"]
               for section in sections_a.json()["sections"])
    assert all(section["college_id"] == college_b["id"]
               for section in sections_b.json()["sections"])
    assert admin.get(f"/api/terms/{term_id}/offerings").json() == before


def test_college_cannot_be_deleted_while_assigned_to_section(world):
    admin, term_id = world["admin"], world["term"]["id"]
    college = admin.post("/api/colleges", {"code": "BSE", "name": "Business"}).json()
    section = admin.post(f"/api/terms/{term_id}/sections/bulk", {
        "college_id": college["id"], "year_level": 1, "count": 1}).json()["sections"][0]

    blocked = admin.delete(f"/api/colleges/{college['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "college_in_use"

    assert admin.delete(f"/api/sections/{section['id']}").status_code == 204
    assert admin.delete(f"/api/colleges/{college['id']}").status_code == 204


def test_section_student_profile_update_is_inline_scoped_and_reverifies_changed_email(
        db, world, monkeypatch):
    admin, section = world["admin"], world["sections"][0]
    student = world["students"][0]
    assert add_member(world, section, student).status_code == 204
    reset_token = issue_token(db, student, "reset")
    db.commit()
    sent = []
    monkeypatch.setattr(
        "app.features.academics.commands.send_link",
        lambda account, token, purpose: sent.append((account.email, token, purpose)))

    response = admin.patch(
        f"/api/sections/{section['id']}/students/{student.id}",
        {"display_name": "Updated Student", "email": "updated@example.com",
         "student_number": "S-UPDATED"})
    assert response.status_code == 200, response.text
    assert response.json() == {
        "student_id": str(student.id), "display_name": "Updated Student",
        "email": "updated@example.com", "student_number": "S-UPDATED",
        "account_status": "invited",
    }
    assert len(sent) == 1
    assert sent[0][0::2] == ("updated@example.com", "invite")
    db.expire_all()
    tokens = db.scalars(select(AccountToken).where(
        AccountToken.account_id == student.id)).all()
    assert any(token.purpose == "reset" and token.consumed_at for token in tokens)
    assert any(token.purpose == "invite" and token.consumed_at is None for token in tokens)
    stale_link = admin.post("/api/auth/reset-password", {
        "token": reset_token, "password": "a-new-test-password"})
    assert stale_link.status_code == 422
    roster = admin.get(f"/api/sections/{section['id']}/roster")
    assert roster.status_code == 200
    assert roster.json()["items"][0]["account_status"] == "invited"

    outside_section = admin.patch(
        f"/api/sections/{section['id']}/students/{world['students'][1].id}",
        {"display_name": "Not a member", "email": "outside@example.com",
         "student_number": "OUTSIDE"})
    assert outside_section.status_code == 404
    duplicate_id = admin.patch(
        f"/api/sections/{section['id']}/students/{student.id}",
        {"display_name": "Updated Student", "email": "updated@example.com",
         "student_number": world["students"][1].student_number})
    assert duplicate_id.status_code == 409


def test_failed_student_email_update_does_not_partially_save(db, world, monkeypatch):
    admin, section = world["admin"], world["sections"][0]
    student = world["students"][0]
    assert add_member(world, section, student).status_code == 204

    def reject_email(*_args):
        raise HTTPException(503, detail={"code": "email_unavailable",
                                         "message": "Email could not be sent."})

    monkeypatch.setattr("app.features.academics.commands.send_link", reject_email)
    response = admin.patch(
        f"/api/sections/{section['id']}/students/{student.id}",
        {"display_name": "Updated Student", "email": "updated@example.com",
         "student_number": "S-UPDATED"})
    assert response.status_code == 503
    db_account = world["students"][0]
    db.refresh(db_account)
    assert db_account.display_name == "s1"
    assert db_account.email == "s1@example.com"


def test_term_offering_summary_counts_enrollments_per_section(world):
    admin, oid = world["admin"], world["offering"]["id"]
    sec_a, sec_b = world["sections"]
    assert admin.patch(f"/api/offerings/{oid}",
                       {"section_ids": [sec_a["id"], sec_b["id"]]}).status_code == 200
    s1, s2 = world["students"]
    assert add_member(world, sec_a, s1).status_code == 204
    assert add_member(world, sec_b, s2).status_code == 204

    response = admin.get(f"/api/terms/{world['term']['id']}/offerings")
    assert response.status_code == 200, response.text
    offering = response.json()[0]
    assert {section["name"]: section["enrolled"] for section in offering["sections"]} \
        == {"1A": 1, "1B": 1}
    assert offering["enrolled"] == 2


def test_placement_mismatch_is_rejected(world):
    admin = world["admin"]
    wrong = admin.post(f"/api/terms/{world['term']['id']}/sections",
                       {"name": "2A", "year_level": 2}).json()
    response = admin.patch(f"/api/offerings/{world['offering']['id']}",
                           {"section_ids": [wrong["id"]]})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "placement_mismatch"


def test_bulk_section_create_generates_alphabetical_names_per_year(world):
    admin, term_id = world["admin"], world["term"]["id"]

    created = admin.post(f"/api/terms/{term_id}/sections/bulk",
                         {"year_level": 1, "count": 3})

    assert created.status_code == 201, created.text
    assert [section["name"] for section in created.json()["sections"]] == [
        "BSE 1C", "BSE 1D", "BSE 1E"]
    next_batch = admin.post(f"/api/terms/{term_id}/sections/bulk",
                            {"year_level": 1, "count": 2})
    assert [section["name"] for section in next_batch.json()["sections"]] == ["BSE 1F", "BSE 1G"]
    other_year = admin.post(f"/api/terms/{term_id}/sections/bulk",
                            {"year_level": 2, "count": 2})
    assert [section["name"] for section in other_year.json()["sections"]] == [
        "BSE 2A", "BSE 2B"]
    assert admin.post(f"/api/terms/{term_id}/sections/bulk",
                      {"year_level": 1, "count": 27}).status_code == 422


def test_only_unused_sections_can_be_deleted(world):
    admin, term_id = world["admin"], world["term"]["id"]
    empty = admin.post(f"/api/terms/{term_id}/sections",
                       {"name": "1C", "year_level": 1}).json()
    response = admin.delete(f"/api/sections/{empty['id']}")
    assert response.status_code == 204
    assert all(section["id"] != empty["id"]
               for section in admin.get(f"/api/terms/{term_id}/sections").json())

    assigned_id = world["sections"][0]["id"]
    blocked_assignment = admin.delete(f"/api/sections/{assigned_id}")
    assert blocked_assignment.status_code == 409
    assert blocked_assignment.json()["error"]["code"] == "section_in_use"

    section_with_history = world["sections"][1]
    student = world["students"][0]
    assert add_member(world, section_with_history, student).status_code == 204
    withdrawn = admin.delete(
        f"/api/sections/{section_with_history['id']}/members/{student.id}?reason=Moved%20sections")
    assert withdrawn.status_code == 204
    blocked_history = admin.delete(f"/api/sections/{section_with_history['id']}")
    assert blocked_history.status_code == 409
    assert blocked_history.json()["error"]["code"] == "section_in_use"


def test_offering_assignment_can_be_archived_and_restored_without_losing_history(world, db):
    admin = world["admin"]
    offering_id = world["offering"]["id"]
    student = world["students"][0]
    section = world["sections"][0]
    assert add_member(world, section, student).status_code == 204

    blocked = admin.delete(f"/api/offerings/{offering_id}")
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "offering_has_enrolled_students"

    withdrawn = admin.delete(
        f"/api/sections/{section['id']}/members/{student.id}?reason=Moved%20sections")
    assert withdrawn.status_code == 204
    archived = admin.delete(f"/api/offerings/{offering_id}")
    assert archived.status_code == 200, archived.text
    assert archived.json()["status"] == "archived"
    assert roster(admin, offering_id)[str(student.id)]["status"] == "withdrawn"

    restored = admin.post(f"/api/offerings/{offering_id}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["status"] == "active"


def test_offering_can_be_transferred_without_moving_or_archiving_academic_history(db, world):
    admin = world["admin"]
    offering_id = world["offering"]["id"]
    replacement = make_account(db, "replacement@example.com", "faculty")
    student = world["students"][0]
    assert add_member(world, world["sections"][0], student).status_code == 204

    transferred = admin.patch(f"/api/offerings/{offering_id}", {
        "faculty_id": str(replacement.id),
    })
    assert transferred.status_code == 200, transferred.text
    assert transferred.json()["id"] == offering_id
    assert transferred.json()["status"] == "active"
    assert transferred.json()["faculty"]["id"] == str(replacement.id)
    assert roster(admin, offering_id)[str(student.id)]["status"] == "enrolled"
    event = db.scalar(select(AuditEvent).where(
        AuditEvent.action == "offering.faculty_transferred",
        AuditEvent.entity_id == offering_id))
    assert event.details == {
        "previous_faculty_id": str(world["faculty"].id),
        "faculty_id": str(replacement.id),
    }


def test_offering_transfer_rejects_existing_duplicate_for_target_teacher(world, db):
    admin, term = world["admin"], world["term"]
    replacement = make_account(db, "replacement-duplicate@example.com", "faculty")
    second_assignment = admin.post(f"/api/terms/{term['id']}/offerings", {
        "subject_id": world["subject"]["id"],
        "faculty_id": str(replacement.id),
        "section_ids": [],
    })
    assert second_assignment.status_code == 201, second_assignment.text

    conflict = admin.patch(f"/api/offerings/{world['offering']['id']}", {
        "faculty_id": str(replacement.id),
    })
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "offering_exists"


def test_one_active_section_per_term_and_withdrawal_history(db, world):
    s1 = world["students"][0]
    a, b = world["sections"]
    admin, oid = world["admin"], world["offering"]["id"]
    assert add_member(world, a, s1).status_code == 204
    second = add_member(world, b, s1)
    assert second.status_code == 409 and second.json()["error"]["code"] == "already_in_section"
    url = f"/api/sections/{a['id']}/members/{s1.id}"
    assert admin.delete(url).status_code == 422                                  # no reason at all
    blank = admin.delete(url + "?reason=%20%20")
    assert blank.status_code == 422 and blank.json()["error"]["code"] == "reason_required"
    assert roster(admin, oid)[str(s1.id)]["status"] == "enrolled"              # a refused withdrawal changed nothing
    assert admin.delete(url + "?reason=Left%20the%20programme").status_code == 204
    event = db.scalars(select(AuditEvent).where(AuditEvent.action == "section.member_withdrawn")).one()
    assert event.details["reason"] == "Left the programme"
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


def test_inactive_term_blocks_writes_and_cannot_be_reopened(world):
    admin, term = world["admin"], world["term"]
    s1 = world["students"][0]
    assert admin.post(f"/api/terms/{term['id']}/close").status_code == 200
    blocked = add_member(world, world["sections"][0], s1)
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "term_closed"
    assert admin.post(f"/api/terms/{term['id']}/sections",
                      {"name": "3A", "year_level": 3}).status_code == 409
    reopened = admin.post(f"/api/terms/{term['id']}/reopen",
                          {"reason": "Late grade correction"})
    assert reopened.status_code == 409
    assert reopened.json()["error"]["code"] == "term_reactivation_forbidden"
    blocked_again = add_member(world, world["sections"][0], s1)
    assert blocked_again.status_code == 409
    actions = [e["action"] for e in admin.get("/api/audit").json()]
    assert "term.closed" in actions and "term.reopened" not in actions


def test_new_year_copies_structure_and_keeps_history(world):
    s1 = world["students"][0]
    admin, oid = world["admin"], world["offering"]["id"]
    add_member(world, world["sections"][0], s1)
    close_school_year(admin, world["term"], world["next_term"])
    year = admin.post("/api/school-years", {
        "label": "2027-2028", "start_date": "2027-06-01", "end_date": "2028-04-30",
        "terms": [{"name": "First Semester", "sequence": 1, "start_date": "2027-06-01",
                   "end_date": "2027-10-31"},
                  {"name": "Second Semester", "sequence": 2, "start_date": "2027-11-01",
                   "end_date": "2028-04-30"}]})
    assert year.status_code == 201, year.text
    new_term = year.json()["terms"][0]
    assert new_term["status"] == "draft"
    assert admin.get(f"/api/terms/{new_term['id']}/sections").json() == []
    assert admin.post(f"/api/terms/{new_term['id']}/schedule").status_code == 200
    assert admin.post(f"/api/terms/{new_term['id']}/activate").status_code == 200
    copied = admin.post(f"/api/terms/{new_term['id']}/copy-structure"
                        f"?source_term_id={world['term']['id']}&offerings=true")
    assert copied.status_code == 204, copied.text
    offerings = admin.get(f"/api/terms/{new_term['id']}/offerings").json()
    assert len(offerings) == 1 and offerings[0]["enrolled"] == 0 and offerings[0]["id"] != oid
    assert [s["name"] for s in admin.get(f"/api/terms/{new_term['id']}/sections").json()] \
        == ["1A", "1B"]
    # The closed term's roster and the student's history are untouched.
    assert roster(admin, oid)[str(s1.id)]["status"] == "enrolled"
    subjects = Api("s1@example.com").get("/api/me/subjects").json()
    assert [s["offering_id"] for s in subjects] == [oid] and subjects[0]["term_status"] == "inactive"


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
    close_school_year(admin, world["term"], world["next_term"])
    year = admin.post("/api/school-years", {
        "label": "2027-2028", "start_date": "2027-06-01", "end_date": "2028-04-30",
        "terms": [{"name": "First Semester", "sequence": 1, "start_date": "2027-06-01",
                   "end_date": "2027-10-31"},
                  {"name": "Second Semester", "sequence": 2, "start_date": "2027-11-01",
                   "end_date": "2028-04-30"}]}).json()
    new_term = year["terms"][0]["id"]
    assert admin.post(f"/api/terms/{new_term}/schedule").status_code == 200
    assert admin.post(f"/api/terms/{new_term}/activate").status_code == 200
    copied = admin.post(f"/api/terms/{new_term}/copy-structure"
                        f"?source_term_id={world['term']['id']}")
    assert copied.status_code == 204, copied.text
    assert admin.get(f"/api/terms/{new_term}/offerings").json() == []
    assert len(admin.get(f"/api/terms/{new_term}/sections").json()) == 2


def test_semester_activation_requires_closure_and_only_one_active(actors):
    admin = Api("admin@example.com")
    year = admin.post("/api/school-years", school_year_body()).json()
    first, second = year["terms"]
    assert admin.post(f"/api/terms/{first['id']}/schedule").status_code == 200
    assert admin.post(f"/api/terms/{second['id']}/schedule").status_code == 200
    assert admin.post(f"/api/terms/{first['id']}/activate").status_code == 200

    blocked = admin.post(f"/api/terms/{second['id']}/activate")
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "active_term_exists"

    assert admin.post(f"/api/terms/{first['id']}/close").json()["status"] == "inactive"
    activated = admin.post(f"/api/terms/{second['id']}/activate")
    assert activated.status_code == 200, activated.text
    assert activated.json()["status"] == "active"
    actions = {row["action"] for row in admin.get("/api/audit").json()}
    assert {"term.scheduled", "term.activated", "term.closed"}.issubset(actions)


def test_scheduled_semester_is_read_only_for_normal_academic_operations(actors):
    admin = Api("admin@example.com")
    term = admin.post("/api/school-years", school_year_body()).json()["terms"][0]
    assert admin.post(f"/api/terms/{term['id']}/schedule").status_code == 200

    section = admin.post(f"/api/terms/{term['id']}/sections", {
        "name": "1A", "year_level": 1})
    assert section.status_code == 409
    assert section.json()["error"]["code"] == "term_not_active"
    update = admin.patch(f"/api/terms/{term['id']}", {"name": "Changed"})
    assert update.status_code == 409
    assert update.json()["error"]["code"] == "term_read_only"


def test_database_prevents_overlapping_years_and_multiple_active_terms(db, actors):
    admin = Api("admin@example.com")
    year = admin.post("/api/school-years", school_year_body()).json()
    first, second = year["terms"]

    db.add(SchoolYear(label="2033-2034", start_date=date(2033, 5, 1),
                      end_date=date(2034, 4, 30)))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()

    db.add(AcademicTerm(school_year_id=uuid.UUID(year["id"]), name="Overlapping",
                        sequence=3, start_date=date(2032, 8, 10),
                        end_date=date(2032, 8, 20), status="draft"))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()

    assert admin.post(f"/api/terms/{first['id']}/schedule").status_code == 200
    assert admin.post(f"/api/terms/{first['id']}/activate").status_code == 200
    second_term = db.scalar(select(AcademicTerm).where(AcademicTerm.id == uuid.UUID(second["id"])))
    second_term.status = "active"
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


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
    admin.delete(f"/api/sections/{world['sections'][0]['id']}/members/{s1.id}?reason=Left%20the%20programme")
    faculty = Api("faculty@example.com")
    assert faculty.get(f"/api/offerings/{oid}/students").json() == []
    history = faculty.get(f"/api/offerings/{oid}/students?history=true").json()
    assert [r["status"] for r in history] == ["withdrawn"]


# ---------------- bulk assignment and the paginated section roster ----------------

def make_subject(w, code, **over):
    return w["admin"].post("/api/subjects", {"code": code, "title": f"Title {code}", "units": "3",
                                             "year_level": 1, "semester": 1, **over}).json()


def test_a_teacher_can_be_given_several_subjects_with_their_own_sections_at_once(db, world):
    admin, term, faculty = world["admin"], world["term"], world["faculty"]
    a, b = make_subject(world, "ENT 201"), make_subject(world, "ENT 202")
    sec_a, sec_b = world["sections"]
    url = f"/api/terms/{term['id']}/offerings/bulk"
    made = admin.post(url, {"faculty_id": str(faculty.id), "items": [
        {"subject_id": a["id"], "section_ids": [sec_a["id"]]},
        {"subject_id": b["id"], "section_ids": [sec_a["id"], sec_b["id"]]}]})
    assert made.status_code == 201, made.text
    by_code = {o["subject"]["code"]: o for o in made.json()}
    assert [s["name"] for s in by_code["ENT 201"]["sections"]] == ["1A"]
    assert sorted(s["name"] for s in by_code["ENT 202"]["sections"]) == ["1A", "1B"]
    assert len(admin.get(f"/api/terms/{term['id']}/offerings").json()) == 3          # the fixture's offering plus two
    events = db.scalars(select(AuditEvent).where(AuditEvent.action == "offering.created")).all()
    assert len(events) == 3


def test_a_bulk_assignment_is_all_or_nothing_and_names_the_subject_that_failed(db, world):
    admin, term, faculty = world["admin"], world["term"], world["faculty"]
    good = make_subject(world, "ENT 301")
    second_year = make_subject(world, "ENT 302", year_level=2)                      # 1A and 1B are first-year sections
    url = f"/api/terms/{term['id']}/offerings/bulk"
    refused = admin.post(url, {"faculty_id": str(faculty.id), "items": [
        {"subject_id": good["id"], "section_ids": [world["sections"][0]["id"]]},
        {"subject_id": second_year["id"], "section_ids": [world["sections"][0]["id"]]}]})
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "placement_mismatch"
    assert "ENT 302" in refused.json()["error"]["message"] and "Nothing was saved" in refused.json()["error"]["message"]
    assert len(admin.get(f"/api/terms/{term['id']}/offerings").json()) == 1          # ENT 301 was not kept
    allowed = admin.post(url, {"faculty_id": str(faculty.id), "items": [
        {"subject_id": second_year["id"], "section_ids": [world["sections"][0]["id"]], "placement_override_reason": "Irregular cohort"}]})
    assert allowed.status_code == 201
    twice = admin.post(url, {"faculty_id": str(faculty.id), "items": [{"subject_id": good["id"]}, {"subject_id": good["id"]}]})
    assert twice.status_code == 422 and twice.json()["error"]["code"] == "duplicate_subject"
    exists = admin.post(url, {"faculty_id": str(faculty.id), "items": [{"subject_id": world["subject"]["id"]}]})
    assert exists.status_code == 409 and "ENT 101" in exists.json()["error"]["message"]
    for who in ("faculty@example.com", "student@example.com"):
        assert Api(who).post(url, {"faculty_id": str(faculty.id), "items": [{"subject_id": good["id"]}]}).status_code == 403


def test_bulk_assignment_rejects_a_section_already_assigned_to_another_teacher(db, world):
    admin = world["admin"]
    replacement = make_account(db, "section-conflict@example.com", "faculty")
    response = admin.post(f"/api/terms/{world['term']['id']}/offerings/bulk", {
        "faculty_id": str(replacement.id),
        "items": [{
            "subject_id": world["subject"]["id"],
            "section_ids": [world["sections"][0]["id"]],
        }],
    })
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "section_already_assigned"
    assert "1A" in response.json()["error"]["message"]
    assert "faculty" in response.json()["error"]["message"].lower()
    offerings = admin.get(f"/api/terms/{world['term']['id']}/offerings").json()
    assert len(offerings) == 1


def test_the_section_roster_pages_searches_and_filters_and_candidates_exclude_placed_students(db, world):
    admin, sec_a, sec_b = world["admin"], *world["sections"]
    people = [make_account(db, f"roster{i}@example.com", "student", f"R-{i:02d}") for i in range(7)]
    for person in people[:5]:
        assert add_member(world, sec_a, person).status_code == 204
    assert add_member(world, sec_b, people[5]).status_code == 204
    admin.delete(f"/api/sections/{sec_a['id']}/members/{people[0].id}?reason=Moved%20away")
    base = f"/api/sections/{sec_a['id']}/roster"
    page1 = admin.get(base + "?page_size=2").json()
    assert page1["total"] == 4 and len(page1["items"]) == 2 and page1["page"] == 1           # active only by default
    assert page1["items"][0]["email"].endswith("@example.com")
    assert page1["items"][0]["account_status"] == "active"
    assert len(admin.get(base + "?page_size=2&page=2").json()["items"]) == 2
    assert admin.get(base + "?page_size=2&page=3").json()["items"] == []
    withdrawn = admin.get(base + "?status=withdrawn").json()
    assert withdrawn["total"] == 1 and withdrawn["items"][0]["status"] == "withdrawn"
    assert admin.get(base + "?status=all").json()["total"] == 5
    assert admin.get(base + "?search=R-03").json()["total"] == 1
    assert admin.get(base + "?search=roster4%40").json()["total"] == 1
    cand = admin.get(f"/api/sections/{sec_a['id']}/candidates?page_size=100").json()
    emails = {c["email"] for c in cand["items"]}
    assert "roster6@example.com" in emails and "roster0@example.com" in emails                # free, or withdrawn and free again
    assert not emails & {f"roster{i}@example.com" for i in (1, 2, 3, 4, 5)}                   # active in this or another section of the term
    assert admin.get(f"/api/sections/{sec_a['id']}/candidates?search=roster6").json()["total"] == 1
    assert Api("faculty@example.com").get(base).status_code == 403
    assert admin.get(f"/api/sections/{uuid_zero()}/roster").status_code == 404


def test_colleges_can_group_subjects_and_reject_usage(world):
    admin = world["admin"]
    college = admin.post("/api/colleges", {
        "code": "bse",
        "name": "School of Business and Entrepreneurship",
        "description": "Business and entrepreneurship programs."}).json()
    assert college["code"] == "BSE"
    assert admin.get(f"/api/colleges/{college['id']}").json()["name"] == college["name"]
    assert admin.get(f"/api/colleges/{uuid_zero()}").status_code == 404

    updated = admin.patch(f"/api/colleges/{college['id']}", {"name": "School of Entrepreneurship"})
    assert updated.status_code == 200 and updated.json()["name"] == "School of Entrepreneurship"

    assigned = admin.patch(f"/api/subjects/{world['subject']['id']}", {"college_id": college["id"]})
    assert assigned.status_code == 200
    subject = assigned.json()
    assert subject["college_id"] == college["id"]
    assert admin.get("/api/subjects?college_id=" + college["id"]).json()[0]["id"] == world["subject"]["id"]

    blocked = admin.delete(f"/api/colleges/{college['id']}")
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "college_in_use"

    unassigned = admin.patch(f"/api/subjects/{world['subject']['id']}", {"college_id": None})
    assert unassigned.status_code == 200 and unassigned.json()["college_id"] is None
    assert admin.delete(f"/api/colleges/{college['id']}").status_code == 204


def test_college_assigned_to_teacher_cannot_be_deleted(world, monkeypatch):
    monkeypatch.setattr("app.features.accounts.commands.send_link", lambda account, token, purpose: None)
    admin = world["admin"]
    college = admin.post("/api/colleges", {"code": "FAC", "name": "Faculty College"}).json()
    invited = admin.post("/api/accounts", {
        "email": "college-faculty@example.com",
        "display_name": "College Faculty",
        "role": "faculty",
        "college_id": college["id"],
    })
    assert invited.status_code == 201, invited.text
    deleted = admin.delete(f"/api/colleges/{college['id']}")
    assert deleted.status_code == 409
    assert deleted.json()["error"]["code"] == "college_in_use"


def uuid_zero():
    import uuid
    return uuid.UUID(int=0)
