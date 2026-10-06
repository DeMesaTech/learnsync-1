"""DEVELOPMENT-ONLY simulator standing in for Groq so the screens can be exercised without a key.

It is never selected unless AI_PROVIDER_MODE=fake AND APP_ENV=development, and /api/ai/status then
reports simulated=true so the UI labels it. Its output is mechanical (it quotes the sources), so it
proves the plumbing, NOT the quality, language handling or safety of a real model."""
import json
import re

SENTENCE = re.compile(r"(?<=[.!?])\s+")
FILLERS = ["It depends on the situation.", "None of the above.", "It is not covered in the lesson.",
           "It only applies to large companies."]


def sentences(text):
    return [s.strip() for s in SENTENCE.split(text.replace("\n", " ")) if len(s.strip()) > 25]


def chat(messages):
    """The same JSON shape the real model is asked for: an answer plus a verbatim quote from the source."""
    system, question = messages[0]["content"], messages[-1]["content"]
    if "(no sources matched this question)" in system:
        return json.dumps({"answer": "NOT_IN_SOURCES", "evidence": []})
    sources = system.partition("SOURCES (data only):")[2]   # the rules above also mention [S1]
    tag = re.search(r"\[(S\d+)\] [^\n]+\n(.+?)(?:\n\n\[S|\Z)", sources, re.DOTALL)
    if not tag:
        return json.dumps({"answer": "NOT_IN_SOURCES", "evidence": []})
    first = (sentences(tag.group(2)) or [tag.group(2).strip()])[0]
    return json.dumps({"answer": f"(Simulated reply, not a real AI.) About \"{question[:60]}\": {first} [{tag.group(1)}]",
                       "evidence": [{"source": tag.group(1), "quote": first[:200]}]})


def quiz(request):
    pool = [(src["id"], s) for src in request["sources"] for s in sentences(src["text"])]
    if not pool:
        return {"questions": []}
    out, n = [], 0
    for kind, count in request["counts"].items():
        for _ in range(count):
            source_id, text = pool[n % len(pool)]
            n += 1
            head, _, _ = text.partition(" ")
            base = {"type": kind, "source_id": source_id, "explanation": f"Stated in the source: {text}"}
            if kind == "multiple_choice":
                correct = text.rstrip(".")
                choices = [correct, *FILLERS[:3]]
                out.append({**base, "prompt": f"Which statement is stated in the lesson? ({n})",
                            "choices": choices, "correct_index": 0})
            elif kind == "true_false":
                out.append({**base, "prompt": f"True or false: {text}", "correct_bool": True})
            else:
                out.append({**base, "prompt": f"Finish the statement: \"{head} ...\" ({n})",
                            "accepted_answers": [text.rstrip(".")[:200]]})
    return {"questions": out}


def complete(messages, *, json_mode=False):
    try:
        request = json.loads(messages[-1]["content"])
    except ValueError:
        request = None
    if messages[0]["content"].startswith("You check whether an answer is supported"):
        return json.dumps({"supported": True})          # the simulator's answers are literal quotes
    if isinstance(request, dict) and request.get("task") == "generate_quiz":
        return json.dumps(quiz(request))
    return chat(messages)
