"""Turn pasted plain text into quiz questions, with errors reported by line.

Format (blocks are separated by a blank line; every part but the answer is optional):

    Q: Which of these is a legal business structure?
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

Choices make it multiple choice, an answer of True or False makes it true/false, anything else is short answer
(several accepted answers are separated by |). The parser never guesses: a problem block is skipped and reported."""
import re
import uuid
from decimal import Decimal, InvalidOperation

MAX_QUESTIONS = 100

CHOICE = re.compile(r"^\s*([A-Fa-f])\s*[.)]\s*(.+?)\s*$")
FIELD = re.compile(r"^\s*(answers?|ans|correct|points?|pts|why|explanation)\s*:\s*(.*?)\s*$", re.IGNORECASE)
LEAD = re.compile(r"^\s*(?:q(?:uestion)?\s*\d*\s*[:.)]|\d+\s*[.)])\s*", re.IGNORECASE)


def blocks(text):
    """[(first line number, [(line number, text)])] split on blank lines."""
    out, current = [], []
    for number, raw in enumerate(text.replace("\r\n", "\n").replace("\r", "\n").split("\n"), start=1):
        if raw.strip():
            current.append((number, raw))
        elif current:
            out.append(current)
            current = []
    if current:
        out.append(current)
    return out


def parse_block(lines):
    """(question dict | None, error message | None, line number of the problem)."""
    start = lines[0][0]
    prompt_parts, choices, fields = [], [], {}
    for number, raw in lines:
        field = FIELD.match(raw)
        choice = CHOICE.match(raw)
        if field:
            name = field.group(1).lower()
            key = "answer" if name in ("answer", "answers", "ans", "correct") else "points" if name in ("point", "points", "pts") else "why"
            if key in fields:
                return None, f"“{field.group(1)}” appears twice in this question.", number
            fields[key] = (field.group(2), number)
        elif choice and prompt_parts:
            choices.append((choice.group(1).upper(), choice.group(2), number))
        elif not choices and "answer" not in fields:
            prompt_parts.append(LEAD.sub("", raw, count=1).strip() if not prompt_parts else raw.strip())
        else:
            return None, f"Unexpected text after the answer or choices: “{raw.strip()[:40]}”.", number
    prompt = " ".join(p for p in prompt_parts if p).strip()
    if not prompt:
        return None, "This question has no text.", start
    if "answer" not in fields or not fields["answer"][0]:
        return None, "Add an “Answer:” line.", start
    answer, answer_line = fields["answer"]
    points = Decimal(1)
    if "points" in fields:
        try:
            points = Decimal(fields["points"][0])
        except InvalidOperation:
            return None, f"Points must be a number, not “{fields['points'][0]}”.", fields["points"][1]
        if points <= 0 or points > 1000:
            return None, "Points must be above zero.", fields["points"][1]
    base = {"key": str(uuid.uuid4()), "prompt": prompt, "explanation": fields.get("why", ("", 0))[0],
            "points": str(points), "source": None}
    if choices:
        letters = [c[0] for c in choices]
        if len(choices) < 2:
            return None, "A multiple-choice question needs at least two choices.", choices[0][2]
        if len(set(letters)) != len(letters):
            return None, "Each choice needs its own letter.", choices[0][2]
        if len(choices) > 6:
            return None, "Use at most six choices.", choices[0][2]
        pick = answer.strip().rstrip(".)").upper()
        if pick not in letters:
            return None, f"The answer “{answer}” is not one of the choices ({', '.join(letters)}).", answer_line
        ids = {letter: str(uuid.uuid4()) for letter in letters}
        return {**base, "type": "multiple_choice", "choices": [{"id": ids[l], "text": t} for l, t, _ in choices],
                "correct": ids[pick]}, None, 0
    if answer.strip().lower() in ("true", "false"):
        return {**base, "type": "true_false", "choices": [], "correct": answer.strip().lower() == "true"}, None, 0
    accepted = [a.strip() for a in answer.split("|") if a.strip()]
    if not accepted:
        return None, "Add at least one accepted answer.", answer_line
    return {**base, "type": "short_answer", "choices": [], "correct": accepted}, None, 0


def parse_questions(text):
    """{"questions": [...], "errors": [{"line", "message"}]}: valid blocks are returned, problem blocks are reported."""
    questions, errors = [], []
    found = blocks(text or "")
    if not found:
        return {"questions": [], "errors": [{"line": 1, "message": "Paste at least one question."}]}
    for lines in found:
        question, message, line = parse_block(lines)
        if message:
            errors.append({"line": line, "message": message})
        elif len(questions) >= MAX_QUESTIONS:
            errors.append({"line": lines[0][0], "message": f"Only {MAX_QUESTIONS} questions fit in one quiz."})
        else:
            questions.append(question)
    return {"questions": questions, "errors": errors}
