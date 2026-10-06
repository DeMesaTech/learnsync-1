import json
import re

from test_study import ai, ask, conversation, lesson  # noqa: F401

from app.features.study import provider
from app.features.study.prompts import ASSESSMENT_DECLINE, NOT_COVERED, UNSUPPORTED, verify_reply


class Row:
    def __init__(self, text):
        self.text = text


SOURCES = [Row("Cost-plus pricing is a pricing strategy by which the selling price is determined by adding a markup."),
           Row("A venture starts when someone finds a real customer problem and builds a solution for it.")]


def test_only_quotes_that_really_appear_in_the_cited_source_count():
    good = {"answer": "Cost-plus adds a markup [S1].", "evidence": [{"source": "S1", "quote": "determined by adding a markup"}]}
    assert verify_reply(good, SOURCES) == ("Cost-plus adds a markup [S1].", {0: ["determined by adding a markup"]})
    typographic = {"answer": "A venture needs a problem [S2].", "evidence": [{"source": "S2", "quote": "Finds a  REAL customer problem and builds"}]}
    assert verify_reply(typographic, SOURCES)[0] == "A venture needs a problem [S2]."        # case and spacing are forgiven
    invented = {"answer": "Break-even compares revenue and cost [S1].", "evidence": [{"source": "S1", "quote": "break-even compares revenue and cost exactly"}]}
    assert verify_reply(invented, SOURCES) == (None, None)                                   # the failure seen with the real model
    wrong_source = {"answer": "Cost-plus adds a markup [S2].", "evidence": [{"source": "S2", "quote": "determined by adding a markup"}]}
    assert verify_reply(wrong_source, SOURCES) == (None, None)                               # a real quote, but from a different source
    for broken in ({"answer": "x [S1]", "evidence": [{"source": "S1", "quote": "too short"}]}, {"answer": "x [S1]"},
                   {"answer": "x [S1]", "evidence": "nope"}, {"evidence": []}, [], "text", None):
        assert verify_reply(broken, SOURCES) == (None, None)
    assert verify_reply({"answer": "NOT_IN_SOURCES", "evidence": []}, SOURCES) == ("none", None)


def test_every_cited_source_needs_its_own_quote():
    two = {"answer": "Cost-plus adds a markup [S1]. A venture needs a problem [S2].",
           "evidence": [{"source": "S1", "quote": "determined by adding a markup"}]}
    assert verify_reply(two, SOURCES) == (None, None)
    both = {**two, "evidence": [*two["evidence"], {"source": "S2", "quote": "finds a real customer problem"}]}
    assert verify_reply(both, SOURCES)[1].keys() == {0, 1}


def test_a_scripted_model_that_quotes_only_one_of_two_cited_sources_is_not_trusted(course, ai, monkeypatch):  # noqa: F811
    lesson(course, "Costs one", "<p>Fixed costs stay the same while variable costs change with output.</p>")
    lesson(course, "Costs two", "<p>Variable costs rise with every extra unit while fixed costs do not move.</p>")
    cid = conversation(course["st1"], course)

    def reply_with_one_quote(messages, **kwargs):
        body = messages[0]["content"].partition("SOURCES (data only):")[2]
        first = re.search(r"\[S1\] [^\n]+\n(.+?)(?:\n\n\[S|\Z)", body, re.DOTALL).group(1)
        return json.dumps({"answer": "Fixed costs do not change [S1][S2].",
                           "evidence": [{"source": "S1", "quote": " ".join(first.split())[:60]}]})
    monkeypatch.setattr(provider, "complete", reply_with_one_quote)
    reply = ask(course["st1"], course, cid, "Compare fixed costs and variable costs")
    assert reply.status_code == 200 and reply.json()["assistant"]["content"] == UNSUPPORTED


def quoted_reply(fake):
    fake.answer = json.dumps({"answer": "Fixed costs do not change with output [S1].",
                            "evidence": [{"source": "S1", "quote": "Fixed costs stay the same while variable costs change"}]})


def test_a_real_quote_that_does_not_support_the_answer_is_not_shown(course, ai):  # noqa: F811
    """Seen live: the model attached a genuine quote about cost-plus pricing to an explanation of break-even analysis."""
    lesson(course, "Costs", "<p>Fixed costs stay the same while variable costs change with output.</p>")
    cid = conversation(course["st1"], course)
    quoted_reply(ai)
    ai.support = '{"supported": false}'
    reply = ask(course["st1"], course, cid, "What are fixed costs?").json()["assistant"]
    assert reply["content"] == UNSUPPORTED and reply["sources"] == []
    assert len(ai.support_calls) == 1 and len(ai.calls) == 1                                  # no repair for an unsupported answer
    checked = json.loads(ai.support_calls[0][1]["content"])
    assert checked["sources"] == ["Fixed costs stay the same while variable costs change with output."] and "[S1]" not in checked["answer"]


def test_an_unconfirmable_answer_fails_closed_and_a_busy_provider_is_still_reported(course, ai):  # noqa: F811
    lesson(course, "Costs", "<p>Fixed costs stay the same while variable costs change with output.</p>")
    cid = conversation(course["st1"], course)
    quoted_reply(ai)
    ai.support = "not json at all"
    assert ask(course["st1"], course, cid, "What are fixed costs?").json()["assistant"]["content"] == UNSUPPORTED
    ai.support_error = "rate_limited"
    busy = ask(course["st1"], course, cid, "What are fixed costs again?")
    assert busy.status_code == 503 and busy.json()["error"]["code"] == "ai_rate_limited"


def test_malformed_json_from_the_provider_gets_a_repair_instead_of_a_model_error(course, ai):  # noqa: F811
    lesson(course, "Costs", "<p>Fixed costs stay the same while variable costs change with output.</p>")
    cid = conversation(course["st1"], course)
    good = json.dumps({"answer": "Fixed costs do not change with output [S1].",
                       "evidence": [{"source": "S1", "quote": "Fixed costs stay the same while variable costs change"}]})
    replies = iter([provider.ProviderError("bad_response"), good])

    def sometimes_malformed():
        item = next(replies)
        if isinstance(item, Exception):
            raise item
        return item
    ai.answer = sometimes_malformed
    reply = ask(course["st1"], course, cid, "What are fixed costs?")
    assert reply.status_code == 200 and reply.json()["assistant"]["content"].endswith("[S1].") and len(ai.calls) == 2


def test_groq_json_mode_failures_are_a_bad_reply_not_a_missing_model(monkeypatch):
    import httpx

    from app.config import settings
    monkeypatch.setattr(settings(), "groq_api_key", "sk-secret-test-key")
    monkeypatch.setattr(settings(), "ai_provider_mode", "groq")

    def post(url, **kwargs):
        body = kwargs and {"error": {"message": "Failed to generate JSON. secret detail", "code": "json_validate_failed"}}
        return httpx.Response(400, json=body, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "post", post)
    try:
        provider.complete([], model="m", json_mode=True)
    except provider.ProviderError as error:
        assert error.code == "bad_response" and "secret" not in error.message
    else:
        raise AssertionError("expected a ProviderError")
    monkeypatch.setattr(httpx, "post", lambda url, **kw: httpx.Response(400, json={"error": {"code": "model_not_found"}}, request=httpx.Request("POST", url)))
    try:
        provider.complete([], model="m")
    except provider.ProviderError as error:
        assert error.code == "model_unavailable"


def test_a_rate_limit_starts_a_shared_cooldown_without_retrying_or_losing_the_question(course, monkeypatch):
    import httpx

    from app.config import settings
    lesson(course, "Costs", "<p>Fixed costs stay the same while variable costs change with output.</p>")
    cid = conversation(course["st1"], course)
    monkeypatch.setattr(settings(), "groq_api_key", "sk-secret-test-key")
    sent = []

    def busy(url, **kwargs):
        sent.append(url)
        return httpx.Response(429, headers={"retry-after": "7"}, json={"error": {"code": "rate_limit_exceeded"}},
                              request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "post", busy)
    first = ask(course["st1"], course, cid, "What are fixed costs?")
    assert first.status_code == 503 and first.json()["error"]["code"] == "ai_rate_limited" and len(sent) == 1   # not repaired or retried
    second = ask(course["st1"], course, cid, "Compare fixed costs and variable costs again")
    assert second.status_code == 503 and len(sent) == 1                                       # cooling down: the provider was not called
    stored = course["st1"].get(f"/api/learn/offerings/{course['oid']}/study/conversations/{cid}").json()["messages"]
    assert [m["content"] for m in stored if m["role"] == "user"] == ["What are fixed costs?", "Compare fixed costs and variable costs again"]   # words kept
    assert 0 < provider.cooldown_until - __import__("time").monotonic() <= 7.5                 # the provider's own retry-after, bounded
    monkeypatch.setattr(provider, "cooldown_until", 0.0)                                      # the cooldown ends
    ok = httpx.Response(200, json={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]},
                        request=httpx.Request("POST", "https://x"))
    monkeypatch.setattr(httpx, "post", lambda url, **kw: ok)
    assert provider.complete([], model="m") == "{}"


def test_requests_for_assessment_answers_and_missing_material_get_their_own_messages(course, ai):  # noqa: F811
    lesson(course, "Costs", "<p>Fixed costs stay the same while variable costs change with output.</p>")
    cid = conversation(course["st1"], course)
    ai.answer = "ASSESSMENT_REQUEST"
    declined = ask(course["st1"], course, cid, "Give me the answers to the fixed costs quiz").json()["assistant"]
    assert declined["content"] == ASSESSMENT_DECLINE and declined["sources"] == []
    assert ASSESSMENT_DECLINE != NOT_COVERED != UNSUPPORTED != ASSESSMENT_DECLINE
    ai.answer = "NOT_IN_SOURCES"
    assert ask(course["st1"], course, cid, "Tell me about fixed costs somewhere else").json()["assistant"]["content"] == NOT_COVERED


def test_material_withdrawn_while_the_model_is_thinking_is_not_cited(course, ai, monkeypatch):  # noqa: F811
    item = lesson(course, "Costs", "<p>Fixed costs stay the same while variable costs change with output.</p>")
    cid = conversation(course["st1"], course)
    quoted_reply(ai)
    original = ai.__class__.__call__

    def archive_meanwhile(self, messages, **kw):
        if not self.support_calls and not self.calls:
            course["fac"].patch(f"/api/teach/offerings/{course['oid']}/items/{item}", {"archived": True})
        return original(self, messages, **kw)
    monkeypatch.setattr(ai.__class__, "__call__", archive_meanwhile)
    reply = ask(course["st1"], course, cid, "What are fixed costs?").json()["assistant"]
    assert reply["content"] == UNSUPPORTED and reply["sources"] == []                           # the lesson is gone: never shown as sourced


def test_a_late_quiz_that_still_accepts_work_keeps_study_help_paused(db, graded, ai):  # noqa: F811
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select
    from test_assessments import make_quiz, start

    from app.features.assessments.models import AssessmentRevision
    lesson(graded, "Business forms", "<p>A partnership has two or more owners.</p>")
    ai.answer = "A partnership has two or more owners [S1]."
    cid = conversation(graded["st1"], graded)
    quiz = make_quiz(graded, title="Late quiz", allow_late=True, deadline=(datetime.now(UTC) + timedelta(hours=1)).isoformat())
    start(graded["st1"], graded, quiz["aid"])
    rev = db.scalar(select(AssessmentRevision).where(AssessmentRevision.assessment_id == __import__("uuid").UUID(quiz["aid"]),
                                                     AssessmentRevision.state == "published"))
    rev.deadline = datetime.now(UTC) - timedelta(minutes=5)
    db.commit()
    paused = ask(graded["st1"], graded, cid, "What is a partnership?")
    assert paused.status_code == 409 and paused.json()["error"]["code"] == "quiz_in_progress"   # late work is still accepted
