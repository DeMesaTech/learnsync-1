"""Pasting questions: the parser reports problems by line and never guesses; duplicating an assessment."""
from helpers import Api, make_account
from test_assessments import make_manual, make_quiz
from test_dashboard import home

from app.features.assessments.question_import import MAX_QUESTIONS, parse_questions

GOOD = """Q: Which of these is a legal business structure?
A) Sole proprietorship
B) Hobby
C) Rumor
D) Fad
Answer: A
Points: 2
Why: A sole proprietorship is owned by one person.

Q: A sole proprietor has unlimited liability.
Answer: True

Q: Name the simplest form of business.
Answer: Sole proprietorship | one-person firm
"""


def test_the_three_question_types_are_read_with_points_and_explanations():
    parsed = parse_questions(GOOD)
    assert parsed["errors"] == []
    mc, tf, short = parsed["questions"]
    assert mc["type"] == "multiple_choice" and len(mc["choices"]) == 4 and mc["points"] == "2"
    assert mc["correct"] == mc["choices"][0]["id"] and mc["explanation"].startswith("A sole proprietorship")
    assert tf["type"] == "true_false" and tf["correct"] is True and tf["points"] == "1" and tf["choices"] == []
    assert short["type"] == "short_answer" and short["correct"] == ["Sole proprietorship", "one-person firm"]
    assert len({q["key"] for q in parsed["questions"]}) == 3                       # every question gets its own identity
    assert len({c["id"] for c in mc["choices"]}) == 4


def test_friendly_variants_windows_line_endings_numbering_and_multi_line_prompts():
    text = "1. What is a market?\r\na. A place where buyers and sellers meet\r\nb) A kind of fruit\r\nANSWER: a\r\n\r\n2) Explain\r\nthe word profit.\r\nAnswer: money left after costs | income minus expenses\r\n\r\nQuestion 3: Cash is an asset\r\nAnswer: false\r\npoints: 1.5\r\n"
    parsed = parse_questions(text)
    assert parsed["errors"] == []
    mc, short, tf = parsed["questions"]
    assert mc["correct"] == mc["choices"][0]["id"] and mc["prompt"] == "What is a market?"
    assert short["prompt"] == "Explain the word profit." and len(short["correct"]) == 2
    assert tf["correct"] is False and tf["points"] == "1.5"


def test_problems_are_reported_with_their_line_and_the_good_questions_still_come_through():
    # (block, offset of the offending line inside the block, words the message must contain)
    cases = [
        ("Q: No answer here\nA) one\nB) two", 0, "Answer"),
        ("Q: Bad letter\nA) one\nB) two\nAnswer: C", 3, "not one of the choices"),
        ("Q: Only one choice\nA) lonely\nAnswer: A", 1, "two choices"),
        ("Q: Bad points\nAnswer: True\nPoints: lots", 2, "number"),
        ("Q: Zero points\nAnswer: True\nPoints: 0", 2, "above zero"),
        ("Q: Twice\nAnswer: True\nAnswer: False", 2, "twice"),
        ("Q: Duplicate letters\nA) x\nA) y\nAnswer: A", 1, "own letter"),
        ("Q: Text after the answer\nAnswer: True\nsurprise", 2, "Unexpected"),
    ]
    good = "Q: The one good question\nAnswer: True"
    text, line, expected = "", 1, {}
    for block, offset, words in cases:
        expected[line + offset] = words
        text += block + "\n\n"
        line += block.count("\n") + 2
    parsed = parse_questions(text + good + "\n")
    assert [q["prompt"] for q in parsed["questions"]] == ["The one good question"]
    got = {e["line"]: e["message"] for e in parsed["errors"]}
    assert set(got) == set(expected), (got, expected)
    for at, words in expected.items():
        assert words in got[at], (at, got[at])


def test_empty_input_and_the_question_limit():
    assert parse_questions("")["errors"][0]["message"] == "Paste at least one question."
    assert parse_questions("   \n\n  ")["questions"] == []
    many = "\n\n".join(f"Q: Question {n}\nAnswer: True" for n in range(MAX_QUESTIONS + 5))
    parsed = parse_questions(many)
    assert len(parsed["questions"]) == MAX_QUESTIONS and len(parsed["errors"]) == 5


def test_parsed_questions_can_be_saved_into_a_quiz_draft(graded):
    c, oid = graded, graded["oid"]
    base = f"/api/teach/offerings/{oid}"
    parsed = c["fac"].post(base + "/assessments/parse-questions", {"text": GOOD})
    assert parsed.status_code == 200 and len(parsed.json()["questions"]) == 3
    made = c["fac"].post(base + "/assessments", {"kind": "online_quiz", "title": "Pasted quiz", "section_ids": []}).json()
    draft = c["fac"].post(base + f"/assessments/{made['id']}/draft").json() if False else c["fac"].get(base + f"/assessments/{made['id']}").json()["draft"]
    saved = c["fac"].put(base + f"/assessments/{made['id']}/draft", {
        "expected_counter": draft["counter"], "title": "Pasted quiz", "category_key": "quiz", "period": "midterm",
        "questions": parsed.json()["questions"]})
    assert saved.status_code == 200, saved.text
    assert float(saved.json()["max_points"]) == 4.0                                 # 2 + 1 + 1


def test_the_parse_endpoint_is_for_the_teachers_own_subject_only(db, graded):
    c, oid = graded, graded["oid"]
    url = f"/api/teach/offerings/{oid}/assessments/parse-questions"
    other = make_account(db, "pasting@example.com", "faculty")
    assert Api(other.email).post(url, {"text": GOOD}).status_code == 404
    assert c["st1"].post(url, {"text": GOOD}).status_code == 403
    assert c["admin"].post(url, {"text": GOOD}).status_code == 403
    assert c["fac"].post(url, {"text": "x" * 200001}).status_code == 422


def test_duplicating_an_assessment_makes_a_hidden_draft_without_dates_or_records(db, graded):
    c, oid = graded, graded["oid"]
    base = f"/api/teach/offerings/{oid}"
    quiz = make_quiz(c, title="Quiz 1", category_key="quiz", period="midterm")
    activity = make_manual(c, "activity", "Poster", points="10", category_key="activity", period="midterm")
    before = len(c["fac"].get(base + "/assessments").json())
    made = c["fac"].post(base + f"/assessments/{quiz['aid']}/duplicate")
    assert made.status_code == 201, made.text
    copy = c["fac"].get(base + f"/assessments/{made.json()['id']}").json()
    assert copy["published"] is None and copy["draft"]["title"] == "Copy of Quiz 1"
    assert len(copy["draft"]["questions"]) == 3 and copy["draft"]["category_key"] == "quiz"
    assert copy["draft"]["deadline"] is None and copy["draft"]["available_from"] is None
    assert len(c["fac"].get(base + "/assessments").json()) == before + 1
    assert "Copy of Quiz 1" not in [w["title"] for w in home(c)["todo"]]               # students see nothing
    again = c["fac"].post(base + f"/assessments/{activity}/duplicate")
    assert again.status_code == 201
    other = make_account(db, "duplicator@example.com", "faculty")
    assert Api(other.email).post(base + f"/assessments/{quiz['aid']}/duplicate").status_code == 404
    assert c["st1"].post(base + f"/assessments/{quiz['aid']}/duplicate").status_code == 403
    assert c["fac"].post(base + "/assessments/00000000-0000-0000-0000-000000000000/duplicate").status_code == 404
