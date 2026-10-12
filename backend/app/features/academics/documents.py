"""Read uploaded student lists and prospectus documents into plain rows.

Parsing is deliberately tolerant and never authoritative: results are previews/drafts that an
admin reviews before anything is created."""
import csv
import io
import re

import openpyxl
from docx import Document
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph
from pypdf import PdfReader

from app.errors import fail

MAX_ROWS = 1000
MAX_LINES = 5000

STUDENT_HEADERS = {
    "student_number": {"student_number", "student_no", "student_id", "id_number", "id", "idno"},
    "email": {"email", "email_address", "e_mail"},
    "display_name": {"display_name", "name", "full_name", "student_name"},
    "first_name": {"first_name", "firstname", "given_name"},
    "middle_initial": {"middle_initial", "middleinitial", "middle_name"},
    "last_name": {"last_name", "lastname", "surname"},
    "section": {"section", "section_name", "class"},
}
FACULTY_HEADERS = {
    "email": {"email", "email_address", "e_mail"},
    "display_name": {"display_name", "name", "full_name", "teacher_name", "faculty_name"},
}


def _norm(header):
    return re.sub(r"[^a-z0-9]+", "_", str(header or "").strip().lower()).strip("_")


def _cell(value):
    return "" if value is None else str(value).strip()


def _student_columns(header):
    columns = {}
    for index, value in enumerate(header):
        for field, names in STUDENT_HEADERS.items():
            if _norm(value) in names and field not in columns:
                columns[field] = index
    return columns


def _student_columns_missing(columns):
    missing = [field for field in ("student_number", "email") if field not in columns]
    if "display_name" not in columns and not {"first_name", "last_name"} <= columns.keys():
        missing.append("display_name or first_name and last_name")
    return missing


def _student_row(raw, columns, number, source_sheet=None, source_row=None):
    values = {field: _cell(raw[index]) if index < len(raw) else ""
              for field, index in columns.items()}
    if not values.get("display_name"):
        values["display_name"] = " ".join(
            re.sub(r"\s+", " ", values.get(field, "")).strip(" ,")
            for field in ("first_name", "middle_initial", "last_name")
            if values.get(field, "").strip(" ,"))
    row = {"row": number, **values}
    row.setdefault("section", "")
    if source_sheet is not None:
        row["source_sheet"] = source_sheet
        row["source_row"] = source_row
    return row


def _append_student_row(rows, raw, columns, source_sheet=None, source_row=None):
    if not any(_cell(value) for value in raw):
        return
    rows.append(_student_row(raw, columns, len(rows) + 2, source_sheet, source_row))
    if len(rows) > MAX_ROWS:
        fail(422, "too_many_rows", f"Import at most {MAX_ROWS} students at a time.")


def read_student_rows(path, ext):
    """Return [{row, student_number, email, display_name, section}] with source row numbers."""
    rows = []
    if ext == ".csv":
        text = path.read_text(encoding="utf-8-sig")
        dialect = csv.excel_tab if text.count("\t") > text.count(",") else csv.excel
        table = list(csv.reader(io.StringIO(text), dialect))
        table = [row for row in table if any(_cell(value) for value in row)]
        if not table:
            fail(422, "file_empty", "No rows were found in this file.")
        columns = _student_columns(table[0])
        missing = _student_columns_missing(columns)
        if missing:
            fail(422, "columns_missing", "Missing required columns: " + ", ".join(missing)
                 + ". Expected student_number and email, plus display_name or first_name and "
                   "last_name (optional: middle_initial and section).")
        for source_row, raw in enumerate(table[1:], start=2):
            _append_student_row(rows, raw, columns, source_row=source_row)
    else:
        workbook = openpyxl.load_workbook(io.BytesIO(path.read_bytes()), read_only=True,
                                           data_only=True)
        try:
            for sheet in workbook.worksheets:
                header_rows = []
                for index, raw in enumerate(sheet.iter_rows(values_only=True)):
                    if index == 25:
                        break
                    header_rows.append([_cell(value) for value in raw])
                if not any(any(row) for row in header_rows):
                    continue
                header_index = next((index for index, header in enumerate(header_rows)
                                     if not _student_columns_missing(
                                         _student_columns(header))), None)
                if header_index is None:
                    fail(422, "columns_missing",
                         f"Worksheet {sheet.title} is missing the required student number, "
                         "email, and name columns.")
                columns = _student_columns(header_rows[header_index])
                start_row = header_index + 2
                for source_row, raw in enumerate(
                        sheet.iter_rows(min_row=start_row, values_only=True), start=start_row):
                    _append_student_row(rows, raw, columns, sheet.title, source_row)
        finally:
            workbook.close()
    if not rows:
        fail(422, "file_empty", "No student rows were found in this file.")
    return rows


def read_faculty_rows(path, ext):
    """Return [{row, email, display_name}] with source row numbers."""
    if ext == ".csv":
        text = path.read_text(encoding="utf-8-sig")
        dialect = csv.excel_tab if text.count("\t") > text.count(",") else csv.excel
        table = list(csv.reader(io.StringIO(text), dialect))
    else:
        workbook = openpyxl.load_workbook(io.BytesIO(path.read_bytes()), read_only=True,
                                           data_only=True)
        table = [[_cell(c) for c in row] for row in workbook.worksheets[0].iter_rows(values_only=True)]
        workbook.close()
    table = [row for row in table if any(_cell(cell) for cell in row)]
    if not table:
        fail(422, "file_empty", "No rows were found in this file.")
    columns = {}
    for index, header in enumerate(table[0]):
        for field, names in FACULTY_HEADERS.items():
            if _norm(header) in names and field not in columns:
                columns[field] = index
    missing = [field for field in ("email", "display_name") if field not in columns]
    if missing:
        fail(422, "columns_missing", "Missing required columns: " + ", ".join(missing)
             + ". Expected headers: email, display_name.")
    if len(table) - 1 > MAX_ROWS:
        fail(422, "too_many_rows", f"Import at most {MAX_ROWS} teachers at a time.")
    rows = []
    for number, raw in enumerate(table[1:], start=2):
        rows.append({"row": number, **{
            field: _cell(raw[index]) if index < len(raw) else ""
            for field, index in columns.items()}})
    if not rows:
        fail(422, "file_empty", "No teacher rows were found in this file.")
    return rows


# ---------- prospectus ----------

YEAR_WORDS = {"first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3,
              "fourth": 4, "4th": 4, "fifth": 5, "5th": 5}
SEM_WORDS = {"first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3}
YEAR_RE = re.compile(r"\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+year\b", re.IGNORECASE)
SEM_RE = re.compile(r"\b(first|second|third|1st|2nd|3rd)\s+(?:semester|sem|term)\b"
                    r"|\b(?:semester|sem|term)\s*([123])\b", re.IGNORECASE)
CODE = r"[A-Z]{1,6}(?:[ \-][A-Z]{1,6}){0,2}[ \-]?\d{1,4}[A-Z]?"
ROW_RE = re.compile(rf"^\s*(?P<code>{CODE})\s+(?P<title>.+?)\s+(?P<units>\d{{1,2}}(?:\.\d)?)"
                    r"(?:\s+\d{1,3}(?:\.\d)?){0,3}\s*$", re.IGNORECASE)
LOOKS_LIKE_ROW = re.compile(rf"^\s*{CODE}\s+\S", re.IGNORECASE)
TABLE_BOUNDARY = "\x00PROSPECTUS_TABLE_BOUNDARY\x00"


def read_lines(path, ext):
    if ext == ".pdf":
        reader = PdfReader(io.BytesIO(path.read_bytes()))
        lines = [ln for page in reader.pages for ln in (page.extract_text() or "").splitlines()]
    elif ext == ".docx":
        doc = Document(io.BytesIO(path.read_bytes()))
        lines = []
        for child in doc.element.body.iterchildren():
            if isinstance(child, CT_P):
                lines.append(Paragraph(child, doc).text)
            elif isinstance(child, CT_Tbl):
                lines.append(TABLE_BOUNDARY)
                rows = Table(child, doc).rows
                header = [_norm(cell.text) for cell in rows[0].cells] if rows else []
                columns = {name: header.index(name) for name in
                           ("subject_code", "descriptive_title", "units") if name in header}
                if len(columns) == 3:
                    for row in rows[1:]:
                        cells = [cell.text.strip() for cell in row.cells]
                        lines.append(" ".join(cells[columns[name]] for name in
                                              ("subject_code", "descriptive_title", "units")))
                else:
                    lines.extend(" ".join(cell.text.strip() for cell in row.cells
                                          if cell.text.strip()) for row in rows)
    elif ext == ".xlsx":
        workbook = openpyxl.load_workbook(io.BytesIO(path.read_bytes()), read_only=True,
                                           data_only=True)
        lines = [" ".join(_cell(c) for c in row if _cell(c))
                 for sheet in workbook.worksheets for row in sheet.iter_rows(values_only=True)]
        workbook.close()
    else:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    return [re.sub(r"\s+", " ", ln).strip() for ln in lines[:MAX_LINES] if ln.strip()]


def parse_prospectus(lines):
    """Best-effort subject draft: [{code,title,units,year_level,semester}], plus warnings."""
    draft, warnings, year, sem = [], [], None, None
    table_year_seen = table_semester_seen = False
    for line in lines:
        if line == TABLE_BOUNDARY:
            if not (table_year_seen and table_semester_seen):
                year = sem = None
            table_year_seen = table_semester_seen = False
            continue
        if m := YEAR_RE.search(line):
            year = YEAR_WORDS[m.group(1).lower()]
            table_year_seen = True
        if m := SEM_RE.search(line):
            sem = SEM_WORDS.get((m.group(1) or "").lower()) or int(m.group(2))
            table_semester_seen = True
        if m := ROW_RE.match(line):
            draft.append({"code": re.sub(r"\s+", " ", m["code"]).upper(), "title": m["title"],
                          "units": m["units"], "year_level": year, "semester": sem})
        elif LOOKS_LIKE_ROW.match(line):
            warnings.append(f"Could not read: {line[:120]}")
    if not draft:
        warnings.append("No subjects were recognised. Add them manually below.")
    elif any(r["year_level"] is None or r["semester"] is None for r in draft):
        warnings.append("Some subjects have no year level/semester; confirm them in review.")
    return draft, warnings
