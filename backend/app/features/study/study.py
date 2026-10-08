"""Subject-scoped study conversations. Private to the student; grounded in published content."""
import json
import uuid
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.errors import fail
from app.features.academics.models import AcademicTerm, Enrollment, Offering, Subject
from app.features.accounts.commands import audit
from app.features.accounts.models import now
from app.features.assessments.attempts import expired
from app.features.assessments.definitions import revision as assessment_revision
from app.features.assessments.models import Assessment, QuizAttempt
from app.features.teaching.access import learner_offering, targeted
from app.features.teaching.items import revision, section_ids_of
from app.features.teaching.models import LearningItem
from app.security import rate_limit

from . import provider
from .friendly import smalltalk, suggest, talk_reply
from .models import StudyConversation, StudyMessage
from .prompts import (
    ACTION_TEXT,
    ANALOGY_CHECK,
    ASSESSMENT_DECLINE,
    MAX_QUESTION_CHARS,
    NO_ANALOGY,
    NO_EXAMPLE,
    NO_TEXT,
    NOT_COVERED,
    REPAIR,
    SUPPORT_RULES,
    UNSUPPORTED,
    build_messages,
    clean_analogy,
    conversation_title,
    strip_tags,
    verify_reply,
)
from .retrieval import retrieve, retrieve_lesson


def get_conversation(db, student, offering, conversation_id):
    c = db.get(StudyConversation, conversation_id)
    if not c or c.student_id != student.id or c.offering_id != offering.id:
        fail(404, "not_found", "Conversation not found.")
    return c


def parse_cursor(cursor, parts):
    """A cursor is the sort key of the last row already shown: timestamp~...~id, so rows that share a
    timestamp are never skipped or repeated."""
    try:
        pieces = cursor.split("~")
        if len(pieces) != parts:
            raise ValueError
        return [datetime.fromisoformat(pieces[0]), *pieces[1:-1], uuid.UUID(pieces[-1])]
    except ValueError:
        fail(422, "bad_cursor", "That page marker is not valid. Reload the list.")


def list_conversations(db, student, offering, limit=25, cursor=None):
    """Newest first (then id), one page at a time: {items, has_more, next_cursor}."""
    query = select(StudyConversation).where(
        StudyConversation.student_id == student.id, StudyConversation.offering_id == offering.id)
    if cursor:
        at, last = parse_cursor(cursor, 2)
        query = query.where(or_(StudyConversation.updated_at < at,
                                and_(StudyConversation.updated_at == at, StudyConversation.id > last)))
    rows = db.scalars(query.order_by(StudyConversation.updated_at.desc(), StudyConversation.id)
                      .limit(limit + 1)).all()
    shown = rows[:limit]
    return {"items": [{"id": c.id, "title": c.title or "New conversation", "updated_at": c.updated_at}
                      for c in shown],
            "has_more": len(rows) > limit,
            "next_cursor": f"{shown[-1].updated_at.isoformat()}~{shown[-1].id}" if len(rows) > limit else None}


def list_all_conversations(db, student, limit=25, cursor=None, offering_id=None):
    """The student's own chats across every subject (history stays readable after withdrawal or term close).
    Each item says whether the student can still ask in it. Newest first, one page at a time."""
    query = (select(StudyConversation, Subject, AcademicTerm.status, Enrollment.status)
             .join(Offering, Offering.id == StudyConversation.offering_id)
             .join(Subject, Subject.id == Offering.subject_id)
             .join(AcademicTerm, AcademicTerm.id == Offering.term_id)
             .outerjoin(Enrollment, and_(Enrollment.offering_id == Offering.id, Enrollment.student_id == student.id))
             .where(StudyConversation.student_id == student.id))
    if offering_id:
        query = query.where(StudyConversation.offering_id == offering_id)
    if cursor:
        at, last = parse_cursor(cursor, 2)
        query = query.where(or_(StudyConversation.updated_at < at,
                                and_(StudyConversation.updated_at == at, StudyConversation.id > last)))
    rows = db.execute(query.order_by(StudyConversation.updated_at.desc(), StudyConversation.id)
                      .limit(limit + 1)).all()
    shown = rows[:limit]
    return {"items": [{"id": c.id, "title": c.title or "New conversation", "updated_at": c.updated_at,
                       "offering_id": c.offering_id, "subject_code": s.code, "subject_title": s.title,
                       "can_ask": enrolled == "enrolled"}   # only an open quiz pauses asking, and that is checked on the subject
                      for c, s, term, enrolled in shown],
            "has_more": len(rows) > limit,
            "next_cursor": (f"{shown[-1][0].updated_at.isoformat()}~{shown[-1][0].id}" if len(rows) > limit else None)}


def delete_conversation(db, student, offering, conversation_id):
    """The student's own chat, wholly: every message (with the sources saved on it) and the conversation.
    The audit trail keeps only that a deletion happened and how many messages, never their text."""
    c = get_conversation(db, student, offering, conversation_id)
    ids = db.scalars(select(StudyMessage.id).where(StudyMessage.conversation_id == c.id)).all()
    db.execute(delete(StudyMessage).where(StudyMessage.conversation_id == c.id,
                                          StudyMessage.reply_to_id.is_not(None)))      # replies first: they point at questions
    db.execute(delete(StudyMessage).where(StudyMessage.conversation_id == c.id))
    audit(db, student, "study.conversation_deleted", "study_conversation", c.id,
          {"offering_id": str(offering.id), "messages": len(ids)})
    db.delete(c)
    db.commit()


def create_conversation(db, student, offering):
    c = StudyConversation(student_id=student.id, offering_id=offering.id)
    db.add(c)
    db.commit()
    return c


def message_view(m):
    return {"id": m.id, "role": m.role, "content": m.content, "sources": m.sources,
            "suggestions": m.suggestions or [], "analogy": m.analogy, "created_at": m.created_at}


def messages_of(db, conversation, limit=50, cursor=None):
    """The latest `limit` messages in reading order, and a cursor for the older ones (None when there are none)."""
    query = select(StudyMessage).where(StudyMessage.conversation_id == conversation.id)
    if cursor:
        at, role, last = parse_cursor(cursor, 3)
        query = query.where(or_(StudyMessage.created_at < at, and_(StudyMessage.created_at == at, or_(
            StudyMessage.role > role, and_(StudyMessage.role == role, StudyMessage.id > last)))))
    rows = db.scalars(query.order_by(StudyMessage.created_at.desc(), StudyMessage.role, StudyMessage.id)
                      .limit(limit + 1)).all()
    shown = rows[:limit]
    more = f"{shown[-1].created_at.isoformat()}~{shown[-1].role}~{shown[-1].id}" if len(rows) > limit else None
    return list(reversed(shown)), more


def open_attempt_exists(db, offering_id, student_id):
    """An attempt the student can still work on. One on an archived or unpublished quiz, or past a strict
    deadline, can no longer be continued, so it must not keep study help paused forever."""
    rows = db.execute(select(QuizAttempt, Assessment).join(
        Assessment, Assessment.id == QuizAttempt.assessment_id).where(
        Assessment.offering_id == offering_id, QuizAttempt.student_id == student_id,
        QuizAttempt.state == "in_progress", Assessment.archived.is_(False))).all()
    for _, assessment in rows:
        rev = assessment_revision(db, assessment.id, "published")
        if rev and not expired(rev, now()):
            return True
    return False


def guard_new_message(db, student, offering_id):
    """Eligibility for NEW study messages: still enrolled, and no open quiz attempt here. A closed term does not stop
    study help; only a quiz in progress does."""
    offering, enrollment = learner_offering(db, offering_id, student)
    if open_attempt_exists(db, offering_id, student.id):
        fail(409, "quiz_in_progress", "Study help is paused while you have a quiz attempt open in "
                                      "this subject. Finish or submit the quiz first.")
    return offering, enrollment


def valid_item(db, offering, enrollment, item_id):
    item = db.get(LearningItem, item_id)
    if not item or item.offering_id != offering.id or item.archived \
            or not revision(db, item.id, "published") \
            or not targeted(section_ids_of(db, item.id), enrollment):
        fail(422, "item_invalid", "Choose a lesson from this subject's published content.")
    return item


def source_metadata(db, offering_id, rows, cited, evidence=None):
    """Citations the student can actually open (built from retrieved rows, never from model text)."""
    out, seen = [], set()

    def add(row, is_cited):
        if row.item_id in seen:
            return
        seen.add(row.item_id)
        out.append({"item_id": str(row.item_id), "title": row.title, "locator": row.locator,
                    "link": f"/student/offerings/{offering_id}/lessons/{row.item_id}",
                    "cited": is_cited, "quotes": []})
    for index in cited:
        add(rows[index], True)
        for entry in out:                            # the verified words behind this citation, from the source itself
            if entry["item_id"] == str(rows[index].item_id):
                entry["quotes"] += [q for q in (evidence or {}).get(index, []) if q not in entry["quotes"]]
    for row in rows:
        if len([s for s in out if not s["cited"]]) < 3:
            add(row, False)
    return out


def existing_pair(db, conversation, client_message_id):
    user = db.scalar(select(StudyMessage).where(
        StudyMessage.conversation_id == conversation.id,
        StudyMessage.client_message_id == client_message_id))
    reply = db.scalar(select(StudyMessage).where(StudyMessage.reply_to_id == user.id)) \
        if user else None
    return user, reply


def ask_model(prompt, model):
    """The raw reply, or None when the model produced malformed output (that counts as an unverifiable reply)."""
    try:
        return provider.complete(prompt, model=model, json_mode=True, max_tokens=900, temperature=0.1)
    except provider.ProviderError as error:
        if error.code == "bad_response":
            return None
        fail(503, f"ai_{error.code}", error.message)


def check_support(model, answer, evidence, rows, analogy=None):
    """A separate, narrow check: do the cited passages really state what the answer claims? A quote can exist in a
    source and still say nothing about the question, so the answer would only look sourced. The check sees the
    whole cited passages (not just the quote) so honest paraphrase of nearby sentences is not punished. When an
    analogy came with the answer, the SAME call also judges it, so an analogy costs no extra request."""
    passages = [rows[index].text for index in evidence]
    payload = {"sources": passages, "answer": strip_tags(answer)}
    if analogy:
        payload["analogy"] = analogy
    prompt = [{"role": "system", "content": SUPPORT_RULES + ("\n" + ANALOGY_CHECK if analogy else "")},
              {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]
    try:
        return provider.parse_json(provider.complete(prompt, model=model, json_mode=True, max_tokens=300, temperature=0))
    except provider.ProviderError as error:
        if error.code == "bad_response":
            return {}                                 # cannot confirm it: do not show it
        fail(503, f"ai_{error.code}", error.message)


def supported_by_sources(model, answer, evidence, rows):
    return check_support(model, answer, evidence, rows).get("supported") is True


def grounded_answer(prompt, model, rows):
    """(kind, text, evidence). kind is "answer" (verified), "none" (the sources do not cover it), "assessment"
    (asking for answers to graded work) or "unsupported" (the reply could not be verified)."""
    return grounded_reply(prompt, model, rows)[:3]


def grounded_reply(prompt, model, rows, want_analogy=False):
    """(kind, text, evidence, analogy). Real models drift and even invent source tags. A reply is shown only when
    (1) every source it cites has a quote that is literally present in that source and (2) a separate check agrees
    those quotes support the answer. A reply that fails (1) gets one repair attempt; a rate limit is never retried
    as if it were bad content. An analogy is kept only when the answer itself passed both checks AND the same
    check judged the analogy faithful and free of new facts; otherwise it is dropped and the answer stands alone."""
    raw = ask_model(prompt, model)
    for attempt in range(2):
        analogy = None
        try:
            reply = provider.parse_json(raw) if raw else None
            text, evidence = verify_reply(reply, rows) if raw else (None, None)
            if want_analogy and isinstance(reply, dict):
                analogy = clean_analogy(reply.get("analogy"))
        except provider.ProviderError:
            text, evidence = None, None
        if text in ("none", "assessment"):
            return text, None, {}, None
        if text:
            verdict = check_support(model, text, evidence, rows, analogy)
            if verdict.get("supported") is not True:
                return "unsupported", None, {}, None
            return "answer", text, evidence, analogy if verdict.get("analogy_ok") is True else None
        if attempt == 0:
            raw = ask_model([*prompt, {"role": "assistant", "content": raw or ""}, {"role": "user", "content": REPAIR}], model)
    return "unsupported", None, {}, None


def sources_still_available(db, offering, enrollment, rows, cited):
    """The provider call can take a while: a cited lesson may have been archived, unpublished or retargeted since."""
    for index in cited:
        try:
            valid_item(db, offering, enrollment, rows[index].item_id)
        except HTTPException:
            return False
    return True


def send(db, student, offering_id, conversation_id, text, client_message_id, selected_item_id, action=None):
    question = text.strip()
    if action and not selected_item_id:
        fail(422, "action_needs_lesson", "Choose a lesson first.")
    if not action and (not question or len(question) > MAX_QUESTION_CHARS):
        fail(422, "message_invalid", f"Write a question of up to {MAX_QUESTION_CHARS} characters.")
    offering, enrollment = guard_new_message(db, student, offering_id)
    conversation = get_conversation(db, student, offering, conversation_id)
    user, reply = existing_pair(db, conversation, client_message_id)
    if reply:                                       # a retry of something already answered
        return message_view(user), message_view(reply)
    rate_limit(("ai_chat", str(student.id)), settings().ai_messages_per_minute)
    if selected_item_id:
        chosen = valid_item(db, offering, enrollment, selected_item_id)
        if action:                                  # the message is built from the lesson's title, not typed or searched
            question = ACTION_TEXT[action].replace("{title}", revision(db, chosen.id, "published").title)[:MAX_QUESTION_CHARS]
    if user is None:                                # keep the student's words even if the provider fails
        user = StudyMessage(conversation_id=conversation.id, role="user", content=question,
                            client_message_id=client_message_id)
        db.add(user)
        if not conversation.title:
            conversation.title = conversation_title(question)
        try:
            db.commit()
        except IntegrityError:                      # a simultaneous identical send won the race
            db.rollback()
            user, reply = existing_pair(db, conversation, client_message_id)
            if reply:
                return message_view(user), message_view(reply)
    subject = db.get(Subject, offering.subject_id)
    subject_name = f"{subject.code} {subject.title}"
    talk = None if action else smalltalk(question)
    if talk:                                         # a greeting is answered warmly with no provider call and no claims
        kind, lang = talk
        return message_view(user), message_view(finish(
            db, conversation, user, talk_reply(kind, lang, subject_name),
            suggestions=suggest(db, offering, enrollment, student.id, question, mode="starter")
            if kind != "thanks" else []))
    rows = retrieve_lesson(db, offering, selected_item_id) if action else retrieve(db, offering, enrollment, question, selected_item_id)
    history = [] if action else [{"role": m.role, "content": m.content} for m in messages_of(db, conversation, limit=10)[0]
                                 if m.id != user.id]
    if rows:
        prompt = build_messages(subject_name, rows, history, question, action)
        model = "simulator" if provider.simulated() else settings().groq_chat_model
        db.commit()                                 # no transaction is held during the slow call
        kind, content, evidence, analogy = grounded_reply(prompt, model, rows, want_analogy=action == "analogy")
        guard_new_message(db, student, offering_id)  # eligibility may have changed meanwhile
        if kind == "answer" and not sources_still_available(db, offering, enrollment, rows, list(evidence)):
            kind = "unsupported"                     # the material it relied on is no longer available to this student
        if kind == "answer":
            sources = source_metadata(db, offering.id, rows, list(evidence), evidence)
            if action == "analogy" and not analogy:
                content += NO_ANALOGY               # the explanation stands alone; no unchecked analogy is ever shown
        else:
            analogy = None
            content = {"none": NO_EXAMPLE if action == "example" else NOT_COVERED,
                       "assessment": ASSESSMENT_DECLINE}.get(kind, UNSUPPORTED)
            sources, model = [], None
    else:
        content, sources, model, analogy = (NO_TEXT if action else NOT_COVERED), [], None, None
    # not answered: stay honest, but point at the closest lessons so the student is never left with a dead end
    suggestions = [] if sources else suggest(db, offering, enrollment, student.id, question, rows)
    return message_view(user), message_view(finish(db, conversation, user, content, suggestions, sources, model, analogy))


def finish(db, conversation, user, content, suggestions=(), sources=(), model=None, analogy=None):
    """Store the assistant's reply to `user`; a simultaneous identical send that already got one wins."""
    assistant = StudyMessage(conversation_id=conversation.id, role="assistant", content=content,
                             sources=list(sources), suggestions=list(suggestions), analogy=analogy, model=model,
                             reply_to_id=user.id)
    db.add(assistant)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _, reply = existing_pair(db, conversation, user.client_message_id)
        if reply is None:
            raise
        return reply
    return assistant

