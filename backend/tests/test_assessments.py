import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from helpers import POLICY, Api, publish_syllabus, uid
from sqlalchemy import func, select

from app.features.assessments.models import (
    AssessmentRevision,
    QuizAttempt,
    ResultPublication,
)
from app.main import app
from app.security import _limits


def a(c, path=""):
    return f"/api/teach/offerings/{c['oid']}/assessments{path}"


def la(c, path=""):
    return f"/api/learn/offerings/{c['oid']}{path}"


def iso(delta_hours):
    return (datetime.now(UTC) + timedelta(hours=delta_hours)).isoformat()


# ---------- builders ----------

def mc(prompt="Which is a legal structure?", correct=1, points=2):
    choices = [{"id": uid(), "text": t} for t in ("Idea", "Partnership", "Slogan", "Logo")]
    return {"key": uid(), "type": "multiple_choice", "prompt": prompt, "choices": choices,
            "correct": choices[correct]["id"], "explanation": "Private explanation", "points": points}


def tf(prompt="A sole proprietor has unlimited liability.", correct=True, points=1):
    return {"key": uid(), "type": "true_false", "prompt": prompt, "choices": [],
            "correct": correct, "explanation": "Private", "points": points}


def short(prompt="Name the simplest business form.", accepted=("Sole Proprietorship", "one-person firm"),
          points=2):
    return {"key": uid(), "type": "short_answer", "prompt": prompt, "choices": [],
            "correct": list(accepted), "explanation": "Private", "points": points}


def standard_questions():
    return [mc(), tf(), short()]


def correct_answers(questions):
    out = {}
    for q in questions:
        out[q["key"]] = (q["correct"] if q["type"] != "short_answer" else q["correct"][0])
    return out


def create(c, kind, title, **extra):
    response = c["fac"].post(a(c), {"kind": kind, "title": title, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def draft_fields(**over):
    base = {"title": "Quiz 1", "instructions": "Answer all.", "category_key": "quiz",
            "period": "midterm", "max_points": "0", "allow_late": False, "max_attempts": 1,
            "score_rule": "highest", "include_in_grade": True, "questions": []}
    return {**base, **over}


def save_draft(c, aid, **over):
    draft = c["fac"].get(a(c, f"/{aid}")).json()["draft"]
    body = {"expected_counter": draft["counter"], **draft_fields(**over)}
    return c["fac"].put(a(c, f"/{aid}/draft"), body)


def publish(c, aid, **over):
    saved = save_draft(c, aid, **over)
    assert saved.status_code == 200, saved.text
    return c["fac"].post(a(c, f"/{aid}/draft/publish"), {"expected_counter": saved.json()["counter"]})


def make_quiz(c, title="Quiz 1", questions=None, **over):
    questions = questions or standard_questions()
    aid = create(c, "online_quiz", title)["id"]
    done = publish(c, aid, title=title, questions=questions, **over)
    assert done.status_code == 200, done.text
    return {"aid": aid, "questions": questions, "correct": correct_answers(questions)}


def make_manual(c, kind, title, points="50", **over):
    aid = create(c, kind, title)["id"]
    fields = {"category_key": "exam" if kind == "exam" else "quiz", "max_points": points, **over}
    done = publish(c, aid, title=title, **fields)
    assert done.status_code == 200, done.text
    return aid


def start(st, c, aid):
    return st.post(la(c, f"/assessments/{aid}/attempts"))


def submit(st, c, attempt_id, answers=None):
    return st.post(la(c, f"/attempts/{attempt_id}/submit"),
                   {"idempotency_key": uid(), "answers": answers})


def teacher_attempt_count(db, aid):
    return db.scalar(select(func.count()).select_from(QuizAttempt)
                     .where(QuizAttempt.assessment_id == uuid.UUID(aid)))


def release_count(db, aid):
    return db.scalar(select(func.count()).select_from(ResultPublication)
                     .where(ResultPublication.assessment_id == uuid.UUID(aid)))


# ---------------- access ----------------

def test_assessment_api_roles(db, graded):
    from helpers import make_account
    stranger = Api(make_account(db, "other@example.com", "faculty").email)
    path = a(graded)
    assert stranger.get(path).status_code == 404
    assert stranger.post(path, {"kind": "manual", "title": "x"}).status_code == 404
    assert graded["st1"].get(path).status_code == 403
    assert graded["admin"].get(path).status_code == 403
    assert TestClient(app).get(path).status_code == 401
    assert graded["fac"].get(la(graded, "/assessments")).status_code == 403


# ---------------- definitions and publishing ----------------

def test_quiz_publish_needs_a_policy_and_a_complete_quiz(course):
    # no confirmed policy: graded work is refused with guidance
    publish_syllabus(course)                                         # syllabus without a policy
    aid = create(course, "online_quiz", "Quiz")["id"]
    refused = publish(course, aid, questions=standard_questions())
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "policy_missing"
    # a practice quiz (not counted) does not need one
    ok = publish(course, aid, include_in_grade=False, category_key=None, period=None,
                 questions=standard_questions())
    assert ok.status_code == 200


def test_quiz_validation_lists_what_is_missing(graded):
    aid = create(graded, "online_quiz", "Quiz")["id"]
    broken = [{**mc(), "prompt": " "}, {**mc(), "correct": "nope"}, {**tf(), "correct": None},
              {**short(), "correct": [" "]}, {**tf(), "points": "0"}]
    response = publish(graded, aid, questions=broken, category_key="nonsense", period=None)
    assert response.status_code == 422
    message = response.json()["error"]["message"]
    for needle in ("Question 1: write the question", "Question 2: mark exactly one correct",
                   "Question 3: mark True or False", "Question 4: add at least one accepted",
                   "Question 5: points must be above zero", "grading category", "grading period"):
        assert needle in message, needle
    assert publish(graded, aid, questions=[], period="midterm").status_code == 422


def test_published_quiz_total_and_student_never_sees_keys(graded):
    quiz = make_quiz(graded)
    view = graded["fac"].get(a(graded, f"/{quiz['aid']}")).json()
    assert view["published"]["max_points"] == 5.0
    assert view["published"]["questions"][0]["correct"]                    # faculty see keys
    st1 = graded["st1"]
    listing = st1.get(la(graded, "/assessments")).json()
    attempt = start(st1, graded, quiz["aid"]).json()
    reloaded = st1.get(la(graded, f"/attempts/{attempt['id']}")).json()
    submitted = submit(st1, graded, attempt["id"], quiz["correct"]).json()
    results = st1.get(la(graded, "/results")).json()
    for payload in (listing, attempt, reloaded, submitted, results):
        text = json.dumps(payload).lower()
        for secret in ("explanation", "private explanation", "one-person firm", '"correct"',
                       "accepted"):
            assert secret not in text, secret
    # the multiple-choice options are visible but carry no marker of the right one
    assert all(set(ch) == {"id", "text"} for ch in attempt["questions"][0]["choices"])


def test_drafts_are_invisible_and_tabs_cannot_overwrite_each_other(graded):
    aid = create(graded, "online_quiz", "Quiz")["id"]
    assert graded["st1"].get(la(graded, "/assessments")).json() == []
    draft = graded["fac"].get(a(graded, f"/{aid}")).json()["draft"]
    tab_b = Api("faculty@example.com")
    body = {"expected_counter": draft["counter"], **draft_fields(title="From tab A")}
    assert graded["fac"].put(a(graded, f"/{aid}/draft"), body).status_code == 200
    stale = tab_b.put(a(graded, f"/{aid}/draft"), {**body, "title": "From tab B"})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "draft_revision_conflict"


# ---------------- attempts ----------------

def test_attempt_lifecycle_scoring_and_immediate_release(db, graded):
    quiz = make_quiz(graded)
    st1, aid = graded["st1"], quiz["aid"]
    first = start(st1, graded, aid)
    assert first.status_code == 201
    attempt = first.json()
    # a page reload resumes the same attempt; answers are persisted on the server
    assert start(st1, graded, aid).json()["id"] == attempt["id"]
    keys = [q["key"] for q in quiz["questions"]]
    assert st1.put(la(graded, f"/attempts/{attempt['id']}/answers"),
                   {"answers": {keys[0]: quiz["correct"][keys[0]]}}).status_code == 200
    saved = st1.get(la(graded, f"/attempts/{attempt['id']}")).json()
    assert saved["answers"] == {keys[0]: quiz["correct"][keys[0]]} and "score" not in saved
    # a normalised short answer is accepted; the true/false is wrong on purpose
    answers = {keys[0]: quiz["correct"][keys[0]], keys[1]: False,
               keys[2]: "  SOLE   proprietorship "}
    result = submit(st1, graded, attempt["id"], answers)
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["state"] == "submitted" and body["score"] == 4.0 and body["max_score"] == 5.0
    # the total is released immediately
    shown = st1.get(la(graded, "/results")).json()["results"]
    assert [(r["title"], r["score"], r["max_points"]) for r in shown] == [("Quiz 1", 4.0, 5.0)]
    # submitting again is idempotent: same result, still one release
    again = submit(st1, graded, attempt["id"], {keys[1]: True})
    assert again.status_code == 200 and again.json()["score"] == 4.0
    assert release_count(db, aid) == 1
    # one attempt only by default
    exhausted = start(st1, graded, aid)
    assert exhausted.status_code == 409 and exhausted.json()["error"]["code"] == "attempts_exhausted"
    # another student's attempt is never reachable
    assert graded["st2"].get(la(graded, f"/attempts/{attempt['id']}")).status_code == 404


def test_multiple_attempts_use_the_configured_score_rule(graded):
    for rule, expected in (("highest", 5.0), ("latest", 1.0)):
        quiz = make_quiz(graded, title=f"Quiz {rule}", max_attempts=2, score_rule=rule)
        st1 = graded["st1"]
        first = start(st1, graded, quiz["aid"]).json()
        submit(st1, graded, first["id"], quiz["correct"])                       # 5/5
        second = start(st1, graded, quiz["aid"]).json()
        assert second["attempt_number"] == 2
        keys = [q["key"] for q in quiz["questions"]]
        submit(st1, graded, second["id"], {keys[1]: True})                      # 1/5
        shown = {r["title"]: r["score"] for r in st1.get(la(graded, "/results")).json()["results"]}
        assert shown[f"Quiz {rule}"] == expected, rule
        assert start(st1, graded, quiz["aid"]).status_code == 409                # both attempts used


def test_concurrent_starts_and_submits_never_create_extra_attempts_or_scores(db, graded):
    quiz = make_quiz(graded, max_attempts=3, score_rule="highest")
    aid = quiz["aid"]
    _limits.clear()
    sessions = [Api("s1@example.com") for _ in range(4)]
    with ThreadPoolExecutor(8) as pool:
        starts = list(pool.map(lambda i: start(sessions[i % 4], graded, aid), range(8)))
    assert all(r.status_code in (200, 201) for r in starts)
    assert len({r.json()["id"] for r in starts}) == 1                           # everyone resumed one attempt
    assert teacher_attempt_count(db, aid) == 1
    attempt_id = starts[0].json()["id"]
    with ThreadPoolExecutor(8) as pool:
        submits = list(pool.map(lambda i: submit(sessions[i % 4], graded, attempt_id,
                                                  quiz["correct"]), range(8)))
    assert all(r.status_code == 200 and r.json()["score"] == 5.0 for r in submits)
    assert release_count(db, aid) == 1                                          # scored and released once
    # after submitting, parallel starts still create exactly ONE new attempt
    with ThreadPoolExecutor(8) as pool:
        again = list(pool.map(lambda i: start(sessions[i % 4], graded, aid), range(8)))
    assert len({r.json()["id"] for r in again}) == 1
    assert teacher_attempt_count(db, aid) == 2


def test_availability_window_and_late_policy(db, graded):
    st1 = graded["st1"]
    future = make_quiz(graded, title="Opens later", available_from=iso(5), deadline=iso(10))
    early = start(st1, graded, future["aid"])
    assert early.status_code == 409 and early.json()["error"]["code"] == "not_open"
    # a deadline that has passed blocks new attempts unless late work is allowed
    quiz = make_quiz(graded, title="Due soon", deadline=iso(1))
    late = make_quiz(graded, title="Late ok", deadline=iso(1), allow_late=True)
    past = datetime.now(UTC) - timedelta(hours=2)
    for aid in (quiz["aid"], late["aid"]):
        rev = db.scalar(select(AssessmentRevision).where(
            AssessmentRevision.assessment_id == uuid.UUID(aid),
            AssessmentRevision.state == "published"))
        rev.deadline = past
    db.commit()
    closed = start(st1, graded, quiz["aid"])
    assert closed.status_code == 409 and closed.json()["error"]["code"] == "closed"
    assert start(st1, graded, late["aid"]).status_code == 201
    states = {i["title"]: i["state"] for i in st1.get(la(graded, "/assessments")).json()}
    assert states["Due soon"] == "closed" and states["Opens later"] == "not_open"


def test_expired_attempt_is_submitted_with_its_saved_answers(db, graded):
    quiz = make_quiz(graded, deadline=iso(1))
    st1 = graded["st1"]
    attempt = start(st1, graded, quiz["aid"]).json()
    key = quiz["questions"][0]["key"]
    st1.put(la(graded, f"/attempts/{attempt['id']}/answers"), {"answers": {key: quiz["correct"][key]}})
    rev = db.scalar(select(AssessmentRevision).where(
        AssessmentRevision.assessment_id == uuid.UUID(quiz["aid"]),
        AssessmentRevision.state == "published"))
    rev.deadline = datetime.now(UTC) - timedelta(minutes=5)
    db.commit()
    late_save = st1.put(la(graded, f"/attempts/{attempt['id']}/answers"), {"answers": {key: "x"}})
    assert late_save.status_code == 409 and late_save.json()["error"]["code"] == "attempt_closed"
    final = st1.get(la(graded, f"/attempts/{attempt['id']}")).json()
    assert final["state"] == "submitted" and final["score"] == 2.0           # only the saved answer counted


def test_answers_must_belong_to_the_quiz(graded):
    quiz = make_quiz(graded)
    attempt = start(graded["st1"], graded, quiz["aid"]).json()
    bad = graded["st1"].put(la(graded, f"/attempts/{attempt['id']}/answers"), {"answers": {uid(): "x"}})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "question_unknown"


# ---------------- answer keys freeze once attempts begin ----------------

def test_answer_keys_lock_after_attempts_but_wording_does_not(graded):
    quiz = make_quiz(graded, max_attempts=2)
    aid, fac = quiz["aid"], graded["fac"]
    attempt = start(graded["st1"], graded, aid).json()
    submit(graded["st1"], graded, attempt["id"], quiz["correct"])
    published = fac.get(a(graded, f"/{aid}")).json()["published"]
    fac.post(a(graded, f"/{aid}/draft"))
    # changing the correct answer is refused...
    changed = [{**q, "correct": (not q["correct"]) if q["type"] == "true_false" else q["correct"]}
               for q in published["questions"]]
    refused = publish(graded, aid, questions=changed, max_attempts=2, title="Quiz 1")
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "locked_after_attempts"
    # ...as is changing points or the attempt limit
    pts = [{**q, "points": "9"} if i == 0 else q for i, q in enumerate(published["questions"])]
    assert publish(graded, aid, questions=pts, max_attempts=2).status_code == 409
    assert publish(graded, aid, questions=published["questions"], max_attempts=3).status_code == 409
    # fixing wording and the deadline is fine, and keeps question identities
    typo = [{**q, "prompt": q["prompt"] + " (reworded)"} for q in published["questions"]]
    ok = publish(graded, aid, questions=typo, max_attempts=2, deadline=iso(48))
    assert ok.status_code == 200, ok.text
    new = fac.get(a(graded, f"/{aid}")).json()["published"]
    assert [q["key"] for q in new["questions"]] == [q["key"] for q in published["questions"]]
    assert new["version"] == 2
    # the second attempt is recorded against the new revision; scoring uses stable keys
    second = start(graded["st1"], graded, aid).json()
    assert "(reworded)" in second["questions"][0]["prompt"]


# ---------------- corrections and releases ----------------

def test_manual_correction_changes_working_score_but_not_what_students_see(db, graded):
    quiz = make_quiz(graded)
    st1, fac, aid = graded["st1"], graded["fac"], quiz["aid"]
    attempt = start(st1, graded, aid).json()
    keys = [q["key"] for q in quiz["questions"]]
    submit(st1, graded, attempt["id"], {keys[0]: quiz["correct"][keys[0]], keys[1]: True,
                                        keys[2]: "sole proprietor"})                 # near miss: 3/5
    assert st1.get(la(graded, "/results")).json()["results"][0]["score"] == 3.0
    path = a(graded, f"/{aid}/attempts/{attempt['id']}/answers/{keys[2]}")
    too_high = fac.put(path, {"awarded": "9", "reason": "Equivalent answer"})
    assert too_high.status_code == 422
    fixed = fac.put(path, {"awarded": "2", "reason": "Equivalent answer"})
    assert fixed.status_code == 200 and fixed.json()["score"] == 5.0
    # corrections are audited and never silently change the released result
    assert st1.get(la(graded, "/results")).json()["results"][0]["score"] == 3.0
    assert any(e["action"] == "attempt.corrected" for e in graded["admin"].get("/api/audit").json())
    assert fac.post(a(graded, f"/{aid}/release"), {"student_ids": None}).json() == {"released": 1}
    assert st1.get(la(graded, "/results")).json()["results"][0]["score"] == 5.0
    assert release_count(db, aid) == 2                                                # history is kept
    # releasing again with nothing new creates no extra release
    assert fac.post(a(graded, f"/{aid}/release"), {"student_ids": None}).json() == {"released": 0}


def test_online_quiz_scores_are_only_typed_in_for_no_shows(graded):
    quiz = make_quiz(graded)
    s1, s2 = graded["students"]
    attempt = start(graded["st1"], graded, quiz["aid"]).json()
    submit(graded["st1"], graded, attempt["id"], quiz["correct"])
    path = a(graded, f"/{quiz['aid']}/scores")
    refused = graded["fac"].put(f"{path}/{s1.id}", {"score": "5"})
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "use_correction"
    assert graded["fac"].put(f"{path}/{s2.id}", {"score": "0"}).status_code == 200      # never attempted


# ---------------- closed terms and withdrawn students ----------------

def test_closed_term_blocks_assessment_work_but_not_own_results(graded):
    quiz = make_quiz(graded)
    manual = make_manual(graded, "exam", "Midterm exam")
    st1, fac = graded["st1"], graded["fac"]
    attempt = start(st1, graded, quiz["aid"]).json()
    submit(st1, graded, attempt["id"], quiz["correct"])
    second = make_quiz(graded, title="Open attempt")
    open_attempt = start(st1, graded, second["aid"]).json()
    graded["admin"].post(f"/api/terms/{graded['term']['id']}/close")
    closed = lambda r: r.status_code == 409 and r.json()["error"]["code"] == "term_closed"
    assert closed(fac.post(a(graded), {"kind": "manual", "title": "x"}))
    assert closed(fac.put(a(graded, f"/{manual}/scores/{graded['students'][0].id}"), {"score": "10"}))
    assert closed(fac.post(a(graded, f"/{quiz['aid']}/release"), {"student_ids": None}))
    assert closed(start(st1, graded, second["aid"]))
    assert closed(st1.put(la(graded, f"/attempts/{open_attempt['id']}/answers"), {"answers": {}}))
    assert closed(submit(st1, graded, open_attempt["id"]))
    # reading is still fine for everyone involved
    assert st1.get(la(graded, "/results")).json()["results"][0]["score"] == 5.0
    assert fac.get(a(graded)).status_code == 200
    graded["admin"].post(f"/api/terms/{graded['term']['id']}/reopen", {"reason": "Correction"})
    assert start(st1, graded, second["aid"]).status_code in (200, 201)


def test_withdrawn_student_keeps_own_results_but_cannot_start_new_work(graded):
    quiz = make_quiz(graded)
    other = make_quiz(graded, title="Quiz 2")
    st1 = graded["st1"]
    attempt = start(st1, graded, quiz["aid"]).json()
    submit(st1, graded, attempt["id"], quiz["correct"])
    s1 = graded["students"][0]
    graded["admin"].delete(f"/api/sections/{graded['sec_a']['id']}/members/{s1.id}")
    assert start(st1, graded, other["aid"]).status_code == 404
    assert st1.get(la(graded, "/assessments")).status_code == 404
    kept = st1.get(la(graded, "/results"))
    assert kept.status_code == 200 and kept.json()["results"][0]["score"] == 5.0
    assert st1.get(la(graded, f"/attempts/{attempt['id']}")).status_code == 200


def test_policy_constants_are_what_the_grading_tests_assume():
    assert sum(c["weight"] for c in POLICY["categories"]) == 100
    assert sum(p["share"] for p in POLICY["periods"]) == 100


# ---------------- review findings: cross-offering attempts, no-shows, policy drift ----------------

def second_offering(c):
    """A second (open) term + offering for the same teacher, with s1 enrolled in it."""
    admin = c["admin"]
    year = admin.post("/api/school-years", {
        "label": "2027-2028", "start_date": "2027-06-01", "end_date": "2028-04-30",
        "terms": [{"name": "First Semester", "sequence": 1, "start_date": "2027-06-01",
                   "end_date": "2027-10-31"}]}).json()
    term = year["terms"][0]
    subject = admin.post("/api/subjects", {"code": "ENT 102", "title": "Another", "units": "3"}).json()
    section = admin.post(f"/api/terms/{term['id']}/sections", {"name": "2A", "year_level": 2}).json()
    offering = admin.post(f"/api/terms/{term['id']}/offerings", {
        "subject_id": subject["id"], "faculty_id": str(c["faculty"].id),
        "section_ids": [section["id"]], "placement_override_reason": "Test setup"})
    assert offering.status_code == 201, offering.text
    admin.post(f"/api/sections/{section['id']}/members", {"student_id": str(c["students"][0].id)})
    return offering.json()["id"]


def test_attempts_are_bound_to_their_own_offering(graded):
    other_offering = second_offering(graded)
    quiz = make_quiz(graded)
    st1 = graded["st1"]
    attempt = start(st1, graded, quiz["aid"]).json()
    graded["admin"].post(f"/api/terms/{graded['term']['id']}/close")          # attempt's term is now closed
    wrong = f"/api/learn/offerings/{other_offering}/attempts/{attempt['id']}"
    # the open second subject must not be usable to reach the first subject's attempt
    assert st1.get(wrong).status_code == 404
    assert st1.put(wrong + "/answers", {"answers": {}}).status_code == 404
    assert st1.post(wrong + "/submit", {"idempotency_key": uid() + "xx", "answers": None}).status_code == 404
    # through its own offering the closed term is enforced
    own = la(graded, f"/attempts/{attempt['id']}")
    refused = st1.post(own + "/submit", {"idempotency_key": uid(), "answers": None})
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "term_closed"


def test_no_shows_and_abandoned_attempts_can_be_resolved_by_faculty(db, graded):
    from test_activities import past as past_time
    from test_activities import score as record
    from test_activities import set_deadline
    from test_grading import book
    s1, s2 = graded["students"]
    quiz = make_quiz(graded, title="Skippable quiz", deadline=iso(1))
    aid, fac = quiz["aid"], graded["fac"]
    first_key = quiz["questions"][0]["key"]
    half = start(graded["st1"], graded, aid).json()                       # s1 starts and walks away
    graded["st1"].put(la(graded, f"/attempts/{half['id']}/answers"),
                      {"answers": {first_key: quiz["correct"][first_key]}})
    early = fac.post(a(graded, f"/{aid}/attempts/close-open"))            # s2 never attempts
    assert early.status_code == 409 and early.json()["error"]["code"] == "still_open"
    set_deadline(db, aid, past_time())
    rows, _ = book(graded)
    assert rows["s1"]["cells"][aid]["attempt_state"] == "in_progress"
    assert rows["s2"]["cells"][aid]["attempt_state"] == "not_attempted"
    quiz_status = lambda r: {c["key"]: c["status"] for c in r["grades"]["midterm"]["categories"]}["quiz"]
    assert quiz_status(rows["s1"]) == "pending" and quiz_status(rows["s2"]) == "pending"
    # a no-show gets an explicit (audited) score; an open attempt must be closed first
    assert record(graded, aid, s2, 0).status_code == 200
    blocked = record(graded, aid, s1, 3)
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "attempt_open"
    closed = fac.post(a(graded, f"/{aid}/attempts/close-open"))
    assert closed.status_code == 200 and closed.json() == {"closed": 1}
    assert fac.post(a(graded, f"/{aid}/attempts/close-open")).json() == {"closed": 0}   # idempotent
    rows, _ = book(graded)
    assert rows["s1"]["cells"][aid]["score"] == 2.0                                     # only the saved answer
    assert rows["s1"]["cells"][aid]["attempt_state"] == "submitted"
    assert rows["s2"]["cells"][aid]["score"] == 0.0 and rows["s2"]["cells"][aid]["attempt_state"] == "not_attempted"
    assert quiz_status(rows["s1"]) == "ok" and quiz_status(rows["s2"]) == "ok"          # no longer stuck
    # a submitted attempt is corrected, never overtyped
    over = record(graded, aid, s1, 5)
    assert over.status_code == 422 and over.json()["error"]["code"] == "use_correction"
    actions = [e["action"] for e in graded["admin"].get("/api/audit").json()]
    assert "attempts.closed" in actions and "score.recorded" in actions


def republish_policy(c, policy):
    fac = c["fac"]
    draft = fac.post(f"/api/teach/offerings/{c['oid']}/syllabus/draft").json()
    saved = fac.put(f"/api/teach/offerings/{c['oid']}/syllabus/draft", {
        "expected_counter": draft["counter"], "outline": draft["outline"], "grading_policy": policy}).json()
    return fac.post(f"/api/teach/offerings/{c['oid']}/syllabus/draft/publish",
                    {"expected_counter": saved["counter"]})


def test_a_policy_change_cannot_silently_drop_graded_work(graded):
    quiz = make_quiz(graded, title="Graded quiz")
    exam_f = make_manual(graded, "exam", "Final exam", "50", category_key="exam", period="finals")
    no_quiz = {**POLICY, "categories": [{"key": "activity", "label": "Activities", "weight": 30},
                                        {"key": "attendance", "label": "Attendance", "weight": 20},
                                        {"key": "exam", "label": "Examinations", "weight": 50}]}
    refused = republish_policy(graded, no_quiz)
    assert refused.status_code == 422 and "Graded quiz" in refused.json()["error"]["message"]
    only_midterm = {**POLICY, "periods": [{"key": "midterm", "label": "Midterm", "share": 100}]}
    refused = republish_policy(graded, only_midterm)
    assert refused.status_code == 422 and "Final exam" in refused.json()["error"]["message"]
    # archived work no longer counts, so the policy may change once it is archived
    graded["fac"].patch(a(graded, f"/{quiz['aid']}"), {"archived": True})
    assert exam_f
    renamed = {**POLICY, "categories": [{**c, "key": "quizzes"} if c["key"] == "quiz" else c
                                        for c in POLICY["categories"]]}
    assert republish_policy(graded, renamed).status_code == 200


def test_attendance_cannot_be_used_as_an_assessment_category(graded):
    aid = create(graded, "exam", "Odd one")["id"]
    refused = publish(graded, aid, category_key="attendance", max_points="10", period="midterm")
    assert refused.status_code == 422 and "attendance register" in refused.json()["error"]["message"].lower()


def test_scores_only_for_students_the_assessment_applies_to(graded):
    from test_activities import score as record
    s1, s2 = graded["students"]
    aid = make_manual(graded, "exam", "Section A exam", "50", category_key="exam")
    graded["fac"].patch(a(graded, f"/{aid}"), {"section_ids": [graded["sec_a"]["id"]]})
    assert record(graded, aid, s1, 40).status_code == 200
    outside = record(graded, aid, s2, 40)                                                 # s2 is in 1B
    assert outside.status_code == 422 and outside.json()["error"]["code"] == "student_invalid"


def test_simultaneous_grade_publications_do_not_collide(db, graded):
    from test_grading import full_term, publish_grades
    full_term(graded)
    _limits.clear()
    with ThreadPoolExecutor(4) as pool:
        replies = list(pool.map(lambda _: graded["fac"].post(
            f"/api/teach/offerings/{graded['oid']}/grades/publish", {"period": "midterm"}), range(4)))
    assert all(r.status_code == 200 for r in replies), [r.text for r in replies]
    assert sorted(r.json()["published"] for r in replies) == [0, 0, 0, 1]                 # released exactly once
    assert publish_grades(graded, "midterm")["unchanged"] == 1


def test_submitting_after_the_deadline_tells_the_student_which_answers_counted(db, graded):
    quiz = make_quiz(graded, deadline=iso(1))
    st1, aid = graded["st1"], quiz["aid"]
    attempt = start(st1, graded, aid).json()
    key = quiz["questions"][0]["key"]
    st1.put(la(graded, f"/attempts/{attempt['id']}/answers"), {"answers": {key: quiz["correct"][key]}})
    rev = db.scalar(select(AssessmentRevision).where(
        AssessmentRevision.assessment_id == uuid.UUID(aid), AssessmentRevision.state == "published"))
    rev.deadline = datetime.now(UTC) - timedelta(minutes=5)
    db.commit()
    late = submit(st1, graded, attempt["id"], quiz["correct"])                  # all answers, sent too late
    assert late.status_code == 200
    assert late.json()["score"] == 2.0 and late.json()["answers_ignored"] is True


# ---------------- unpublish ----------------

def test_an_untouched_assessment_can_be_unpublished_back_to_a_draft_and_republished(graded):
    quiz = make_quiz(graded)
    path = a(graded, f"/{quiz['aid']}/unpublish")
    assert graded["st1"].post(path).status_code == 403
    view = graded["fac"].post(path).json()
    assert view["published"] is None and view["draft"]["title"] == "Quiz 1" and len(view["draft"]["questions"]) == len(quiz["questions"])
    assert graded["st1"].get(la(graded, "/assessments")).json() == []                   # students no longer see it
    again = graded["fac"].post(path)
    assert again.status_code == 409 and again.json()["error"]["code"] == "not_published"
    republished = graded["fac"].post(a(graded, f"/{quiz['aid']}/draft/publish"), {"expected_counter": view["draft"]["counter"]})
    assert republished.status_code == 200 and republished.json()["published"]["version"] == 2
    assert [r["title"] for r in graded["st1"].get(la(graded, "/assessments")).json()] == ["Quiz 1"]


def test_unpublish_keeps_a_newer_draft_the_teacher_was_editing(graded):
    quiz = make_quiz(graded)
    graded["fac"].post(a(graded, f"/{quiz['aid']}/draft"))
    draft = graded["fac"].get(a(graded, f"/{quiz['aid']}")).json()["draft"]
    body = {"expected_counter": draft["counter"], **draft_fields(title="Edited title", questions=quiz["questions"])}
    assert graded["fac"].put(a(graded, f"/{quiz['aid']}/draft"), body).status_code == 200
    view = graded["fac"].post(a(graded, f"/{quiz['aid']}/unpublish")).json()
    assert view["published"] is None and view["draft"]["title"] == "Edited title"


def test_an_assessment_with_attempts_scores_or_a_released_result_cannot_be_unpublished(db, graded):
    quiz = make_quiz(graded)
    assert graded["fac"].get(a(graded, f"/{quiz['aid']}")).json()["can_unpublish"] is True
    attempt = start(graded["st1"], graded, quiz["aid"]).json()
    assert graded["fac"].get(a(graded, f"/{quiz['aid']}")).json()["can_unpublish"] is False     # the page hides the button
    refused = graded["fac"].post(a(graded, f"/{quiz['aid']}/unpublish"))
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "has_history"
    submit(graded["st1"], graded, attempt["id"], quiz["correct"])
    assert graded["fac"].post(a(graded, f"/{quiz['aid']}/unpublish")).status_code == 409
    exam = make_manual(graded, "exam", "Final exam")
    student = graded["students"][0]
    assert graded["fac"].put(a(graded, f"/{exam}/scores/{student.id}"), {"score": "40"}).status_code in (200, 204)
    assert graded["fac"].post(a(graded, f"/{exam}/unpublish")).status_code == 409
    assert graded["fac"].get(a(graded, f"/{exam}")).json()["published"] is not None      # nothing changed
