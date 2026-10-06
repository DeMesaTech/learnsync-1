"""Read uploaded student lists and prospectus documents into plain rows.

Parsing is deliberately tolerant and never authoritative: results are previews/drafts that an
admin reviews before anything is created."""
import csv
import io
import re

import openpyxl
from docx import Document
from pypdf import PdfReader

from app.errors import fail

MAX_ROWS = 1000
MAX_LINES = 5000

STUDENT_HEADERS = {
    "student_number": {"student_number", "student_no", "student_id", "id_number", "id", "idno"},
    "email": {"email", "email_address", "e_mail"},
    "display_name": {"display_name", "name", "full_name", "student_name"},
    "section": {"section", "section_name", "class"},
}


def _norm(header):
    return re.sub(r"[^a-z0-9]+", "_", str(header or "").strip().lower()).strip("_")


def _cell(value):
    return "" if value is None else str(value).strip()


def read_student_rows(path, ext):
    """Return [{row, student_number, email, display_name, section}] with source row numbers."""
    if ext == ".csv":
        text = path.read_text(encoding="utf-8-sig")
        dialect = csv.excel_tab if text.count("\t") > text.count(",") else csv.excel
        table = list(csv.reader(io.StringIO(text), dialect))
    else:
        workbook = openpyxl.load_workbook(io.BytesIO(path.read_bytes()), read_only=True,
                                           data_only=True)
        table = [[_cell(c) for c in row] for row in workbook.worksheets[0].iter_rows(values_only=True)]
        workbook.close()
    table = [r for r in table if any(_cell(c) for c in r)]
    if not table:
        fail(422, "file_empty", "No rows were found in this file.")
    columns = {}
    for index, header in enumerate(table[0]):
        for field, names in STUDENT_HEADERS.items():
            if _norm(header) in names and field not in columns:
                columns[field] = index
    missing = [f for f in ("student_number", "email", "display_name") if f not in columns]
    if missing:
        fail(422, "columns_missing", "Missing required columns: " + ", ".join(missing)
             + ". Expected headers: student_number, email, display_name (optional: section).")
    if len(table) - 1 > MAX_ROWS:
        fail(422, "too_many_rows", f"Import at most {MAX_ROWS} students at a time.")
    rows = []
    for number, raw in enumerate(table[1:], start=2):
        rows.append({"row": number, **{
            f: _cell(raw[i]) if i < len(raw) else "" for f, i in columns.items()}})
        rows[-1].setdefault("section", "")
    return rows


# ---------- prospectus ----------

YEAR_WORDS = {"first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3,
              "fourth": 4, "4th": 4, "fifth": 5, "5th": 5}
SEM_WORDS = {"first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3}
YEAR_RE = re.compile(r"\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+year\b", re.IGNORECASE)
SEM_RE = re.compile(r"\b(first|second|third|1st|2nd|3rd)\s+(?:semester|sem|term)\b"
                    r"|\b(?:semester|sem|term)\s*([123])\b", re.IGNORECASE)
CODE = r"[A-Z]{2,6}[ \-]?\d{2,4}[A-Z]?"
ROW_RE = re.compile(rf"^\s*(?P<code>{CODE})\s+(?P<title>.+?)\s+(?P<units>\d{{1,2}}(?:\.\d)?)"
                    r"(?:\s+\d{1,3}(?:\.\d)?){0,3}\s*$")
LOOKS_LIKE_ROW = re.compile(rf"^\s*{CODE}\s+\S")


def read_lines(path, ext):
    if ext == ".pdf":
        reader = PdfReader(io.BytesIO(path.read_bytes()))
        lines = [ln for page in reader.pages for ln in (page.extract_text() or "").splitlines()]
    elif ext == ".docx":
        doc = Document(io.BytesIO(path.read_bytes()))
        lines = [p.text for p in doc.paragraphs]
        for table in doc.tables:
            lines += [" ".join(c.text.strip() for c in row.cells if c.text.strip())
                      for row in table.rows]
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
    for line in lines:
        if m := YEAR_RE.search(line):
            year = YEAR_WORDS[m.group(1).lower()]
        if m := SEM_RE.search(line):
            sem = SEM_WORDS.get((m.group(1) or "").lower()) or int(m.group(2))
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
