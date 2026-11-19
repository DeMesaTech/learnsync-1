from pathlib import Path

import openpyxl

from app.features.accounts.faculty_name_correction import plan_faculty_name_correction
from app.features.accounts.name_backfill import _source_names, plan_account_name_backfill
from app.features.accounts.names import (
    StudentName,
    format_student_name,
    normalize_faculty_name_parts,
    split_faculty_name,
    split_student_name,
)
from app.features.accounts.schemas import FacultyProfileUpdate, Invite


def test_student_name_formats_middle_initial_and_suffix():
    name = split_student_name("JUAN ALVARO DELA CRUZ JR.")

    assert name == StudentName("JUAN", "ALVARO", "DELA CRUZ", "Jr")
    assert format_student_name(name) == "DELA CRUZ, JUAN A., Jr"


def test_student_name_splits_multiple_middle_names_and_compound_particles():
    name = split_student_name("ANA MARIA JOSE DE LA CRUZ")

    assert name == StudentName("ANA", "MARIA JOSE", "DE LA CRUZ", "")
    assert format_student_name(name) == "DE LA CRUZ, ANA M. J."


def test_student_name_parses_existing_last_first_format():
    name = split_student_name("Dela Cruz, Juan Alvaro, Jr.")

    assert name == StudentName("Juan", "Alvaro", "Dela Cruz", "Jr")
    assert format_student_name(name) == "DELA CRUZ, JUAN A., Jr"


def test_student_name_recognizes_generational_suffixes():
    assert split_student_name("JUAN SANTOS SR").suffix == "Sr"
    assert split_student_name("JUAN SANTOS III").suffix == "III"
    assert split_student_name("JUAN SANTOS 4th").suffix == "IV"


def test_student_name_formats_a_pre_split_last_first_value():
    name = split_student_name("DELA CRUZ, JUAN A., Jr")

    assert name == StudentName("JUAN", "A.", "DELA CRUZ", "Jr")
    assert format_student_name(name) == "DELA CRUZ, JUAN A., Jr"


def test_faculty_name_removes_title_and_recovers_attached_surname_initial():
    name = split_faculty_name("MRS. TERESA D.MARFILLA")
    comma_name = split_faculty_name("DELA CRUZ, MS. JUAN ALVARO, Jr")

    assert name == StudentName("TERESA", "D.", "MARFILLA", "")
    assert format_student_name(name) == "MARFILLA, TERESA D."
    assert comma_name == StudentName("JUAN", "ALVARO", "DELA CRUZ", "Jr")


def test_faculty_name_promotes_full_given_name_from_existing_middle_field():
    name = normalize_faculty_name_parts(
        StudentName("MS.", "MARICEL ALVARO", "ADAN", ""))

    assert name == StudentName("MARICEL", "ALVARO", "ADAN", "")


def test_faculty_name_leaves_ambiguous_initial_for_review():
    name = normalize_faculty_name_parts(StudentName("MS.", "T.", "MARFILLA", ""))

    assert name is None


def test_faculty_name_does_not_infer_a_missing_first_name_without_a_title():
    name = normalize_faculty_name_parts(StudentName("", "MARICEL", "ADAN", ""))

    assert name is None


def test_faculty_invite_and_profile_strip_honorifics():
    invitation = Invite(
        email="teacher@example.com",
        display_name="MRS. TERESA D.MARFILLA",
        role="faculty",
    )
    profile = FacultyProfileUpdate(
        display_name="MRS. TERESA D.MARFILLA",
        email="teacher@example.com",
        college_id=None,
    )

    assert invitation.display_name == "MARFILLA, TERESA D."
    assert profile.display_name == "MARFILLA, TERESA D."


def test_faculty_name_plan_updates_deterministic_names_only():
    def account(role, first, middle, last, display):
        return type("AccountRow", (), {
            "role": role,
            "first_name": first,
            "middle_name": middle,
            "last_name": last,
            "suffix": None,
            "display_name": display,
        })()

    affected = account("faculty", "MR.", "JAMES PETER", "ARMENTA", "ARMENTA, MR. J. P.")
    demo = account("faculty", "FACULTY", "", "DEMO", "DEMO, FACULTY")
    rows = [affected, demo]

    class Result:
        def all(self):
            return rows

    class Session:
        def scalars(self, _query):
            return Result()

    plan, counts = plan_faculty_name_correction(Session())

    assert counts == {
        "faculty_accounts": 2,
        "changed": 1,
        "unchanged": 1,
        "unresolved": 0,
    }
    assert plan == [(affected, StudentName("JAMES", "PETER", "ARMENTA", ""))]


def test_name_source_keeps_duplicate_student_number_variants(tmp_path: Path):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(["Student Number", "firstName", "Middle Initial", "lastName"])
    sheet.append(["S-1", "Ana", "M.", "Cruz"])
    sheet.append(["S-1", "Ana", "Maria", "Cruz"])
    path = tmp_path / "roster.xlsx"
    workbook.save(path)

    names, conflicts, duplicates = _source_names(path)

    assert len(names["S-1"]) == 2
    assert conflicts == {"S-1"}
    assert duplicates == 1


def test_account_name_backfill_uses_exact_student_source_then_fallback(tmp_path: Path):
    class Rows:
        def all(self):
            return accounts

    class Session:
        def scalars(self, _query):
            return Rows()

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(["Student Number", "firstName", "Middle Initial", "lastName"])
    sheet.append(["S-1", "Juan", "Alvaro", "Dela Cruz Jr."])
    source = tmp_path / "roster.xlsx"
    workbook.save(source)

    def account(role, number, name):
        return type("AccountRow", (), {
            "role": role,
            "student_number": number,
            "display_name": name,
            "first_name": None,
            "middle_name": None,
            "last_name": None,
            "suffix": None,
        })()

    accounts = [
        account("student", "S-1", "Juan Alvaro Dela Cruz Jr."),
        account("student", "S-2", "MARIA LUZ DE LOS SANTOS SR."),
        account("faculty", None, "ANA MARIA DELA CRUZ"),
    ]

    plan, counts = plan_account_name_backfill(Session(), source)

    assert counts["source_exact"] == 1
    assert counts["fallback_parsed"] == 2
    assert counts["unparsed"] == 0
    assert [format_student_name(name) for _, name, _ in plan] == [
        "DELA CRUZ, JUAN A., Jr",
        "DE LOS SANTOS, MARIA L., Sr",
        "DELA CRUZ, ANA M.",
    ]
