"""Quiz answer checking. Pure functions: no database, no AI, no fuzzy matching."""
import re
import unicodedata
from decimal import Decimal


def normalize_text(value):
    """Unicode-normalise, trim, collapse whitespace, compare case-insensitively."""
    text = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"\s+", " ", text).strip().casefold()


def truthy(value):
    """True/False answers arrive as booleans (or the strings 'true'/'false')."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in {"true", "false"}:
        return value.strip().lower() == "true"
    return None


def is_correct(question, response):
    """question: object/dict with .type and .correct; a missing response is simply wrong."""
    kind, correct = question.type, question.correct
    if response is None:
        return False
    if kind == "multiple_choice":
        return isinstance(response, str) and response == correct
    if kind == "true_false":
        given = truthy(response)
        return given is not None and given == correct
    if kind == "short_answer":
        accepted = {normalize_text(a) for a in (correct or []) if normalize_text(a)}
        return normalize_text(response) in accepted
    return False


def points_for(question, response):
    """All-or-nothing per question."""
    return Decimal(question.points) if is_correct(question, response) else Decimal(0)
