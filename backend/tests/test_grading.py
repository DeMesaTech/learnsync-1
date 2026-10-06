import json

from helpers import POLICY, publish_syllabus
from test_activities import score
from test_assessments import a, la, make_manual, make_quiz, start, submit


def g(c, path=""):
    return f"/api/teach/offerings/{c['oid']}{path}"


def book(c):
    response = c["fac"].get(g(c, "/gradebook"))
    assert response.status_code == 200, response.text
    return {r["display_name"]: r for r in response.json()["rows"]}, response.json()


def attend(c, section, day, period, marks):
    response = c["fac"].put(g(c, "/attendance"), {
        "section_id": section["id"], "session_date": day, "period": period,
        "marks": {str(s.id): status for s, status in marks}})
    assert response.status_code == 204, response.text


def publish_grades(c, period, students=None):
    response = c["fac"].post(g(c, "/grades/publish"), {"period": period, "student_ids": students})
    assert response.status_code == 200, response.text
    return response.json()


def with_policy(course, policy):
    publish_syllabus(course, policy=policy)
    return course


def one_category_policy(key="quiz", transmutation="raw"):
    return {"categories": [{"key": key, "label": "Quizzes", "weight": 100}],
            "periods": [{"key": "midterm", "label": "Midterm", "share": 50},
                        {"key": "finals", "label": "Finals", "share": 50}],
            "transmutation": transmutation, "passing": 75, "late_attendance_fraction": 0.5}


def full_term(c):
    """Hand-computed scenario for s1 under POLICY (quiz 20, activity 20, attendance 10, exam 50).

    Midterm: quiz 4/5=80, activity 18/20=90, attendance (3 present + 1 late@0.5)/5=70, exam 40/50=80
             -> 80*.2 + 90*.2 + 70*.1 + 80*.5 = 81.00
    Finals:  quiz 9/10=90, activity 20/20=100, attendance (present, excused)=100, exam 45/50=90
             -> 90*.2 + 100*.2 + 100*.1 + 90*.5 = 93.00        Course: 81*.5 + 93*.5 = 87.00"""
    s1 = c["students"][0]
    quiz = make_quiz(c, title="Quiz M1")
    keys = [q["key"] for q in quiz["questions"]]
    attempt = start(c["st1"], c, quiz["aid"]).json()
    submit(c["st1"], c, attempt["id"], {keys[0]: quiz["correct"][keys[0]], keys[1]: False,
                                       keys[2]: quiz["correct"][keys[2]]})            # 4 of 5
    act_m = make_manual(c, "activity", "Activity M", "20", category_key="activity")
    exam_m = make_manual(c, "exam", "Midterm exam", "50", category_key="exam")
    quiz_f = make_manual(c, "offline_quiz", "Quiz F", "10", category_key="quiz", period="finals")
    act_f = make_manual(c, "activity", "Activity F", "20", category_key="activity", period="finals")
    exam_f = make_manual(c, "exam", "Final exam", "50", category_key="exam", period="finals")
    for aid, value in ((act_m, 18), (exam_m, 40), (quiz_f, 9), (act_f, 20), (exam_f, 45)):
        assert score(c, aid, s1, value).status_code == 200
    for n, status in enumerate(["present", "present", "present", "late", "absent"], start=1):
        attend(c, c["sec_a"], f"2026-07-0{n}", "midterm", [(s1, status)])
    attend(c, c["sec_a"], "2026-09-01", "finals", [(s1, "present")])
    attend(c, c["sec_a"], "2026-09-02", "finals", [(s1, "excused")])
    return {"quiz": quiz, "act_m": act_m, "exam_m": exam_m, "quiz_f": quiz_f, "act_f": act_f,
            "exam_f": exam_f}


# ---------------- the calculation ----------------

def test_period_and_course_grades_match_the_hand_calculation(graded):
    full_term(graded)
    rows, data = book(graded)
    grades = rows["s1"]["grades"]
    assert grades["midterm"]["grade"] == 81.0 and grades["finals"]["grade"] == 93.0
    assert grades["course"]["grade"] == 87.0
    mid = {c["key"]: c for c in grades["midterm"]["categories"]}
    assert (mid["quiz"]["percent"], mid["activity"]["percent"], mid["attendance"]["percent"],
            mid["exam"]["percent"]) == (80.0, 90.0, 70.0, 80.0)
    assert data["policy_version"] == 1 and rows["s1"]["section"] == "1A"
    # s2 has nothing recorded: pending with reasons, never zero
    other = rows["s2"]["grades"]
    assert other["midterm"]["grade"] is None and other["course"]["grade"] is None
    assert any("Attendance" in r for r in other["midterm"]["pending"])


def test_missing_scores_are_pending_but_an_explicit_zero_counts(graded):
    ids = full_term(graded)
    s1 = graded["students"][0]
    assert score(graded, ids["exam_m"], s1, None).status_code == 200                 # score removed
    midterm = book(graded)[0]["s1"]["grades"]["midterm"]
    assert midterm["grade"] is None and any("Midterm exam" in r for r in midterm["pending"])
    assert score(graded, ids["exam_m"], s1, 0).status_code == 200                    # an explicit zero
    midterm = book(graded)[0]["s1"]["grades"]["midterm"]
    assert midterm["grade"] == 41.0                                                  # 16 + 18 + 7 + 0


def test_unmarked_attendance_is_pending_and_all_excused_is_not_a_grade(graded):
    s1 = graded["students"][0]
    full_term(graded)
    attend(graded, graded["sec_a"], "2026-07-09", "midterm", [])                     # a day with no marks yet
    assert book(graded)[0]["s1"]["grades"]["midterm"]["grade"] is None
    # remove the unmarked day, then excuse every remaining midterm day
    sessions = graded["fac"].get(g(graded, f"/attendance?section_id={graded['sec_a']['id']}")).json()
    for s in sessions["sessions"]:
        if s["period"] == "midterm":
            graded["fac"].delete(g(graded, f"/attendance/{s['id']}"))
    for n in range(1, 4):
        attend(graded, graded["sec_a"], f"2026-07-1{n}", "midterm", [(s1, "excused")])
    midterm = book(graded)[0]["s1"]["grades"]["midterm"]
    assert midterm["grade"] is None
    assert any("excused" in r.lower() for r in midterm["pending"])


def test_zero_weight_categories_never_block_a_grade(course):
    policy = {"categories": [{"key": "quiz", "label": "Quizzes", "weight": 100},
                             {"key": "activity", "label": "Activities", "weight": 0}],
              "periods": [{"key": "midterm", "label": "Midterm", "share": 100}],
              "transmutation": "raw", "passing": 75}
    with_policy(course, policy)
    s1 = course["students"][0]
    aid = make_manual(course, "offline_quiz", "Q", "10", category_key="quiz")
    assert score(course, aid, s1, 8).status_code == 200
    midterm = book(course)[0]["s1"]["grades"]["midterm"]
    assert midterm["grade"] == 80.0                  # the empty zero-weight Activities category is ignored


def test_transmutation_and_rounding_follow_the_plan(course):
    s1 = course["students"][0]
    with_policy(course, one_category_policy(transmutation="transmuted"))
    aid = make_manual(course, "offline_quiz", "Q", "3", category_key="quiz")
    score(course, aid, s1, 2)                                                        # raw 66.666...
    midterm = book(course)[0]["s1"]["grades"]["midterm"]
    assert midterm["grade"] == 83.33                                                  # 50 + 66.666/2
    assert midterm["categories"][0]["raw_percent"] == 66.67


def test_course_grade_uses_the_rounded_period_grades(course):
    s1 = course["students"][0]
    with_policy(course, one_category_policy())
    mid = make_manual(course, "offline_quiz", "Mid", "3", category_key="quiz")
    fin = make_manual(course, "offline_quiz", "Fin", "10", category_key="quiz", period="finals")
    score(course, mid, s1, 2)                                                         # 66.666... -> 66.67
    score(course, fin, s1, 1)                                                         # 10.00
    grades = book(course)[0]["s1"]["grades"]
    assert grades["midterm"]["grade"] == 66.67 and grades["finals"]["grade"] == 10.0
    # (66.67*50 + 10*50)/100 = 38.335 -> 38.34; unrounded periods would give 38.33
    assert grades["course"]["grade"] == 38.34


def test_gradebook_needs_a_confirmed_complete_policy(course):
    publish_syllabus(course)                                                          # no policy at all
    missing = course["fac"].get(g(course, "/gradebook"))
    assert missing.status_code == 422 and missing.json()["error"]["code"] == "policy_missing"
    only_categories = {"categories": [{"key": "quiz", "label": "Q", "weight": 100}]}
    publish_syllabus(course, policy=only_categories)
    incomplete = course["fac"].get(g(course, "/gradebook"))
    assert incomplete.status_code == 422 and incomplete.json()["error"]["code"] == "policy_incomplete"


# ---------------- attendance ----------------

def test_attendance_rules(graded):
    s1, s2 = graded["students"]
    section = graded["sec_a"]
    # a student can only be marked in the section they are enrolled through
    stray = graded["fac"].put(g(graded, "/attendance"), {
        "section_id": section["id"], "session_date": "2026-07-01", "period": "midterm",
        "marks": {str(s2.id): "present"}})
    assert stray.status_code == 422 and stray.json()["error"]["code"] == "student_invalid"
    attend(graded, section, "2026-07-01", "midterm", [(s1, "present")])
    locked = graded["fac"].put(g(graded, "/attendance"), {
        "section_id": section["id"], "session_date": "2026-07-01", "period": "finals", "marks": {}})
    assert locked.status_code == 409 and locked.json()["error"]["code"] == "period_locked"
    attend(graded, section, "2026-07-01", "midterm", [(s1, "absent")])                 # a correction
    listing = graded["fac"].get(g(graded, f"/attendance?section_id={section['id']}")).json()
    assert listing["sessions"][0]["marks"] == {str(s1.id): "absent"}
    assert [r["display_name"] for r in listing["roster"]] == ["s1"]
    unlinked = graded["fac"].put(g(graded, "/attendance"), {
        "section_id": "00000000-0000-0000-0000-000000000000", "session_date": "2026-07-02",
        "period": "midterm", "marks": {}})
    assert unlinked.status_code == 422


# ---------------- publication, review flags, and independence ----------------

def test_grade_publication_review_flags_and_republication(graded):
    ids = full_term(graded)
    s1 = graded["students"][0]
    st1 = graded["st1"]
    first = publish_grades(graded, "midterm")
    assert first["published"] == 1 and [p["student"] for p in first["pending"]] == ["s2"]
    assert publish_grades(graded, "midterm")["unchanged"] == 1                          # nothing new to release
    mine = st1.get(la(graded, "/results")).json()["grades"]
    assert [(x["period"], x["grade"], x["remark"], x["release_number"]) for x in mine] == \
        [("midterm", 81.0, "passed", 1)]
    # changing working data flags the published grade but never touches what the student sees
    assert score(graded, ids["exam_m"], s1, 44).status_code == 200
    rows, _ = book(graded)
    flagged = rows["s1"]["published"]["midterm"]
    assert flagged["needs_review"] is True and flagged["grade"] == 81.0 and flagged["release_number"] == 1
    assert rows["s1"]["grades"]["midterm"]["grade"] == 85.0   # 16 + 18 + 7 + 88*.5                              # new working value
    assert st1.get(la(graded, "/results")).json()["grades"][0]["grade"] == 81.0         # student unchanged
    # explicit republication appends release 2 and clears the flag
    assert publish_grades(graded, "midterm")["published"] == 1
    rows, _ = book(graded)
    assert rows["s1"]["published"]["midterm"] == {"grade": 85.0, "release_number": 2,
                                                  "needs_review": False, "review_reason": None}
    assert st1.get(la(graded, "/results")).json()["grades"][0]["release_number"] == 2


def test_course_grade_publishes_separately_and_is_flagged_with_its_periods(graded):
    ids = full_term(graded)
    s1 = graded["students"][0]
    publish_grades(graded, "midterm")
    publish_grades(graded, "finals")
    assert publish_grades(graded, "course")["published"] == 1
    got = {x["period"]: x["grade"] for x in graded["st1"].get(la(graded, "/results")).json()["grades"]}
    assert got == {"midterm": 81.0, "finals": 93.0, "course": 87.0}
    score(graded, ids["exam_f"], s1, 50)                                                  # finals change
    published = book(graded)[0]["s1"]["published"]
    assert published["finals"]["needs_review"] and published["course"]["needs_review"]
    assert not published["midterm"]["needs_review"]                                       # midterm untouched


def test_result_release_and_grade_publication_are_independent(graded):
    ids = full_term(graded)
    st1, fac = graded["st1"], graded["fac"]
    publish_grades(graded, "midterm")
    seen = st1.get(la(graded, "/results")).json()
    assert seen["grades"][0]["grade"] == 81.0
    # the online quiz total was released at once; faculty-scored items are NOT released by grading
    assert [r["title"] for r in seen["results"]] == ["Quiz M1"]
    fac.post(a(graded, f"/{ids['exam_m']}/release"), {"student_ids": None})
    assert sorted(r["title"] for r in st1.get(la(graded, "/results")).json()["results"]) == \
        ["Midterm exam", "Quiz M1"]
    # releasing a result does not publish or alter any grade
    assert [x["release_number"] for x in st1.get(la(graded, "/results")).json()["grades"]] == [1]


def test_students_only_receive_grade_and_remark(graded):
    full_term(graded)
    publish_grades(graded, "midterm")
    payload = graded["st1"].get(la(graded, "/results")).json()
    assert set(payload["grades"][0]) == {"period", "grade", "remark", "release_number", "published_at"}
    text = json.dumps(payload).lower()
    assert "snapshot" not in text and "categories" not in text and "needs_review" not in text
    assert graded["st2"].get(la(graded, "/results")).json() == {"results": [], "grades": []}


def test_failing_remark_follows_the_passing_grade(course):
    with_policy(course, one_category_policy())
    s1 = course["students"][0]
    mid = make_manual(course, "offline_quiz", "Mid", "10", category_key="quiz")
    fin = make_manual(course, "offline_quiz", "Fin", "10", category_key="quiz", period="finals")
    score(course, mid, s1, 7)
    score(course, fin, s1, 7)
    publish_grades(course, "course")
    grade = course["st1"].get(la(course, "/results")).json()["grades"][0]
    assert (grade["grade"], grade["remark"]) == (70.0, "failed")


def test_changing_the_grading_policy_flags_published_grades(graded):
    full_term(graded)
    publish_grades(graded, "midterm")
    assert not book(graded)[0]["s1"]["published"]["midterm"]["needs_review"]
    new_policy = {**POLICY, "passing": 80}
    publish_syllabus(graded, policy=new_policy)
    flagged = book(graded)[0]["s1"]["published"]["midterm"]
    assert flagged["needs_review"] and "policy" in flagged["review_reason"].lower()


def test_changing_assessment_settings_flags_grades(graded):
    ids = full_term(graded)
    publish_grades(graded, "midterm")
    fac = graded["fac"]
    fac.post(a(graded, f"/{ids['exam_m']}/draft"))
    draft = fac.get(a(graded, f"/{ids['exam_m']}")).json()["draft"]
    body = {"expected_counter": draft["counter"], "title": "Midterm exam", "category_key": "exam",
            "period": "midterm", "max_points": "100", "include_in_grade": True, "max_attempts": 1,
            "score_rule": "highest", "allow_late": False, "questions": []}
    saved = fac.put(a(graded, f"/{ids['exam_m']}/draft"), body).json()
    assert fac.post(a(graded, f"/{ids['exam_m']}/draft/publish"),
                    {"expected_counter": saved["counter"]}).status_code == 200
    assert book(graded)[0]["s1"]["published"]["midterm"]["needs_review"]
    assert book(graded)[0]["s1"]["grades"]["midterm"]["grade"] == 61.0                  # 40/100 now


def test_new_maximum_below_a_recorded_score_is_refused(graded):
    ids = full_term(graded)
    fac = graded["fac"]
    fac.post(a(graded, f"/{ids['exam_m']}/draft"))
    draft = fac.get(a(graded, f"/{ids['exam_m']}")).json()["draft"]
    body = {"expected_counter": draft["counter"], "title": "Midterm exam", "category_key": "exam",
            "period": "midterm", "max_points": "30", "include_in_grade": True, "max_attempts": 1,
            "score_rule": "highest", "allow_late": False, "questions": []}
    saved = fac.put(a(graded, f"/{ids['exam_m']}/draft"), body).json()
    refused = fac.post(a(graded, f"/{ids['exam_m']}/draft/publish"),
                       {"expected_counter": saved["counter"]})
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "score_exceeds_max"


def test_grade_publication_is_blocked_in_a_closed_term(graded):
    full_term(graded)
    graded["admin"].post(f"/api/terms/{graded['term']['id']}/close")
    refused = graded["fac"].post(g(graded, "/grades/publish"), {"period": "midterm"})
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "term_closed"
    attendance = graded["fac"].put(g(graded, "/attendance"), {
        "section_id": graded["sec_a"]["id"], "session_date": "2026-07-20", "period": "midterm",
        "marks": {}})
    assert attendance.status_code == 409
    assert graded["fac"].get(g(graded, "/gradebook")).status_code == 200             # reading is fine


# ---------------- review round 2: flagging triggers, snapshot sources, flat custom categories ----------------

def flagged(c):
    rows, _ = book(c)
    return {period: p["needs_review"] for period, p in rows["s1"]["published"].items()}


def test_a_second_quiz_attempt_flags_a_published_grade(graded):
    full_term(graded)
    quiz = make_quiz(graded, title="Retake quiz", max_attempts=2, score_rule="highest")
    s1 = graded["st1"]
    first = start(s1, graded, quiz["aid"]).json()
    keys = [q["key"] for q in quiz["questions"]]
    submit(s1, graded, first["id"], {keys[1]: True})                       # 1 of 5
    publish_grades(graded, "midterm")
    assert flagged(graded) == {"midterm": False}
    second = start(s1, graded, quiz["aid"]).json()
    submit(s1, graded, second["id"], quiz["correct"])                       # 5 of 5 raises the working grade
    assert flagged(graded)["midterm"] is True
    # the student still sees the grade that was published, not the new working value
    assert graded["st1"].get(la(graded, "/results")).json()["grades"][0]["release_number"] == 1


def test_new_graded_work_after_publication_flags_only_its_period(graded):
    full_term(graded)
    publish_grades(graded, "midterm")
    publish_grades(graded, "finals")
    assert flagged(graded) == {"midterm": False, "finals": False}
    make_manual(graded, "exam", "Extra midterm exam", "20", category_key="exam")      # midterm by default
    assert flagged(graded) == {"midterm": True, "finals": False}


def test_practice_work_never_flags_grades(graded):
    full_term(graded)
    publish_grades(graded, "midterm")
    s1 = graded["students"][0]
    practice = make_manual(graded, "offline_quiz", "Practice", "10", include_in_grade=False,
                           category_key=None, period=None)
    assert score(graded, practice, s1, 7).status_code == 200
    assert flagged(graded) == {"midterm": False}                                      # not graded, nothing stale


def test_the_grade_snapshot_keeps_the_sources_of_the_published_grade(db, graded):
    from sqlalchemy import select

    from app.features.assessments.models import GradePublication
    ids = full_term(graded)
    s1 = graded["students"][0]
    publish_grades(graded, "midterm")
    assert score(graded, ids["exam_m"], s1, 10).status_code == 200                       # working data moves on
    publish_grades(graded, "midterm")
    first, second = db.scalars(select(GradePublication).where(
        GradePublication.student_id == s1.id, GradePublication.period == "midterm")
        .order_by(GradePublication.release_number)).all()

    def sources(release, category):
        cats = release.snapshot["periods"]["midterm"]["categories"]
        return next(c for c in cats if c["key"] == category)["sources"]
    old_exam = sources(first, "exam")[0]
    assert (old_exam["title"], old_exam["score"], old_exam["revision_version"]) == ("Midterm exam", "40.00", 1)
    assert sources(second, "exam")[0]["score"] == "10.00"                                # each release is its own record
    quiz = sources(first, "quiz")[0]
    assert quiz["attempt_id"] and quiz["score"] == "4.00"                                # the selected attempt is recorded
    days = sources(first, "attendance")
    assert [d["status"] for d in days] == ["present", "present", "present", "late", "absent"]
    assert float(first.grade) == 81.0 and float(second.grade) == 51.0


def test_a_flat_custom_category_policy_like_the_institutions_syllabus(course):
    policy = {"categories": [{"key": "participation", "label": "Class participation", "weight": 15},
                             {"key": "quizzes", "label": "Quizzes", "weight": 10},
                             {"key": "projects", "label": "Projects", "weight": 25},
                             {"key": "examination", "label": "Examination", "weight": 50}],
              "periods": [{"key": "midterm", "label": "Midterm", "share": 100}],
              "transmutation": "raw", "passing": 75}
    with_policy(course, policy)
    s1 = course["students"][0]
    for kind, title, cat, points, value in (("manual", "Recitation", "participation", "10", 8),
                                            ("offline_quiz", "Quiz 1", "quizzes", "10", 9),
                                            ("manual", "Poster project", "projects", "20", 18),
                                            ("exam", "Exam", "examination", "50", 40)):
        aid = make_manual(course, kind, title, points, category_key=cat)
        assert score(course, aid, s1, value).status_code == 200
    midterm = book(course)[0]["s1"]["grades"]["midterm"]
    assert midterm["grade"] == 83.5                                  # 12 + 9 + 22.5 + 40
    assert [(c["key"], c["percent"]) for c in midterm["categories"]] == [
        ("participation", 80.0), ("quizzes", 90.0), ("projects", 90.0), ("examination", 80.0)]
    assert book(course)[0]["s1"]["grades"]["course"]["grade"] == 83.5   # one period carries the whole course


def test_policy_keys_must_be_unique(graded):
    from test_assessments import republish_policy
    dup_cat = {**POLICY, "categories": [*POLICY["categories"][:3],
                                        {"key": "quiz", "label": "Quizzes again", "weight": 50}]}
    refused = republish_policy(graded, dup_cat)
    assert refused.status_code == 422 and "unique" in refused.json()["error"]["message"].lower()
    dup_period = {**POLICY, "periods": [{"key": "midterm", "label": "A", "share": 50},
                                        {"key": "midterm", "label": "B", "share": 50}]}
    assert republish_policy(graded, dup_period).status_code == 422


def test_attendance_can_be_returned_to_unmarked(graded):
    s1 = graded["students"][0]
    full_term(graded)
    assert book(graded)[0]["s1"]["grades"]["midterm"]["grade"] == 81.0
    cleared = graded["fac"].put(g(graded, "/attendance"), {
        "section_id": graded["sec_a"]["id"], "session_date": "2026-07-05", "period": "midterm",
        "marks": {str(s1.id): None}})
    assert cleared.status_code == 204
    midterm = book(graded)[0]["s1"]["grades"]["midterm"]
    assert midterm["grade"] is None and any("not marked" in r for r in midterm["pending"])


def test_a_students_standing_matches_the_gradebook_and_is_faculty_only(db, graded):
    """The per-student page reads the authoritative calculations, separates working from released values,
    and is closed to everyone but the assigned teacher."""
    from helpers import Api, make_account
    from test_assessments import make_manual, make_quiz, second_offering, start, submit
    fac, st1, admin = graded["fac"], graded["st1"], graded["admin"]
    s1, s2 = graded["students"]
    quiz = make_quiz(graded, "Standing quiz")
    submit(st1, graded, start(st1, graded, quiz["aid"]).json()["id"], quiz["correct"])
    exam = make_manual(graded, "exam", "Standing exam", points="50")
    assert fac.put(g(graded, f"/assessments/{exam}/scores/{s1.id}"), {"score": "40", "feedback": ""}).status_code in (200, 204)
    url = g(graded, f"/students/{s1.id}/standing")
    page = fac.get(url).json()
    book = fac.get(g(graded, "/gradebook")).json()
    row = next(r for r in book["rows"] if r["student_id"] == str(s1.id))
    assert page["calculation"]["grades"] == row["grades"]                       # the same numbers, not a recalculation
    by_title = {a["title"]: a for a in page["assessments"]}
    assert by_title["Standing quiz"]["submission"] == "submitted" and by_title["Standing quiz"]["scored"] is True
    attempts = by_title["Standing quiz"]["attempts"]                                 # one tap from here to the answers
    assert [(a["attempt_number"], a["state"]) for a in attempts] == [(1, "submitted")] and by_title["Standing exam"]["attempts"] == []
    opened = fac.get(g(graded, f"/assessments/{quiz['aid']}/attempts/{attempts[0]['id']}"))
    assert opened.status_code == 200 and all("response" in q and "correct" in q for q in opened.json()["questions"])
    assert by_title["Standing exam"]["working_score"] == 40 and by_title["Standing exam"]["released"] is False
    assert by_title["Standing exam"]["released_score"] is None                  # working is not what the student sees
    assert page["student"]["enrollment_status"] == "enrolled" and "chat" not in str(page).lower()
    other = fac.get(g(graded, f"/students/{s2.id}/standing")).json()
    assert other["student"]["id"] == str(s2.id) and other["progress"]["done"] == 0
    # nobody else may read it, and an unrelated student is "not found" even for the right teacher
    assert st1.get(url).status_code == 403 and admin.get(url).status_code == 403
    stranger = Api(make_account(db, "stranger@example.com", "faculty").email)
    assert stranger.get(url).status_code in (403, 404)
    outsider = make_account(db, "outsider@example.com", "student", "S-9")
    assert fac.get(g(graded, f"/students/{outsider.id}/standing")).status_code == 404
    other_offering = second_offering(graded)
    assert fac.get(f"/api/teach/offerings/{other_offering}/students/{s2.id}/standing").status_code == 404
    # a withdrawn student's record stays readable, with no working grade invented
    admin.delete(f"/api/sections/{graded['sec_a']['id']}/members/{s1.id}")
    gone = fac.get(url).json()
    assert gone["student"]["enrollment_status"] == "withdrawn" and gone["calculation"] is None and gone["calculation_note"]
    assert gone["progress"] is None
