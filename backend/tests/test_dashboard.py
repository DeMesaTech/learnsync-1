import json
from datetime import UTC

from helpers import Api, learn, make_account, t
from test_activities import score, submit_pdf
from test_assessments import make_manual, make_quiz, start, submit
from test_grading import full_term, publish_grades
from test_study import lesson

BODY = "<p>Starting a venture.</p>"


def home(c, who="st1"):
    response = c[who].get("/api/dashboard/student")
    assert response.status_code == 200, response.text
    return response.json()


def test_the_student_home_lists_only_current_enrolled_subjects(course):
    data = home(course)
    assert [s["code"] for s in data["subjects"]] == [course["subject"]["code"]]
    assert data["name"] == "s1" and data["next_step"] is None and data["todo"] == []     # nothing published yet
    assert [d["label"] for d in data["week"]["days"]] == ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    assert sum(d["today"] for d in data["week"]["days"]) == 1


def test_the_next_step_is_the_first_incomplete_published_lesson_and_opening_is_not_completion(course):
    first = lesson(course, "First lesson", BODY)
    second = lesson(course, "Second lesson", BODY)
    lesson(course, "Hidden for 1B", BODY, section_ids=[course["sec_b"]["id"]])
    assert home(course)["next_step"]["item_id"] == first
    course["st1"].get(learn(course, f"/items/{first}"))                                   # opening it counts for nothing
    assert home(course)["next_step"]["item_id"] == first
    assert sum(d["count"] for d in home(course)["week"]["days"]) == 0
    course["st1"].post(learn(course, f"/lessons/{first}/complete"))
    after = home(course)
    assert after["next_step"]["item_id"] == second and after["week"]["lessons_today"] == 1
    assert sum(d["count"] for d in after["week"]["days"]) == 1
    assert after["subjects"][0]["percent"] == 50
    assert home(course, "st2")["next_step"]["title"] == "First lesson"                      # section 1B sees its own set
    assert "Hidden for 1B" not in json.dumps(after)


def test_work_is_sorted_into_to_do_awaiting_feedback_and_another_attempt(graded):
    quiz = make_quiz(graded, title="Open quiz", max_attempts=2)
    activity = make_manual(graded, "activity", "Poster", points="10", category_key="activity")
    done = make_manual(graded, "activity", "Already handed in", points="10", category_key="activity")
    make_manual(graded, "exam", "Midterm exam", points="50", category_key="exam")          # not student work
    data = home(graded)
    assert sorted(w["title"] for w in data["todo"]) == ["Already handed in", "Open quiz", "Poster"]
    assert data["awaiting_feedback"] == [] and data["another_attempt"] == []
    assert submit_pdf(graded["st1"], graded, done).status_code in (200, 201)
    attempt = start(graded["st1"], graded, quiz["aid"]).json()
    assert submit(graded["st1"], graded, attempt["id"], quiz["correct"]).status_code == 200
    data = home(graded)
    assert [w["title"] for w in data["todo"]] == ["Poster"]
    assert [w["title"] for w in data["awaiting_feedback"]] == ["Already handed in"]       # submitted, no result released
    assert [w["title"] for w in data["another_attempt"]] == ["Open quiz"]                 # not "unfinished"
    assert data["another_attempt"][0]["attempts_left"] == 1
    assert score(graded, done, graded["students"][0], 9).status_code == 200
    assert [w["title"] for w in home(graded)["awaiting_feedback"]] == ["Already handed in"]    # a typed score is still unreleased
    assert graded["fac"].post(f"/api/teach/offerings/{graded['oid']}/assessments/{done}/release", {}).json() == {"released": 1}
    assert home(graded)["awaiting_feedback"] == [] and activity


def test_updates_show_only_published_authorised_content_and_the_students_own_releases(graded):
    full_term(graded)
    fac = graded["fac"]
    sec_a, sec_b = graded["sec_a"]["id"], graded["sec_b"]["id"]
    made = fac.post(t(graded, "/announcements"), {"title": "Quiz Friday", "body": "Bring a pen.", "section_ids": [sec_a]}).json()
    fac.post(t(graded, f"/announcements/{made['id']}/publish"))
    fac.post(t(graded, "/announcements"), {"title": "Unpublished draft", "body": "x", "section_ids": [sec_a]})
    other = fac.post(t(graded, "/announcements"), {"title": "Only for 1B", "body": "x", "section_ids": [sec_b]}).json()
    fac.post(t(graded, f"/announcements/{other['id']}/publish"))
    lesson(graded, "Fresh material", BODY)
    publish_grades(graded, "midterm")
    mine = json.dumps(home(graded)["updates"])
    assert "Quiz Friday" in mine and "Fresh material" in mine and "Midterm grade published" in mine
    assert "Unpublished draft" not in mine and "Only for 1B" not in mine
    theirs = json.dumps(home(graded, "st2")["updates"])
    assert "Only for 1B" in theirs and "Quiz Friday" not in theirs and "grade published" not in theirs   # not s1's grade
    assert not any(word in mine for word in ("explanation", "correct", "snapshot", "feedback", "score"))


def test_withdrawn_students_and_closed_terms_get_no_new_work(graded):
    make_quiz(graded, title="Quiz")
    lesson(graded, "Lesson", BODY)
    assert len(home(graded)["todo"]) == 1
    graded["admin"].post(f"/api/terms/{graded['term']['id']}/close")
    closed = home(graded)
    assert closed["subjects"] == [] and closed["todo"] == [] and closed["next_step"] is None and closed["updates"] == []


def test_a_withdrawn_student_sees_no_course_content_on_the_home_page(graded):
    make_quiz(graded, title="Quiz")
    lesson(graded, "Lesson", BODY)
    graded["admin"].delete(f"/api/sections/{graded['sec_a']['id']}/members/{graded['students'][0].id}")
    data = home(graded)
    assert data["subjects"] == [] and data["todo"] == [] and data["updates"] == []


def test_the_faculty_home_counts_only_the_teachers_own_work(db, graded):
    fac = graded["fac"]
    activity = make_manual(graded, "activity", "Poster", points="10", category_key=None, include_in_grade=False)   # practice work
    submit_pdf(graded["st1"], graded, activity)
    ids = full_term(graded)
    publish_grades(graded, "midterm")
    assert score(graded, ids["exam_m"], graded["students"][0], 44).status_code == 200      # flags the published grade
    lesson(graded, "Published lesson", BODY)
    from test_teaching import new_item
    new_item(graded, "lesson", "A draft that nobody can see")
    data = fac.get("/api/dashboard/faculty").json()
    card = data["subjects"][0]
    assert len(data["subjects"]) == 1 and card["code"] == graded["subject"]["code"]
    assert card["to_grade"] == 1 and card["needs_review"] == 1 and card["drafts_content"] == 1
    assert card["students"] == 2 and card["sections"] == ["1A", "1B"]
    assert data["task"]["headline"].endswith("ready to grade") and data["task"]["link"].endswith("/scores")
    assert data["totals"] == {"subjects": 1, "students": 2, "to_grade": 1, "needs_review": 1, "drafts": 1}
    assert [(q["count"], q["link"].endswith("/scores")) for q in data["queue"]] == [(1, True)]
    assert data["review_link"].endswith("/gradebook") and data["task"]["icon"] == "!"
    stranger = Api(make_account(db, "other@example.com", "faculty").email)
    empty = stranger.get("/api/dashboard/faculty").json()
    assert empty["subjects"] == [] and empty["task"] is None and empty["queue"] == [] and empty["review_link"] is None and empty["totals"]["students"] == 0
    assert "A draft that nobody can see" not in json.dumps(empty)


def test_the_faculty_home_never_includes_student_conversations(graded):
    cid = graded["st1"].post(learn(graded, "/study/conversations")).json()["id"]
    graded["st1"].post(learn(graded, f"/study/conversations/{cid}/messages"),
                       {"text": "my private question", "client_message_id": "private-dashboard-1"})
    assert "private question" not in graded["fac"].get("/api/dashboard/faculty").text


def test_the_admin_home_has_setup_counts_and_none_of_the_teaching_data(world):
    admin = world["admin"]
    data = admin.get("/api/dashboard/admin").json()
    assert data["terms"][0]["offerings"] == 1 and data["terms"][0]["sections"] == 2
    assert data["accounts"]["students"] == 3 and data["accounts"]["faculty"] == 1       # s1, s2 and the fixture student
    Api("s1@example.com").post("/api/issues", {"type": "bug", "title": "Something broke", "description": "It broke when I clicked."})
    assert admin.get("/api/dashboard/admin").json()["issues"]["open"] == 1
    raw = json.dumps(data).lower()
    for forbidden in ("grade", "score", "submission", "draft", "conversation", "answer"):
        assert forbidden not in raw, forbidden


def test_the_todo_page_lists_everything_the_dashboard_summarises_and_only_for_students(graded):
    quiz = make_quiz(graded, title="Open quiz", max_attempts=2)
    done = make_manual(graded, "activity", "Already handed in", points="10", category_key="activity")
    make_manual(graded, "activity", "Poster", points="10", category_key="activity")
    assert submit_pdf(graded["st1"], graded, done).status_code in (200, 201)
    attempt = start(graded["st1"], graded, quiz["aid"]).json()
    assert submit(graded["st1"], graded, attempt["id"], quiz["correct"]).status_code == 200
    page = graded["st1"].get("/api/dashboard/student/todo").json()
    data = home(graded)
    for key in ("todo", "awaiting_feedback", "another_attempt"):
        assert [w["assessment_id"] for w in page[key]] == [w["assessment_id"] for w in data[key]], key
    assert [w["title"] for w in page["todo"]] == ["Poster"] and page["another_attempt"][0]["attempts_left"] == 1
    assert graded["fac"].get("/api/dashboard/student/todo").status_code == 403
    assert graded["admin"].get("/api/dashboard/student/todo").status_code == 403


def test_todo_order_puts_open_work_first_and_never_offers_upcoming_work_as_the_next_step(graded):
    from datetime import datetime, timedelta, timezone
    iso = lambda days: (datetime.now(UTC) + timedelta(days=days)).isoformat()
    make_manual(graded, "activity", "Later due", points="10", category_key="activity", deadline=iso(5))
    make_manual(graded, "activity", "No deadline", points="10", category_key="activity")
    make_manual(graded, "activity", "Due first", points="10", category_key="activity", deadline=iso(1))
    make_manual(graded, "activity", "Opens last", points="10", category_key="activity", available_from=iso(6), deadline=iso(9))
    make_manual(graded, "activity", "Opens soon", points="10", category_key="activity", available_from=iso(2), deadline=iso(20))
    page = graded["st1"].get("/api/dashboard/student/todo").json()
    assert [w["title"] for w in page["todo"]] == ["Due first", "Later due", "No deadline", "Opens soon", "Opens last"]
    assert all("late_allowed" in w for w in page["todo"])
    data = home(graded)
    assert data["next_step"]["title"] in ("Due first",) or data["next_step"]["type"] == "lesson"
    assert "Opens" not in (data["next_step"] or {}).get("title", "")


def test_each_dashboard_is_for_its_own_role(graded):
    for who, mine, others in (("st1", "student", ("faculty", "admin")), ("fac", "faculty", ("student", "admin")),
                              ("admin", "admin", ("student", "faculty"))):
        assert graded[who].get(f"/api/dashboard/{mine}").status_code == 200
        for other in others:
            assert graded[who].get(f"/api/dashboard/{other}").status_code == 403
    from fastapi.testclient import TestClient

    from app.main import app
    assert TestClient(app).get("/api/dashboard/student").status_code == 401


def test_recent_account_activity_shows_changes_to_people_not_routine_sign_ins(world):
    admin = world["admin"]
    admin.post("/api/accounts", {"email": "new.teacher@example.com", "display_name": "New Teacher", "role": "faculty", "student_number": None})
    Api("s1@example.com")                                             # signs in
    actions = [a["action"] for a in admin.get("/api/dashboard/admin").json()["recent_activity"]]
    assert "account.invited" in actions and "account.signed_in" not in actions


def test_the_admin_setup_guide_is_derived_and_disappears_when_complete():
    from app.features.dashboard.admin import setup_steps
    empty = setup_steps([], 0, 0)
    assert [x["key"] for x in empty if not x["done"]] == ["term", "subjects", "sections", "faculty", "offerings", "students"]
    term = {"id": "t1", "sections": 1, "offerings": 0, "students": 0}
    partial = {x["key"]: x for x in setup_steps([term], 3, 0)}
    assert partial["term"]["done"] and partial["sections"]["link"] == "/admin/terms/t1" and not partial["offerings"]["done"]
    assert setup_steps([{**term, "offerings": 1, "students": 2}], 3, 5) == []
    first_empty = {"id": "t1", "sections": 0, "offerings": 0, "students": 0}
    other = {"id": "t2", "sections": 4, "offerings": 4, "students": 9}      # only the FIRST term counts
    steps = {x["key"]: x for x in setup_steps([first_empty, other], 3, 1)}
    assert not steps["sections"]["done"] and not steps["offerings"]["done"] and not steps["students"]["done"]


def test_the_review_queue_lists_waiting_activity_submissions_across_subjects_oldest_first(db, graded):
    from helpers import Api
    activity = make_manual(graded, "activity", "Poster", points="10", category_key="activity")
    assert graded["fac"].get("/api/dashboard/faculty/review").json() == {"items": [], "total": 0}
    assert submit_pdf(graded["st1"], graded, activity).status_code in (200, 201)
    assert submit_pdf(graded["st2"], graded, activity).status_code in (200, 201)
    queue = graded["fac"].get("/api/dashboard/faculty/review").json()
    assert queue["total"] == 2 and [i["student"] for i in queue["items"]] == [graded["students"][0].display_name, graded["students"][1].display_name]
    first = queue["items"][0]
    assert first["title"] == "Poster" and first["link"].endswith(f"/assessments/{activity}/scores") and first["late"] is False
    assert first["subject"] and first["submitted_at"] <= queue["items"][1]["submitted_at"]
    assert score(graded, activity, graded["students"][0], 9).status_code == 200                    # graded work leaves the queue
    after = graded["fac"].get("/api/dashboard/faculty/review").json()
    assert [i["student"] for i in after["items"]] == [graded["students"][1].display_name]
    stranger = Api(make_account(db, "reviewer-other@example.com", "faculty").email)
    assert stranger.get("/api/dashboard/faculty/review").json() == {"items": [], "total": 0}      # never someone else's work
    assert graded["st1"].get("/api/dashboard/faculty/review").status_code == 403
    assert graded["admin"].get("/api/dashboard/faculty/review").status_code == 403
    from fastapi.testclient import TestClient

    from app.main import app
    assert TestClient(app).get("/api/dashboard/faculty/review").status_code == 401
    assert graded["admin"].post(f"/api/terms/{graded['term']['id']}/close").status_code in (200, 204)
    assert graded["fac"].get("/api/dashboard/faculty/review").json()["total"] == 0                 # a closed term has nothing to review
