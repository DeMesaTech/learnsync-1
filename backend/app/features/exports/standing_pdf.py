"""One student's standing as a PDF. Two bases, never mixed in one file (as with the class exports):
  published - only what the student can already see (released results, published grades), plus the attendance
              and progress records the teacher keeps. Safe to hand to the student.
  working   - adds today's calculation and unreleased scores. Every page carries a red banner, because the
              student cannot see those values and they may still change."""
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .tables import NOT_OFFICIAL, PERIOD_LABELS

BANNER = "FACULTY COPY - includes working values the student cannot see yet. Do not hand to the student."
SUBMISSION = {"not_attempted": "Not attempted", "in_progress": "In progress", "submitted": "Submitted",
              "submitted_late": "Submitted late", "not_submitted": "Not submitted",
              "teacher_entered": "Entered by teacher"}
MARK = {"present": "Present", "late": "Late", "absent": "Absent", "excused": "Excused", None: "Not marked"}


def num(value):
    return "-" if value is None else f"{float(value):.2f}"


def to_standing_pdf(data, context, basis):
    """`data` is the standing payload; `context` has subject, term, generated_at and the faculty name."""
    styles = getSampleStyleSheet()
    body = styles["BodyText"].clone("b", fontSize=8.5, leading=11)
    head = styles["BodyText"].clone("h", fontSize=8, leading=10, textColor=colors.white, fontName="Helvetica-Bold")
    working = basis == "working"
    student = data["student"]

    def cell(value, style=body):
        return Paragraph(escape("" if value is None else str(value)), style)

    def table(columns, rows, widths):
        grid = Table([[cell(c, head) for c in columns]] + [[cell(v) for v in r] for r in rows],
                     colWidths=widths, repeatRows=1)
        grid.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3A5F")),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#9AA5B1")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F6FA")])]))
        return grid

    def decorate(canvas, doc):
        canvas.saveState()
        width, height = A4
        if working:                       # on EVERY page, so a printed copy cannot be mistaken for a release
            canvas.setFillColor(colors.HexColor("#B42318"))
            canvas.rect(12 * mm, height - 13 * mm, width - 24 * mm, 7 * mm, stroke=0, fill=1)
            canvas.setFillColor(colors.white)
            canvas.setFont("Helvetica-Bold", 8)
            canvas.drawString(14 * mm, height - 11.2 * mm, BANNER)
        canvas.setFillColor(colors.black)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(12 * mm, 7 * mm, NOT_OFFICIAL)
        canvas.drawRightString(width - 12 * mm, 7 * mm, f"Page {doc.page}")
        canvas.restoreState()

    out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=18 * mm,
                            bottomMargin=14 * mm, title=f"Standing - {student['name']}", author="LearnSync")
    full = A4[0] - 24 * mm
    story = [Paragraph(f"Student standing: {escape(student['name'])}", styles["Title"])]
    for label, value in [("Student number", student["student_number"]), ("Section", student["section"] or "-"),
                         ("Subject", f"{context['subject']}"), ("Term", context["term"]),
                         ("Enrolment", student["enrollment_status"].capitalize()),
                         ("Prepared by", context["faculty"]), ("Generated", context["generated_at"])]:
        story.append(Paragraph(f"<b>{escape(label)}:</b> {escape(str(value))}", body))
    story.append(Paragraph("<i>" + ("Working values included: today's calculation and scores not yet released."
                                    if working else "Shows only what has been released to the student, plus attendance "
                                    "and progress records.") + "</i>", body))

    story += [Spacer(1, 4 * mm), Paragraph("Grades", styles["Heading3"])]
    periods = [k for k in (data["calculation"]["grades"] if data["calculation"] else data["published"]) if k != "course"] + ["course"]
    rows = []
    for k in periods:
        pub = data["published"].get(k)
        row = [PERIOD_LABELS.get(k, k), f"{num(pub['grade'])} ({pub['remark']}, release {pub['release_number']})" if pub else "Not published"]
        if working:
            calc = data["calculation"]["grades"].get(k) if data["calculation"] else None
            row.append("Not calculated" if calc is None else f"{num(calc['grade'])}" if calc["grade"] is not None else "Pending: " + "; ".join(calc["pending"]))
        rows.append(row)
    story.append(table(["Period", "Published grade"] + (["Current calculation (working)"] if working else []), rows,
                       [32 * mm, 62 * mm, full - 94 * mm] if working else [45 * mm, full - 45 * mm]))

    story += [Spacer(1, 4 * mm), Paragraph("Quizzes, activities and exams", styles["Heading3"])]
    rows = []
    for a in data["assessments"]:
        row = [f"{a['title']}" + ("" if a["counts_toward_grade"] else " (not counted toward grade)"),
               f"{PERIOD_LABELS.get(a['period'], 'No period')} / {a['category'] or 'No category'}",
               SUBMISSION.get(a["submission"], a["submission"]),
               f"{num(a['released_score'])} / {num(a['max_points'])}" if a["released"] else "Not released"]
        if working:
            row.append(f"{num(a['working_score'])} / {num(a['max_points'])}" if a["scored"] else "Not scored yet")
        rows.append(row)
    if rows:
        story.append(table(["Assessment", "Period / category", "Handed in", "Visible to student"] + (["Working score"] if working else []), rows,
                           [52 * mm, 38 * mm, 30 * mm, 30 * mm, full - 150 * mm] if working else [62 * mm, 45 * mm, 35 * mm, full - 142 * mm]))
    else:
        story.append(Paragraph("No current assessments are shown.", body))

    story += [Spacer(1, 4 * mm), Paragraph("Attendance", styles["Heading3"])]
    days = data["attendance"]["days"]
    if days:
        counts = data["attendance"]["counts"]
        story.append(table(["Period", "Present", "Late", "Absent", "Excused", "Not marked"],
                           [[PERIOD_LABELS.get(p, p)] + [c[k] for k in ("present", "late", "absent", "excused", "not_marked")] for p, c in counts.items()],
                           [40 * mm] + [(full - 40 * mm) / 5] * 5))
        story += [Spacer(1, 2 * mm), table(["Date", "Period", "Status"],
                                           [[str(d["date"]), PERIOD_LABELS.get(d["period"], d["period"]), MARK[d["status"]]] for d in days],
                                           [40 * mm, 40 * mm, full - 80 * mm])]
    else:
        story.append(Paragraph("No attendance has been recorded for this student's section.", body))

    prog = data["progress"]
    if prog:
        story += [Spacer(1, 4 * mm), Paragraph("Learning progress", styles["Heading3"]),
                  Paragraph(f"{'-' if prog['percent'] is None else str(prog['percent']) + '%'} - {prog['done']} of {prog['total']} steps done. "
                            "Lessons count when the student marks them complete; quizzes and activities count when submitted.", body)]
        if prog["steps"]:
            story.append(table(["Step", "Type", "Status"],
                               [[s["title"], {"lesson_completed": "Lesson", "quiz_submitted": "Quiz", "activity_submitted": "Activity"}[s["type"]],
                                 "Done" if s["done"] else "Not done"] for s in prog["steps"]], [full - 70 * mm, 35 * mm, 35 * mm]))
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    return out.getvalue()
