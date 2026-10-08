"""Attendance as a file: one row per student, one column per RECORDED date, then totals.

Only dates with an attendance record are listed (a day nobody recorded is not a class day the school can vouch for),
and a student who has not been marked on a recorded date is blank, never absent. XLSX reuses the grade renderer; the
PDF splits a long range across several tables so the cells stay readable."""
from collections import Counter
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select

from app.errors import fail
from app.features.academics.models import AcademicTerm, OfferingSection, Section, Subject
from app.features.accounts.models import now
from app.features.assessments.attendance import section_roster
from app.features.assessments.models import AttendanceMark, AttendanceSession

from .tables import NOT_OFFICIAL, local_stamp

LETTER = {"present": "P", "late": "L", "absent": "A", "excused": "E"}
SUMMARY = ["Present", "Late", "Absent", "Excused", "Not marked"]
DATES_PER_TABLE = 18


def attendance_table(db, actor, offering, section_id, start, end):
    section = db.scalar(select(Section).join(OfferingSection, OfferingSection.section_id == Section.id)
                        .where(OfferingSection.offering_id == offering.id, Section.id == section_id))
    if section is None:
        fail(422, "section_invalid", "Choose a section of this subject.")
    if start and end and end < start:
        fail(422, "range_invalid", "The end date is before the start date.")
    query = select(AttendanceSession).where(AttendanceSession.offering_id == offering.id,
                                            AttendanceSession.section_id == section_id)
    if start:
        query = query.where(AttendanceSession.session_date >= start)
    if end:
        query = query.where(AttendanceSession.session_date <= end)
    sessions = db.scalars(query.order_by(AttendanceSession.session_date)).all()
    if not sessions:
        fail(422, "no_attendance", "No attendance has been recorded for that range.")
    marks: dict = {}
    for m in db.scalars(select(AttendanceMark).where(AttendanceMark.session_id.in_([s.id for s in sessions]))):
        marks.setdefault(m.session_id, {})[m.student_id] = m.status
    periods = {s.period for s in sessions}
    short = {"midterm": "Mid", "finals": "Fin"}
    columns = ["Student no.", "Student"] + [
        f"{s.session_date.strftime('%a %b %d')}" + (f" · {short[s.period]}" if len(periods) > 1 else "") for s in sessions] + SUMMARY
    rows = []
    for student in section_roster(db, offering.id, section_id):
        counted = Counter(marks.get(s.id, {}).get(student.id) for s in sessions)
        rows.append([student.student_number or "", student.display_name,
                     *[LETTER.get(marks.get(s.id, {}).get(student.id), "") for s in sessions],
                     counted["present"], counted["late"], counted["absent"], counted["excused"], counted[None]])
    subject, term = db.get(Subject, offering.subject_id), db.get(AcademicTerm, offering.term_id)
    first, last = sessions[0].session_date, sessions[-1].session_date
    return {"banner": None, "sheet": "Attendance", "title": f"Attendance: {subject.code} {subject.title}, {section.name}",
            "meta": [("Subject", f"{subject.code} {subject.title}"), ("Term", term.name), ("Section", section.name),
                     ("Teacher", actor.display_name),
                     ("Dates", f"{start or first} to {end or last}" if (start or end) else f"All recorded dates ({first} to {last})"),
                     ("Recorded days", len(sessions)), ("Grading period", " and ".join(sorted(p.title() for p in periods))),
                     ("Generated", local_stamp(now()))],
            "notes": [NOT_OFFICIAL, "P present · L late · A absent · E excused · blank not marked.",
                      "Only dates with an attendance record are listed; a student who was not marked on a recorded date is blank, not absent.",
                      "Late counts as part of a day and excused days are left out of the attendance grade (see the grading policy)."],
            "columns": columns, "rows": rows, "dates": len(sessions),
            "filename": f"attendance-{subject.code}-{section.name}-{first}-to-{last}"}


def to_attendance_pdf(table):
    styles = getSampleStyleSheet()
    small = styles["BodyText"].clone("a-small", fontSize=7, leading=8.5)
    head = styles["BodyText"].clone("a-head", fontSize=6.5, leading=8, textColor=colors.white, fontName="Helvetica-Bold")
    centre = styles["BodyText"].clone("a-centre", fontSize=7.5, leading=9, alignment=1)
    columns, rows, count = table["columns"], table["rows"], table["dates"]
    dates = list(range(2, 2 + count))
    chunks = [dates[i:i + DATES_PER_TABLE] for i in range(0, len(dates), DATES_PER_TABLE)]
    summary = list(range(2 + count, len(columns)))

    def decorate(canvas, doc):
        canvas.saveState()
        width, _ = landscape(A4)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(10 * mm, 6 * mm, table["notes"][0])
        canvas.drawRightString(width - 10 * mm, 6 * mm, f"Page {doc.page}")
        canvas.restoreState()

    out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=12 * mm,
                            bottomMargin=12 * mm, title=table["title"], author="LearnSync")
    story = [Paragraph(escape(table["title"]), styles["Title"])]
    for label, value in table["meta"]:
        story.append(Paragraph(f"<b>{escape(label)}:</b> {escape(str(value))}", small))
    for note in table["notes"][1:]:
        story.append(Paragraph(f"<i>{escape(note)}</i>", small))
    for n, chunk in enumerate(chunks):
        use = [0, 1] + chunk + (summary if n == len(chunks) - 1 else [])
        data = [[Paragraph(escape(columns[c]), head) for c in use]]
        for row in rows:
            data.append([Paragraph(escape(str(row[c])), small if c < 2 else centre) for c in use])
        fixed = [22 * mm, 55 * mm]
        rest = (landscape(A4)[0] - 20 * mm - sum(fixed)) / max(len(use) - 2, 1)
        grid = Table(data, colWidths=fixed + [min(rest, 22 * mm)] * (len(use) - 2), repeatRows=1)
        grid.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3A5F")),
                                  ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#9AA5B1")),
                                  ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                                  ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F6FA")])]))
        story += [PageBreak() if n else Spacer(1, 4 * mm), grid]
        if len(chunks) > 1:
            story.append(Paragraph(f"Dates {n * DATES_PER_TABLE + 1} to {n * DATES_PER_TABLE + len(chunk)} of {count}"
                                   + (" · totals are for all dates" if n == len(chunks) - 1 else ""), small))
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    return out.getvalue()
