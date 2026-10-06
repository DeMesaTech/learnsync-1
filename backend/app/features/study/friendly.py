"""The warm, non-factual side of study help: greetings, thanks, "what can you do", and lesson suggestions.

Nothing here states a fact about the subject or about the world, and nothing here calls the AI provider: a greeting
costs no tokens and cannot hallucinate. Suggestions are only titles of lessons this student may already open
(published, not archived, targeted at their section), built from the database at reply time and never from model text.
They are kept apart from citations on purpose: a suggestion says "you might look here", never "this is where it came from"."""
import re

from app.features.study.retrieval import query_tokens
from app.features.teaching.items import completed_lessons, ordered_published

GREETINGS = frozenset(["hi", "hello", "hey", "heyy", "hiya", "yo", "howdy", "greetings", "sup", "good", "morning", "afternoon", "evening", "day", "kumusta", "kamusta", "musta", "mabuhay", "magandang", "umaga", "hapon", "gabi", "araw", "uy", "hoy"])
THANKS = frozenset(["thanks", "thank", "thankyou", "thx", "ty", "salamat", "maraming"])
FILLER = frozenset(["there", "po", "opo", "everyone", "all", "you", "u", "how", "are", "is", "was", "it", "going", "doing", "today", "ka", "na", "ko", "kayo", "ang", "mo", "helper", "bot", "assistant", "buddy", "study", "ai", "friend", "pre", "sir", "ma'am", "maam", "very", "much", "so", "a", "lot", "much", "thank", "much!", "again"])
FILIPINO = frozenset(["kumusta", "kamusta", "musta", "mabuhay", "magandang", "umaga", "hapon", "gabi", "araw", "uy", "hoy", "salamat", "maraming", "po", "opo", "ka", "na", "ko", "kayo", "mo", "ang", "sino", "ano", "paano", "tulong", "kaya"])
ABOUT = re.compile(r"^(who are you|what are you|what can you do|what do you do|how do you work|how can you help( me)?|"
                   r"can you help( me)?|help( me)?|sino ka|ano ka|ano ang kaya mo|ano kaya mo|paano ka gumagana|"
                   r"matutulungan mo ba ako|tulong|tulungan mo ako)$")


HOW_ARE_YOU = re.compile(r"^(how are you( doing)?|how's it going|how is it going)( today)?$|^(kumusta|kamusta) (ka|na)( po)?$")


def words(text):
    return re.findall(r"[a-zñ']+", text.casefold())


def smalltalk(question):
    """("greeting" | "thanks" | "about", "en" | "fil") for a short message that is only pleasantries, else None.
    A message that carries any other word (a topic, a question) is a real question and goes through the sources."""
    tokens = words(question)
    if not tokens or len(tokens) > 8:
        return None
    lang = "fil" if any(t in FILIPINO for t in tokens) else "en"
    flat = " ".join(tokens)
    if ABOUT.match(flat):
        return "about", lang
    if HOW_ARE_YOU.match(flat):
        return "greeting", lang
    known = GREETINGS | THANKS | FILLER
    if all(t in known for t in tokens):
        if any(t in THANKS for t in tokens):
            return "thanks", lang
        if any(t in GREETINGS for t in tokens):
            return "greeting", lang
    return None


TEXTS = {
    ("greeting", "en"): "Hi there! 👋 I'm your study buddy for {subject}. Ask me about any lesson or topic and I'll "
                        "explain it using the materials your teacher published, and show you where each answer came "
                        "from. Not sure where to start? Here are some lessons you could ask about:",
    ("greeting", "fil"): "Kumusta! 👋 Ako ang study buddy mo sa {subject}. Magtanong ka tungkol sa kahit anong lesson o "
                         "paksa, at sasagutin ko gamit ang mga published materials ng guro mo, at ipapakita ko kung "
                         "saan galing ang sagot. Hindi sigurado kung saan magsisimula? Narito ang ilang lesson na "
                         "pwede mong itanong:",
    ("thanks", "en"): "You're welcome! 😊 Ask me anything else about {subject}, any time.",
    ("thanks", "fil"): "Walang anuman! 😊 Magtanong ka lang ulit kung may gusto kang maunawaan sa {subject}.",
    ("about", "en"): "I'm a study helper for {subject}. I read the lessons, files and links your teacher published, "
                     "explain them in plain words (English, Filipino or Taglish) and show you the passages I used. I "
                     "can't see your grades and I can't give answers to graded work, but I'm glad to help you understand "
                     "the ideas. You could start with one of these lessons:",
    ("about", "fil"): "Ako ang study helper mo sa {subject}. Binabasa ko ang mga lesson, file at link na in-publish ng "
                      "guro mo, ipinapaliwanag ko ito sa simpleng salita (English, Filipino o Taglish), at ipinapakita ko "
                      "ang mga bahaging pinagbatayan ko. Hindi ko nakikita ang mga grade mo at hindi ako nagbibigay ng "
                      "sagot sa graded work, pero tutulungan kitang maunawaan ang mga ideya. Pwede kang magsimula sa "
                      "isa sa mga lesson na ito:",
}


def talk_reply(kind, lang, subject):
    return TEXTS[(kind, lang)].replace("{subject}", subject)


def title_matches(tokens, title):
    pieces = words(title)
    return any(w == t or (len(w) >= 5 and len(t) >= 5 and (t.startswith(w[:5]) or w.startswith(t[:5])))
               for w in tokens for t in pieces)


def suggest(db, offering, enrollment, student_id, question, rows=(), mode="closest", limit=3):
    """Up to `limit` lessons worth opening. mode "starter" (greetings): the next lessons in the student's sequence.
    mode "closest" (no answer): lessons behind the retrieved passages, then titles that share words with the
    question, then the next lessons in the sequence. Each carries a short, honest reason."""
    ordered = ordered_published(db, offering, enrollment)
    available = {item.id: (item, rev) for item, rev, _ in ordered}
    done = completed_lessons(db, student_id)
    picks = []

    def add(item_id, why):
        if item_id in available and len(picks) < limit and item_id not in [p[0] for p in picks]:
            picks.append((item_id, why))
    if mode == "closest":
        for row in rows:
            add(row.item_id, "Related to your question")
        tokens = query_tokens(question)
        for item, rev, _ in ordered:
            if title_matches(tokens, rev.title):
                add(item.id, "The title matches your question")
    for item, _, _ in ordered:
        if item.kind == "lesson" and item.id not in done:
            add(item.id, "Next in your lessons")
    for item, _, _ in ordered:
        add(item.id, "From your lessons")
    related = {"Related to your question", "The title matches your question"}
    return [{"item_id": str(i), "title": available[i][1].title, "why": why,
             "kind": "related" if why in related else "sequence",     # the page labels the two honestly and differently
             "link": f"/student/offerings/{offering.id}/lessons/{i}"} for i, why in picks]
