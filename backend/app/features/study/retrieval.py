"""Permission-scoped retrieval of published teaching content for the study assistant.

Allow-list by construction: only `content_chunk` rows exist for learning items (lessons, files,
approved references). Every query additionally requires the chunk's revision to be the item's
CURRENT published revision, the item not archived, the item in the offering, and the student's
teaching section to be targeted. Quizzes, answer keys, explanations, submissions, scores and
grades are not in this table and are never joined."""
import re

from sqlalchemy import text

from app.features.teaching.access import targeted
from app.features.teaching.items import section_ids_of
from app.features.teaching.models import LearningItem

MAX_CHUNKS = 5
CONTEXT_BUDGET = 8_000   # the provider allows only 8,000 tokens a minute: lean requests let more students ask

_STOP_TEXT = """
a an the and or of to in on for is are was were be been what how why when which who whom this that
these those i you me my your it its as at by with from about do does did can could would should
please explain tell give show us we our they them their there here if then than so not no yes
ng sa ang mga ay na o para ako ikaw ka mo ko ito iyan iyon po ba naman din rin lang kung paano
bakit ano alin sino kailan pwede puwede nga yung yong ung dito diyan doon kasi pero
"""
STOP = frozenset(_STOP_TEXT.split())


def query_tokens(question):
    words = re.findall(r"[^\W_]{3,}", question.casefold())
    seen, out = set(), []
    for w in words:
        if w not in STOP and w not in seen:
            seen.add(w)
            out.append(w)
    return out[:12]


SEARCH = text("""
    SELECT c.id, c.item_id, c.revision_id, c.title, c.locator, c.text, c.anchor_node_id,
           ts_rank_cd(c.tsv, q.query) AS rank
    FROM content_chunk c
    JOIN learning_item_revision r ON r.id = c.revision_id AND r.state = 'published'
    JOIN learning_item i ON i.id = c.item_id AND i.archived = false AND i.offering_id = :offering,
         to_tsquery('simple', :query) AS q(query)
    WHERE c.offering_id = :offering AND c.tsv @@ q.query
    ORDER BY rank DESC, c.item_id, c.ordinal
    LIMIT 60""")

OF_ITEM = text("""
    SELECT c.id, c.item_id, c.revision_id, c.title, c.locator, c.text, c.anchor_node_id,
           0.0 AS rank
    FROM content_chunk c
    JOIN learning_item_revision r ON r.id = c.revision_id AND r.state = 'published'
    JOIN learning_item i ON i.id = c.item_id AND i.archived = false AND i.offering_id = :offering
    WHERE c.offering_id = :offering AND c.item_id = :item
    ORDER BY c.ordinal LIMIT 6""")


def retrieve_lesson(db, offering, item_id):
    """Only this lesson's own published passages (the caller has already checked the student may open it)."""
    picked, used = [], 0
    for row in db.execute(OF_ITEM, {"offering": offering.id, "item": item_id}):
        if len(picked) >= MAX_CHUNKS or used + len(row.text) > CONTEXT_BUDGET:
            break
        picked.append(row)
        used += len(row.text)
    return picked


def retrieve(db, offering, enrollment, question, selected_item_id=None):
    """Up to 8 chunks (about 12,000 characters) the student is allowed to learn from."""
    tokens = query_tokens(question)
    rows = []
    if tokens:
        rows = list(db.execute(SEARCH, {"offering": offering.id, "query": " | ".join(tokens)}))
    if selected_item_id:   # an explicitly chosen lesson guides retrieval
        chosen = [r for r in db.execute(OF_ITEM, {"offering": offering.id,
                                                  "item": selected_item_id})]
        rows = chosen + [r for r in rows if r.item_id != selected_item_id][:MAX_CHUNKS]
    allowed, cache = [], {}
    for row in rows:
        if row.item_id not in cache:
            item = db.get(LearningItem, row.item_id)
            cache[row.item_id] = targeted(section_ids_of(db, item.id), enrollment)
        if cache[row.item_id]:
            allowed.append(row)
    title_hits = {w for w in tokens}
    allowed.sort(key=lambda r: -(float(r.rank) + 0.1 * sum(w in r.title.casefold() for w in title_hits)
                                 + (1.0 if r.item_id == selected_item_id else 0)))
    picked, used = [], 0
    for row in allowed:
        if len(picked) >= MAX_CHUNKS or used + len(row.text) > CONTEXT_BUDGET:
            continue
        picked.append(row)
        used += len(row.text)
    return picked
