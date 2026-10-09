import uuid
from datetime import UTC, datetime, timedelta

from helpers import Api, learn, make_account, t
from sqlalchemy import func, select
from test_activities import set_deadline, submit_pdf
from test_assessments import iso, make_manual, make_quiz, start, submit
from test_study import ai, lesson  # noqa: F401

from app.features.assessments.models import QuizAttempt
from app.features.study import progress
from app.features.study.models import LearningEvent

BODY = "<p>Business forms and their owners.</p>"


def mine(c, who="st1"):
    response = c[who].get(learn(c, "/progress"))
    assert response.status_code == 200, response.text
    return response.json()


def events(db, student=None):
    query = select(func.count()).select_from(LearningEvent)
    if student is not None:
        query = query.where(LearningEvent.student_id == student.id)
    return db.scalar(query)


def complete(c, item, who="st1"):
    return c[who].post(learn(c, f"/lessons/{item}/complete"))


def test_only_deliberate_actions_become_progress(db, graded):
    item = lesson(graded, "Forms", BODY)
    quiz = make_quiz(graded)
    st1, s1 = graded["st1"], graded["students"][0]
    # reading, listing, opening the quiz, asking the AI and downloading are not progress
    st1.get(learn(graded, "/items"))
    st1.get(learn(graded, f"/items/{item}"))
    attempt = start(st1, graded, quiz["aid"]).json()
    assert events(db) == 0 and mine(graded)["done"] == 0
    st1.put(learn(graded, f"/attempts/{attempt['id']}/answers"), {"answers": quiz["correct"]})
    assert events(db) == 0                                              # saving answers is not submitting
    assert complete(graded, item).status_code == 200
    assert submit(st1, graded, attempt["id"], quiz["correct"]).status_code == 200
    assert events(db, s1) == 2
    view = mine(graded)
    assert (view["total"], view["done"], view["percent"]) == (2, 2, 100)
    assert {s["type"] for s in view["steps"]} == {"lesson_completed", "quiz_submitted"}


def test_retries_never_inflate_progress(db, graded):
    item = lesson(graded, "Forms", BODY)
    quiz = make_quiz(graded)
    for _ in range(3):
        assert complete(graded, item).status_code == 200
    attempt = start(graded["st1"], graded, quiz["aid"]).json()
    for _ in range(3):
        assert submit(graded["st1"], graded, attempt["id"], quiz["correct"]).status_code == 200
    assert events(db) == 2
    assert db.scalar(select(func.count()).select_from(progress.LessonCompletion)) == 1


def test_expiry_and_faculty_closing_are_not_student_submissions(db, graded):
    quiz = make_quiz(graded, deadline=iso(1))
    st1, s1 = graded["st1"], graded["students"][0]
    attempt = start(st1, graded, quiz["aid"]).json()
    set_deadline(db, quiz["aid"], datetime.now(UTC) - timedelta(minutes=5))
    st1.put(learn(graded, f"/attempts/{attempt['id']}/answers"), {"answers": {}})   # expires it by touch
    assert db.get(QuizAttempt, uuid.UUID(attempt["id"])).state == "submitted"
    assert events(db, s1) == 0
    other = make_quiz(graded, title="Quiz 2", deadline=iso(1))
    open_attempt = start(graded["st2"], graded, other["aid"]).json()
    set_deadline(db, other["aid"], datetime.now(UTC) - timedelta(minutes=5))
    assert graded["fac"].post(f"/api/teach/offerings/{graded['oid']}/assessments/{other['aid']}"
                              "/attempts/close-open").json() == {"closed": 1}
    assert db.get(QuizAttempt, uuid.UUID(open_attempt["id"])).state == "submitted"
    assert events(db) == 0 and mine(graded, "st2")["done"] == 0


def test_each_activity_version_is_an_event_but_one_step(db, graded):
    aid = make_manual(graded, "activity", "Plan", points="20", category_key="activity")
    assert submit_pdf(graded["st1"], graded, aid).status_code in (200, 201)
    assert submit_pdf(graded["st1"], graded, aid, note="v2").status_code in (200, 201)
    view = mine(graded)
    assert events(db, graded["students"][0]) == 2                      # a distinct event per version
    assert (view["total"], view["done"]) == (1, 1) and view["events_total"] == 2


def test_lessons_only_and_only_what_the_student_can_see(db, graded):
    from test_teaching import new_item
    draft = new_item(graded, "lesson", "Not published")["id"]
    file_item = new_item(graded, "reference", "Link")["id"]
    elsewhere = lesson(graded, "Only 1B", BODY, section_ids=[graded["sec_b"]["id"]])
    assert complete(graded, draft).status_code == 404
    assert complete(graded, elsewhere).status_code == 404               # targeted at the other section
    assert complete(graded, file_item).status_code == 404               # unpublished first
    assert complete(graded, str(uuid.uuid4())).status_code == 404
    assert complete(graded, elsewhere, "st2").status_code == 200
    assert events(db) == 1
    # once published, a link is a step like a lesson (see the files-and-links tests below)
    from test_study import edit_and_publish
    edit_and_publish(graded, file_item, title="Link", reference_url="https://example.org/x")
    assert complete(graded, file_item).status_code == 200


def test_denominator_follows_what_applies_and_the_change_is_explained(db, graded):
    keep = lesson(graded, "Keep", BODY)
    drop = lesson(graded, "Drop", BODY)
    complete(graded, drop)
    before = mine(graded)
    assert (before["total"], before["done"], before["percent"], before["note"]) == (2, 1, 50, "")
    graded["fac"].patch(t(graded, f"/items/{drop}"), {"archived": True})      # the completed one goes away
    after = mine(graded)
    assert (after["total"], after["done"], after["percent"]) == (1, 0, 0)
    assert after["outside_count"] == 1 and "no longer count" in after["note"]
    assert [s["id"] for s in after["steps"]] == [keep]
    assert events(db) == 1                                               # history is kept


def test_nothing_to_do_is_not_zero_percent(graded):
    view = mine(graded)
    assert view["total"] == 0 and view["percent"] is None


def test_days_and_weeks_use_manila_time_and_monday_weeks(db):
    manila = progress.ZoneInfo("Asia/Manila")
    # 2026-10-04 23:30 UTC is already Monday 2026-10-05 07:30 in Manila; 2026-10-04 15:00 UTC is
    # Sunday 23:00 in Manila (still the previous week)
    monday_morning = datetime(2026, 10, 4, 23, 30, tzinfo=UTC)
    sunday_night = datetime(2026, 10, 4, 15, 0, tzinfo=UTC)
    assert monday_morning.astimezone(manila).date().isoformat() == "2026-10-05"
    today = datetime(2026, 10, 7, 12, 0, tzinfo=manila).date()                       # a Wednesday
    days, weeks = progress.buckets([monday_morning, sunday_night, sunday_night], today)
    by_day = {d["date"]: d["count"] for d in days}
    assert by_day["2026-10-05"] == 1 and by_day["2026-10-04"] == 2 and len(days) == 14
    by_week = {w["week_start"]: w["count"] for w in weeks}
    assert by_week["2026-10-05"] == 1 and by_week["2026-09-28"] == 2 and len(weeks) == 8
    assert all(datetime.fromisoformat(w["week_start"]).weekday() == 0 for w in weeks)
    old = datetime(2026, 1, 1, tzinfo=UTC)
    assert sum(d["count"] for d in progress.buckets([old], today)[0]) == 0           # outside the window


def test_withdrawn_students_get_no_new_events_and_no_progress_page(db, graded):
    item = lesson(graded, "Forms", BODY)
    s1 = graded["students"][0]
    graded["admin"].delete(f"/api/sections/{graded['sec_a']['id']}/members/{s1.id}?reason=Left%20the%20programme")
    assert complete(graded, item).status_code == 404
    assert graded["st1"].get(learn(graded, "/progress")).status_code == 404
    assert events(db) == 0


def test_closed_terms_accept_no_new_progress(db, graded):
    item = lesson(graded, "Forms", BODY)
    graded["admin"].post(f"/api/terms/{graded['term']['id']}/close")
    refused = complete(graded, item)
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "term_closed"
    assert mine(graded)["total"] == 1                                      # still readable


def test_faculty_see_counts_for_their_own_class_and_never_chats(db, graded, ai):  # noqa: F811
    item = lesson(graded, "Forms", BODY)
    lesson(graded, "Second", BODY)
    complete(graded, item)
    ai.answer = "Secret study answer [S1]."
    cid = graded["st1"].post(learn(graded, "/study/conversations")).json()["id"]
    graded["st1"].post(learn(graded, f"/study/conversations/{cid}/messages"), {
        "text": "my private question about forms", "client_message_id": "private-msg-0001"})
    page = graded["fac"].get(t(graded, "/progress"))
    assert page.status_code == 200
    body = page.json()
    rows = {r["student"]: r for r in body["students"]}
    assert rows["s1"]["done"] == 1 and rows["s1"]["total"] == 2 and rows["s1"]["percent"] == 50
    assert rows["s2"]["done"] == 0 and rows["s2"]["inactive"] is True and body["average_percent"] == 25
    assert "private question" not in page.text and "Secret study answer" not in page.text
    stranger = Api(make_account(db, "other@example.com", "faculty").email)
    assert stranger.get(t(graded, "/progress")).status_code == 404
    assert graded["st1"].get(t(graded, "/progress")).status_code == 403
    assert graded["admin"].get(t(graded, "/progress")).status_code == 403
    graded["admin"].post(f"/api/terms/{graded['term']['id']}/close")
    assert graded["fac"].get(t(graded, "/progress")).status_code == 200      # readable after the term closes


def test_a_submit_the_deadline_rejected_earns_no_progress(db, graded):
    quiz = make_quiz(graded, deadline=iso(1))
    st1, s1 = graded["st1"], graded["students"][0]
    attempt = start(st1, graded, quiz["aid"]).json()
    set_deadline(db, quiz["aid"], datetime.now(UTC) - timedelta(minutes=5))
    late = submit(st1, graded, attempt["id"], quiz["correct"])
    assert late.status_code == 200 and late.json()["answers_ignored"] is True      # kept as attempt history
    assert db.get(QuizAttempt, uuid.UUID(attempt["id"])).state == "submitted"
    assert events(db, s1) == 0 and mine(graded)["done"] == 0


# ---------------- files and links are steps too ----------------

def publish_link(c, title="Reading link"):
    from test_study import edit_and_publish
    from test_teaching import new_item
    item = new_item(c, "reference", title)["id"]
    done = edit_and_publish(c, item, title=title, reference_url="https://example.org/read", reference_note="Skim section 2")
    assert done.status_code == 200
    return item


def publish_file(c, title="Reading file"):
    from test_study import file_item
    return file_item(c, "reading.pdf", b"%PDF-1.4 test", title=title)


def test_a_link_and_a_file_can_be_marked_done_once_and_count_as_steps(db, graded):
    item = lesson(graded, "Forms", BODY)
    link, doc = publish_link(graded), publish_file(graded)
    before = mine(graded)
    assert before["total"] == 3 and before["done"] == 0
    assert {str(s["id"]) for s in before["steps"]} == {str(item), str(link), str(doc)}
    for _ in range(3):
        assert complete(graded, link).status_code == 200                          # retries never inflate
    assert complete(graded, doc).status_code == 200
    after = mine(graded)
    assert (after["total"], after["done"], after["percent"]) == (3, 2, 67)
    assert events(db, graded["students"][0]) == 2
    listing = {str(i["id"]): i for i in graded["st1"].get(learn(graded, "/items")).json()}
    assert listing[str(link)]["completed"] is True and listing[str(doc)]["completed"] is True
    assert listing[str(item)]["completed"] is False
    assert [i for i, v in listing.items() if v["up_next"]] == [str(item)]            # the one thing still open


def test_up_next_and_next_lesson_run_through_files_and_links(graded):
    first = lesson(graded, "First", BODY)
    link = publish_link(graded)
    doc = publish_file(graded)
    st1 = graded["st1"]
    up = [str(i["id"]) for i in st1.get(learn(graded, "/items")).json() if i["up_next"]]
    assert up == [str(first)]
    assert complete(graded, first).status_code == 200
    page = st1.get(learn(graded, f"/items/{first}")).json()
    assert str(page["next_lesson"]["id"]) == str(link) and page["lesson_total"] == 3 and page["all_completed"] is False
    assert [str(i["id"]) for i in st1.get(learn(graded, "/items")).json() if i["up_next"]] == [str(link)]
    assert complete(graded, link).status_code == 200 and complete(graded, doc).status_code == 200
    last = st1.get(learn(graded, f"/items/{doc}")).json()
    assert last["completed"] is True and last["next_lesson"] is None and last["all_completed"] is True
    assert not [i for i in st1.get(learn(graded, "/items")).json() if i["up_next"]]


def test_completing_a_file_or_link_follows_the_same_access_rules_as_a_lesson(db, graded):
    link = publish_link(graded)
    from test_teaching import new_item
    draft_only = new_item(graded, "reference", "Draft link")["id"]
    assert complete(graded, draft_only).status_code == 404
    assert graded["fac"].post(learn(graded, f"/lessons/{link}/complete")).status_code == 403
    s1 = graded["students"][0]
    graded["admin"].delete(f"/api/sections/{graded['sec_a']['id']}/members/{s1.id}?reason=Left%20the%20programme")
    assert complete(graded, link).status_code == 404                              # withdrawn: nothing new
