"""Skeleton-first setup: planned drafts, class meeting days, and copying a previous subject into an empty one."""
from helpers import POLICY, make_account
from test_assessments import make_manual, make_quiz, second_offering
from test_dashboard import home
from test_teaching import PDF, edit_and_publish, new_item


def base(oid):
    return f"/api/teach/offerings/{oid}"


PLAN = {"plan_key": "plan-key-0001", "items": [
    {"kind": "online_quiz", "title": "Quiz 1", "category_key": "quiz", "period": "midterm"},
    {"kind": "activity", "title": "Activity 1", "category_key": "activity", "period": "midterm"},
    {"kind": "exam", "title": "Midterm examination", "category_key": "exam", "period": "midterm"}]}


def test_a_plan_creates_hidden_drafts_and_a_repeat_creates_nothing_more(graded):
    c, oid = graded, graded["oid"]
    first = c["fac"].post(base(oid) + "/assessments/plan", PLAN)
    assert first.status_code == 201, first.text
    ids = first.json()["ids"]
    assert len(ids) == 3 and first.json()["repeat"] is False
    listed = c["fac"].get(base(oid) + "/assessments").json()
    planned = [a for a in listed if a["id"] in ids]
    assert len(planned) == 3 and all(a["published"] is None and a["draft"] for a in planned)
    quiz = next(a for a in planned if a["kind"] == "online_quiz")["draft"]
    assert (quiz["title"], quiz["category_key"], quiz["period"]) == ("Quiz 1", "quiz", "midterm")
    titles = [w["title"] for w in home(c)["todo"]]
    assert "Quiz 1" not in titles and "Activity 1" not in titles                    # students see nothing yet
    again = c["fac"].post(base(oid) + "/assessments/plan", PLAN).json()
    assert again["repeat"] is True and again["ids"] == ids
    assert len(c["fac"].get(base(oid) + "/assessments").json()) == len(listed)       # nothing created twice


def test_a_plan_is_checked_against_the_grading_policy_and_limits_and_roles(db, graded):
    c, oid = graded, graded["oid"]
    bad = {"plan_key": "plan-key-0002", "items": [{"kind": "online_quiz", "title": "Odd", "category_key": "bonus"}]}
    assert c["fac"].post(base(oid) + "/assessments/plan", bad).status_code == 422
    wrong_period = {"plan_key": "plan-key-0003", "items": [{"kind": "exam", "title": "Odd", "period": "summer"}]}
    assert c["fac"].post(base(oid) + "/assessments/plan", wrong_period).status_code == 422
    many = {"plan_key": "plan-key-0004", "items": [{"kind": "manual", "title": f"Item {n}"} for n in range(31)]}
    assert c["fac"].post(base(oid) + "/assessments/plan", many).status_code == 422
    assert c["fac"].post(base(oid) + "/assessments/plan", {"plan_key": "plan-key-0005", "items": []}).status_code == 422
    other = make_account(db, "planner@example.com", "faculty")
    from helpers import Api
    assert Api(other.email).post(base(oid) + "/assessments/plan", PLAN).status_code == 404
    assert c["st1"].post(base(oid) + "/assessments/plan", PLAN).status_code == 403
    assert c["admin"].post(base(oid) + "/assessments/plan", PLAN).status_code == 403


def test_meeting_days_are_stored_per_subject_by_its_teacher_only(db, graded):
    c, oid = graded, graded["oid"]
    assert c["fac"].get(f"/api/offerings/{oid}").json()["meeting_days"] == 0
    assert c["fac"].put(base(oid) + "/schedule", {"meeting_days": 21}).json() == {"meeting_days": 21}   # Mon, Wed, Fri
    assert c["fac"].get(f"/api/offerings/{oid}").json()["meeting_days"] == 21
    assert c["fac"].put(base(oid) + "/schedule", {"meeting_days": 128}).status_code == 422
    assert c["fac"].put(base(oid) + "/schedule", {"meeting_days": -1}).status_code == 422
    from helpers import Api
    other = make_account(db, "planner2@example.com", "faculty")
    assert Api(other.email).put(base(oid) + "/schedule", {"meeting_days": 1}).status_code == 404
    assert c["st1"].put(base(oid) + "/schedule", {"meeting_days": 1}).status_code == 403
    assert c["fac"].get(f"/api/offerings/{oid}").json()["meeting_days"] == 21


def test_copying_a_previous_subject_fills_an_empty_one_with_drafts_only(db, graded):
    c, oid = graded, graded["oid"]
    lesson = new_item(c, "lesson", "Starting a venture")
    assert edit_and_publish(c, lesson["id"], title="Starting a venture", body_html="<p>A venture starts with a problem.</p>").status_code == 200
    link = new_item(c, "reference", "Reading")
    assert edit_and_publish(c, link["id"], title="Reading", reference_url="https://example.com/read", reference_note="Chapter 2").status_code == 200
    filed = new_item(c, "file", "Handout")
    counter = c["fac"].get(base(oid) + f"/items/{filed['id']}").json()["draft"]["counter"]
    up = c["fac"].upload(base(oid) + f"/items/{filed['id']}/draft/file", "handout.pdf", PDF, {"expected_counter": counter})
    assert up.status_code == 200, up.text
    source_file = up.json()["file"]["id"]
    saved = c["fac"].get(base(oid) + f"/items/{filed['id']}").json()["draft"]["counter"]
    assert c["fac"].post(base(oid) + f"/items/{filed['id']}/draft/publish", {"expected_counter": saved}).status_code == 200
    make_quiz(c, title="Quiz 1", category_key="quiz", period="midterm")
    make_manual(c, "activity", "Poster", points="10", category_key="activity", period="midterm")
    before = len(c["fac"].get(base(oid) + "/assessments").json())

    target = second_offering(c)
    done = c["fac"].post(base(target) + f"/copy-from/{oid}")
    assert done.status_code == 201, done.text
    assert done.json() == {"syllabus": True, "items": 3, "assessments": 2, "skipped_files": 0}

    syllabus = c["fac"].get(base(target) + "/syllabus").json()
    assert syllabus["published"] is None and syllabus["draft"]["grading_policy"] == POLICY         # a draft: publishing re-confirms it
    items = c["fac"].get(base(target) + "/items").json()
    assert len(items) == 3 and all(i["published"] is None and i["draft"] for i in items)
    copied_file = next(i for i in items if i["kind"] == "file")["draft"]["file"]["id"]
    assert copied_file != source_file and c["fac"].get(f"/api/files/{copied_file}/download").status_code == 200
    assert next(i for i in items if i["kind"] == "reference")["draft"]["reference_url"] == "https://example.com/read"
    assessments = c["fac"].get(base(target) + "/assessments").json()
    assert len(assessments) == 2 and all(a["published"] is None and a["section_ids"] == [] for a in assessments)
    quiz = next(a for a in assessments if a["kind"] == "online_quiz")["draft"]
    assert len(quiz["questions"]) == 3 and quiz["deadline"] is None and quiz["available_from"] is None
    assert c["st1"].get(f"/api/learn/offerings/{target}/items").json() == []                      # students see none of it
    assert len(c["fac"].get(base(oid) + "/assessments").json()) == before                          # the source is untouched


def test_copying_is_refused_for_a_non_empty_subject_the_same_subject_and_someone_elses(db, graded):
    c, oid = graded, graded["oid"]
    target = second_offering(c)
    assert c["fac"].post(base(target) + f"/copy-from/{target}").status_code == 422
    assert c["fac"].post(base(oid) + f"/copy-from/{oid}").status_code == 422
    assert c["fac"].post(base(target) + f"/copy-from/{oid}").status_code == 201
    again = c["fac"].post(base(target) + f"/copy-from/{oid}")
    assert again.status_code == 409 and again.json()["error"]["code"] == "subject_not_empty"
    from helpers import Api
    other = make_account(db, "planner3@example.com", "faculty")
    assert Api(other.email).post(base(target) + f"/copy-from/{oid}").status_code == 404
    assert c["st1"].post(base(target) + f"/copy-from/{oid}").status_code == 403
