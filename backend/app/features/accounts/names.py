import re
from dataclasses import dataclass

_SUFFIXES = {
    "JR": "Jr",
    "JUNIOR": "Jr",
    "SR": "Sr",
    "SENIOR": "Sr",
    "II": "II",
    "III": "III",
    "IV": "IV",
    "V": "V",
    "VI": "VI",
    "VII": "VII",
    "VIII": "VIII",
    "IX": "IX",
    "X": "X",
    "XI": "XI",
    "XII": "XII",
    "XIII": "XIII",
    "XIV": "XIV",
    "XV": "XV",
    "XVI": "XVI",
    "XVII": "XVII",
    "XVIII": "XVIII",
    "XIX": "XIX",
    "XX": "XX",
    "2ND": "II",
    "3RD": "III",
    "4TH": "IV",
    "5TH": "V",
    "6TH": "VI",
    "7TH": "VII",
    "8TH": "VIII",
    "9TH": "IX",
    "10TH": "X",
}
_SURNAME_PARTICLES = (
    ("DE", "LA"),
    ("DE", "LOS"),
    ("DE", "LAS"),
    ("DELA",),
    ("DELOS",),
    ("DELAS",),
    ("DEL",),
    ("DE",),
    ("SAN",),
    ("SANTA",),
    ("VAN",),
    ("VON",),
)
_FACULTY_HONORIFICS = {
    "MR", "MRS", "MS", "MISS", "DR", "ATTY", "ATTORNEY", "PROF", "ENGR",
}


@dataclass(frozen=True)
class StudentName:
    first_name: str
    middle_name: str
    last_name: str
    suffix: str


def _clean(value: str | None) -> str:
    return " ".join((value or "").replace(",", " ").split()).strip()


def _suffix(value: str) -> str:
    return _SUFFIXES.get(re.sub(r"[^A-Z0-9]", "", value.upper()), "")


def canonical_suffix(value: str | None) -> str:
    return _suffix(value or "")


def _take_suffix(tokens: list[str]) -> tuple[list[str], str]:
    if tokens and (suffix := _suffix(tokens[-1])):
        return tokens[:-1], suffix
    return tokens, ""


def suffix_from_last_name(last_name: str) -> tuple[str, str]:
    tokens = last_name.split()
    tokens, suffix = _take_suffix(tokens)
    return " ".join(tokens), suffix


def format_student_name(name: StudentName) -> str:
    first = _clean(name.first_name).upper()
    last = _clean(name.last_name).upper()
    middle_initials = " ".join(
        f"{part[0].upper()}." for part in _clean(name.middle_name).split() if part
    )
    given = " ".join(part for part in (first, middle_initials) if part)
    formatted = f"{last}, {given}" if last and given else last or given
    suffix = _suffix(name.suffix) if name.suffix else ""
    if suffix:
        formatted = f"{formatted}, {suffix}"
    return formatted


def split_student_name(value: str) -> StudentName:
    """Split a roster name, preferring explicit comma separation and common surname particles."""
    name = " ".join(value.strip().split())
    if not name:
        return StudentName("", "", "", "")

    comma_parts = [part.strip() for part in name.split(",")]
    if len(comma_parts) > 1:
        last_name, given_parts = comma_parts[0], comma_parts[1:]
        given_tokens, suffix = _take_suffix(" ".join(given_parts).split())
        first_name = given_tokens[0] if given_tokens else ""
        middle_name = " ".join(given_tokens[1:])
        last_name, last_suffix = suffix_from_last_name(last_name)
        return StudentName(first_name, middle_name, last_name, suffix or last_suffix)

    tokens, suffix = _take_suffix(name.split())
    if not tokens:
        return StudentName("", "", "", suffix)

    surname_start = len(tokens) - 1
    upper_tokens = [token.upper().rstrip(".") for token in tokens]
    for particle in sorted(_SURNAME_PARTICLES, key=len, reverse=True):
        particle_start = len(tokens) - len(particle) - 1
        if particle_start >= 1 and tuple(upper_tokens[particle_start:-1]) == particle:
            surname_start = particle_start
            break

    first_name = tokens[0]
    middle_name = " ".join(tokens[1:surname_start])
    last_name = " ".join(tokens[surname_start:])
    last_name, last_suffix = suffix_from_last_name(last_name)
    return StudentName(first_name, middle_name, last_name, suffix or last_suffix)


def _is_faculty_honorific(token: str) -> bool:
    return re.sub(r"[^A-Z]", "", token.upper()) in _FACULTY_HONORIFICS


def normalize_faculty_name_parts(name: StudentName) -> StudentName | None:
    first_tokens = _clean(name.first_name).split()
    middle_tokens = _clean(name.middle_name).split()
    removed_honorific = False
    while first_tokens and _is_faculty_honorific(first_tokens[0]):
        first_tokens.pop(0)
        removed_honorific = True

    if not first_tokens:
        if not removed_honorific:
            return None
        while middle_tokens and _is_faculty_honorific(middle_tokens[0]):
            middle_tokens.pop(0)
        if not middle_tokens or len(re.sub(r"[^A-Za-z]", "", middle_tokens[0])) < 2:
            return None
        first_tokens.append(middle_tokens.pop(0))

    last_name, detected_suffix = suffix_from_last_name(_clean(name.last_name))
    suffix = name.suffix or detected_suffix
    attached_initial = re.fullmatch(r"([A-Za-z])\.([A-Za-z][A-Za-z'-]*)", last_name)
    if attached_initial:
        initial = f"{attached_initial.group(1).upper()}."
        last_name = attached_initial.group(2)
        if not any(token.upper().rstrip(".") == initial.rstrip(".")
                   for token in middle_tokens):
            middle_tokens.append(initial)

    first_name = " ".join(first_tokens)
    middle_name = " ".join(middle_tokens)
    if not first_name or not last_name:
        return None
    return StudentName(first_name, middle_name, last_name, suffix)


def split_faculty_name(value: str) -> StudentName:
    """Split a faculty name while excluding leading titles from its name parts."""
    return normalize_faculty_name_parts(split_student_name(value)) or StudentName("", "", "", "")


def normalized_name(value: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.casefold()).split())
