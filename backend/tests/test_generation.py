import json
import uuid

import pytest
from helpers import Api, make_account, t
from sqlalchemy import func, select
from test_assessments import a, draft_fields, la, make_quiz, start, submit
from test_study import ai, file_item, lesson, make_pdf  # noqa: F401

from app.config import settings
from app.features.assessments.models import Assessment
from app.features.study import provider
from app.features.study.models import AiGeneration

TEXT = ("<p>A sole proprietorship has one owner who has unlimited liability.</p>"
        "<p>A partnership has two or more owners who share profits and losses.</p>"
        "<p>A corporation is a separate legal entity owned by shareholders.</p>")


def payload(mc=2, tf=1, sa=1, source="src1", **override):
    questions = []
    for n in range(mc):
        questions.append({"type": "multiple_choice", "prompt": f"Which form has two or more owners? ({n})",
                          "choices": ["Sole proprietorship", "Partnership", "Corporation", "Cooperative"],
                          "correct_index": 1, "explanation": "Partnerships have two or more owners.",
                          "source_id": source})
    for n in range(tf):
        questions.append({"type": "true_false", "prompt": f"A sole proprietor has unlimited liability. ({n})",
                          "correct_bool": True, "explanation": "Stated in the lesson.", "source_id": source})
    for n in range(sa):
        questions.append({"type": "short_answer", "prompt": f"Who owns a corporation? ({n})",
                          "accepted_answers": ["shareholders", "the shareholders"],
                          "explanation": "Shareholders own it.", "source_id": source})
    return json.dumps({"questions": questions, **override})


def gen(c, items, mc=2, tf=1, sa=1, title="AI quiz", **extra):
    return c["fac"].post(t(c, "/assessments/generate"), {
        "title": title, "source_item_ids": items, "multiple_choice": mc, "true_false": tf,
        "short_answer": sa, "points": "1", **extra})


def assessment_count(db):
    return db.scalar(select(func.count()).select_from(Assessment))


def test_generation_saves_a_reviewable_unpublished_draft_with_sources(db, graded, ai):  # noqa: F811
    item = lesson(graded, "Business forms", TEXT)
    ai.answer = payload()
    response = gen(graded, [item], title="Business forms quiz")
    assert response.status_code == 201, response.text
    quiz = response.json()
    draft = quiz["draft"]
    assert quiz["kind"] == "online_quiz" and quiz["published"] is None
    assert draft["ai_generated"] is True and draft["reviewed"] is False and draft["max_points"] == 4.0
    assert draft["ai_language"] == "same" and db.scalars(select(AiGeneration)).one().settings["language"] == "same"
    assert [q["type"] for q in draft["questions"]] == ["multiple_choice"] * 2 + ["true_false", "short_answer"]
    assert all(q["source"]["item_id"] == item and q["source"]["title"] == "Business forms"
               and q["source"]["revision_id"] for q in draft["questions"])
    assert len({q["key"] for q in draft["questions"]}) == 4
    mc = draft["questions"][0]
    assert len(mc["choices"]) == 4 and mc["correct"] == mc["choices"][1]["id"]
    assert draft["questions"][3]["correct"] == ["shareholders", "the shareholders"]
    # what was sent: JSON mode, the quiz model, only the chosen source text, nothing about people
    call = ai.calls[0]
    sent = json.dumps(call["messages"])
    assert call["json"] is True and call["model"] == settings().groq_quiz_model
    assert "unlimited liability" in sent and "Demo" not in sent and "@example.com" not in sent
    record = db.scalars(select(AiGeneration)).one()
    assert record.status == "succeeded" and str(record.assessment_id) == quiz["id"]
    # students never see drafts, and AI metadata never reaches a student
    assert graded["st1"].get(la(graded, "/assessments")).json() == []


def test_unpublishable_until_the_latest_version_is_reviewed(graded, ai):  # noqa: F811
    item = lesson(graded, "Business forms", TEXT)
    ai.answer = payload()
    quiz = gen(graded, [item]).json()
    aid, fac = quiz["id"], graded["fac"]
    base = a(graded, f"/{aid}")

    def save(**over):
        d = fac.get(base).json()["draft"]
        body = {"expected_counter": d["counter"], **draft_fields(
            title="AI quiz", category_key="quiz", period="midterm", max_points="4",
            questions=d["questions"]), **over}
        return fac.put(base + "/draft", body).json()["counter"]

    counter = save()
    refused = fac.post(base + "/draft/publish", {"expected_counter": counter})
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "review_required"
    stale = fac.post(base + "/draft/review", {"expected_counter": counter - 1})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "draft_revision_conflict"
    assert fac.post(base + "/draft/review", {"expected_counter": counter}).json()["reviewed"] is True
    assert fac.get(base).json()["draft"]["reviewed"] is True
    # editing after the review cancels it
    edited = save(title="AI quiz (edited)")
    assert fac.get(base).json()["draft"]["reviewed"] is False
    again = fac.post(base + "/draft/publish", {"expected_counter": edited})
    assert again.status_code == 409 and again.json()["error"]["code"] == "review_required"
    fac.post(base + "/draft/review", {"expected_counter": edited})
    done = fac.post(base + "/draft/publish", {"expected_counter": edited})
    assert done.status_code == 200, done.text
    student_view = graded["st1"].get(la(graded, "/assessments")).json()
    assert [i["title"] for i in student_view] == ["AI quiz (edited)"]
    attempt = start(graded["st1"], graded, aid).json()
    assert all(set(q) == {"key", "type", "prompt", "choices", "points"} for q in attempt["questions"])
    assert submit(graded["st1"], graded, attempt["id"]).status_code == 200


def test_manual_quizzes_do_not_need_a_review(graded):
    quiz = make_quiz(graded)
    d = graded["fac"].get(a(graded, f"/{quiz['aid']}")).json()
    assert d["published"]["ai_generated"] is False
    refused = graded["fac"].post(a(graded, f"/{quiz['aid']}/draft/review"), {"expected_counter": 1})
    assert refused.status_code in (404, 422)


@pytest.mark.parametrize("mutate", [
    lambda q: q["questions"].pop(),                                                         # wrong total
    lambda q: q["questions"][0].update(choices=["a", "b", "c"]),                            # three choices
    lambda q: q["questions"][0].update(choices=["a", "A", "c", "d"]),                       # duplicate choices
    lambda q: q["questions"][0].update(correct_index=7),                                    # no such choice
    lambda q: q["questions"][0].update(correct_index=True),                                 # bool is not an index
    lambda q: q["questions"][2].update(correct_bool="yes"),                                 # not a boolean
    lambda q: q["questions"][3].update(accepted_answers=[" "]),                             # blank answer
    lambda q: q["questions"][1].update(prompt=" "),                                         # empty question
    lambda q: q["questions"][0].update(source_id="src9"),                                   # unknown source
    lambda q: q["questions"][0].update(type="essay"),                                       # unsupported type
])
def test_invalid_ai_output_is_never_saved(db, graded, ai, mutate):  # noqa: F811
    item = lesson(graded, "Business forms", TEXT)
    raw = json.loads(payload())
    mutate(raw)
    ai.answer = json.dumps(raw)
    existing = make_quiz(graded, title="My own draft work")["aid"]
    before = assessment_count(db)
    response = gen(graded, [item])
    assert response.status_code == 422 and response.json()["error"]["code"] == "ai_output_invalid"
    assert assessment_count(db) == before                                   # nothing saved
    assert db.scalars(select(AiGeneration)).one().status == "invalid"
    assert graded["fac"].get(a(graded, f"/{existing}")).status_code == 200  # existing work untouched


def test_provider_problems_do_not_create_anything(db, graded, ai):  # noqa: F811
    item = lesson(graded, "Business forms", TEXT)
    before = assessment_count(db)
    ai.answer = "this is not json"
    bad = gen(graded, [item])
    assert bad.status_code == 503 and bad.json()["error"]["code"] == "ai_bad_response"
    ai.error = "timeout"
    slow = gen(graded, [item])
    assert slow.status_code == 503 and slow.json()["error"]["message"] == provider.SAFE_MESSAGES["timeout"]
    assert assessment_count(db) == before
    assert [r.status for r in db.scalars(select(AiGeneration)).all()] == ["failed", "failed"]


def test_sources_and_counts_are_validated_before_the_provider_is_called(db, graded, ai):  # noqa: F811
    from test_assessments import second_offering
    from test_teaching import new_item
    good = lesson(graded, "Business forms", TEXT)
    draft_only = new_item(graded, "lesson", "Unpublished")["id"]
    archived = lesson(graded, "Archived", TEXT)
    graded["fac"].patch(t(graded, f"/items/{archived}"), {"archived": True})
    elsewhere = lesson({**graded, "oid": second_offering(graded)}, "Other subject", TEXT)
    scanned = file_item(graded, "scan.pdf", make_pdf([None]), "Scanned")
    for ids in ([draft_only], [archived], [elsewhere], [str(uuid.uuid4())], [good, draft_only]):
        assert gen(graded, ids).status_code == 422, ids
    no_text = gen(graded, [scanned])
    assert no_text.status_code == 422 and no_text.json()["error"]["code"] == "no_source_text"
    assert gen(graded, [good], mc=0, tf=0, sa=0).status_code == 422
    assert gen(graded, [good], mc=20, tf=10, sa=1).status_code == 422                      # more than 30
    assert gen(graded, []).status_code == 422
    assert ai.calls == [] and assessment_count(db) == 0


def test_eligibility_is_rechecked_after_the_provider_call(db, graded, ai):  # noqa: F811
    item = lesson(graded, "Business forms", TEXT)
    original = ai.__class__.__call__

    def close_term_meanwhile(self, messages, **kw):
        graded["admin"].post(f"/api/terms/{graded['term']['id']}/close")
        return original(self, messages, **kw)
    ai.answer = payload()
    ai.__class__.__call__ = close_term_meanwhile
    try:
        response = gen(graded, [item])
    finally:
        ai.__class__.__call__ = original
    assert response.status_code == 409 and response.json()["error"]["code"] == "term_closed"
    assert assessment_count(db) == 0


def test_a_source_archived_during_generation_stops_the_save(db, graded, ai):  # noqa: F811
    item = lesson(graded, "Business forms", TEXT)
    original = ai.__class__.__call__

    def archive_meanwhile(self, messages, **kw):
        graded["fac"].patch(t(graded, f"/items/{item}"), {"archived": True})
        return original(self, messages, **kw)
    ai.answer = payload()
    ai.__class__.__call__ = archive_meanwhile
    try:
        response = gen(graded, [item])
    finally:
        ai.__class__.__call__ = original
    assert response.status_code == 409 and response.json()["error"]["code"] == "sources_changed"
    assert assessment_count(db) == 0


def test_generation_is_for_the_assigned_teacher_only(db, graded, ai):  # noqa: F811
    item = lesson(graded, "Business forms", TEXT)
    ai.answer = payload()
    stranger = Api(make_account(db, "other@example.com", "faculty").email)
    assert stranger.post(t(graded, "/assessments/generate"), {
        "title": "x", "source_item_ids": [item], "multiple_choice": 1}).status_code == 404
    assert graded["st1"].post(t(graded, "/assessments/generate"), {
        "title": "x", "source_item_ids": [item], "multiple_choice": 1}).status_code == 403
    assert ai.calls == []


def test_the_development_simulator_passes_the_real_checks_and_is_labelled(db, graded, monkeypatch):
    item = lesson(graded, "Business forms", TEXT)
    config = settings()
    monkeypatch.setattr(config, "ai_provider_mode", "fake")
    monkeypatch.setattr(config, "app_env", "production")
    assert provider.simulated() is False and provider.status()["simulated"] is False   # never outside dev
    monkeypatch.setattr(config, "app_env", "development")
    status = graded["st1"].get("/api/ai/status").json()
    assert status["simulated"] is True and status["chat_model"] == "simulator"
    response = gen(graded, [item], mc=2, tf=1, sa=1)
    assert response.status_code == 201, response.text
    assert response.json()["draft"]["ai_generated"] is True                             # still needs review
    cid = graded["st1"].post(f"/api/learn/offerings/{graded['oid']}/study/conversations").json()["id"]
    reply = graded["st1"].post(f"/api/learn/offerings/{graded['oid']}/study/conversations/{cid}/messages", {
        "text": "What is a partnership?", "client_message_id": "simulated-0001"}).json()["assistant"]
    assert "Simulated reply" in reply["content"] and reply["sources"][0]["title"] == "Business forms"
    # what is stored stays identifiable after switching to the real provider
    from app.features.study.models import StudyMessage
    assert {m.model for m in db.scalars(select(StudyMessage)).all() if m.role == "assistant"} == {"simulator"}
    assert {g.model for g in db.scalars(select(AiGeneration)).all()} == {"simulator"}


def test_simulated_chat_quotes_the_lesson_not_the_rules(graded, monkeypatch):
    from app.features.study import fake, prompts
    rows = [type("Row", (), {"title": "Business forms", "locator": "Page 2", "text": TEXT.replace("<p>", "").replace("</p>", " ")})()]
    reply = fake.complete(prompts.build_messages("Entrepreneurship", rows, [], "What is a partnership?"))
    assert "partnership" in reply.lower() and "[S1]" in reply and "answer the question" not in reply


def test_ai_check_refuses_to_pass_on_the_simulator_or_without_a_key(monkeypatch, capsys):
    from app import cli
    config = settings()
    monkeypatch.setattr(config, "ai_provider_mode", "fake")
    monkeypatch.setattr(config, "app_env", "development")
    with pytest.raises(SystemExit) as caught:
        cli.ai_check()
    assert caught.value.code == 1 and "SIMULATOR" in capsys.readouterr().out
    monkeypatch.setattr(config, "ai_provider_mode", "groq")
    monkeypatch.setattr(config, "groq_api_key", "")
    with pytest.raises(SystemExit) as caught:
        cli.ai_check()
    assert caught.value.code == 1 and "not set up" in capsys.readouterr().out
