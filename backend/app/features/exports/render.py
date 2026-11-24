"""Real XLSX and PDF files from a grade table."""
import re
from io import BytesIO
from xml.sax.saxutils import escape

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value):
    """A spreadsheet runs text that starts with = + - @ as a formula: neutralise names and notes."""
    if isinstance(value, str) and value.startswith(FORMULA_START):
        return "'" + value
    return value


def safe_filename(name):
    return re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-.")[:80] or "export"


def to_xlsx(table):
    """Build a teacher-friendly grade sheet while retaining the exact export data.

    The colour roles deliberately follow the departmental grade-sheet template: yellow
    identifies students/final grades, green identifies component grades, and cyan keeps
    remarks distinct from the calculated values.
    """
    book = Workbook()
    sheet = book.active
    sheet.title = table.get("sheet", "Grades")
    sheet.sheet_view.showGridLines = False
    total_columns = len(table["columns"])
    end_column = get_column_letter(total_columns)
    thin_green = Side(style="thin", color="00A651")
    medium_green = Side(style="medium", color="00A651")
    outline = Border(left=medium_green, right=medium_green, top=medium_green, bottom=medium_green)
    grouped = Border(bottom=medium_green)
    header_border = Border(left=thin_green, right=thin_green, top=thin_green, bottom=medium_green)
    lime = "00E600"
    light_green = "B3EA8A"
    yellow = "FFFF00"
    cyan = "00B0F0"
    soft_gray = "F2F2F2"
    default_groups = (["STUDENT INFORMATION"] * (4 if table["columns"][0] == "Rank" else 3)
                      + ["GRADE COMPONENTS"] * max(len(table["columns"]) - 6, 0)
                      + ["FINAL GRADE"] * 3)
    column_groups = table.get("column_groups", default_groups)
    default_roles = (["identity"] * (4 if table["columns"][0] == "Rank" else 3)
                     + ["category"] * max(len(table["columns"]) - 6, 0)
                     + ["grade", "remark", "status"])
    column_roles = table.get("column_roles", default_roles)

    row = 1
    if table["banner"]:
        cell = sheet.cell(row=row, column=1, value=safe_cell(table["banner"]))
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="B42318")
        cell.alignment = Alignment(horizontal="center", vertical="center")
        sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=total_columns)
        row += 1
    # The period/title strip is the first non-warning element, like the supplied grade-sheet
    # template. Metadata remains above the grid so it prints with the file.
    sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=total_columns)
    title = sheet.cell(row=row, column=1, value=safe_cell(table["title"].upper()))
    title.font = Font(name="Arial", bold=True, size=18, color="000000")
    title.fill = PatternFill("solid", fgColor=lime)
    title.alignment = Alignment(horizontal="center", vertical="center")
    title.border = outline
    sheet.row_dimensions[row].height = 30
    row += 1
    for label, value in table["meta"]:
        label_cell = sheet.cell(row=row, column=1, value=safe_cell(label))
        label_cell.font = Font(name="Arial", bold=True, size=10)
        label_cell.fill = PatternFill("solid", fgColor=soft_gray)
        label_cell.alignment = Alignment(vertical="center")
        value_cell = sheet.cell(row=row, column=2, value=safe_cell(value))
        value_cell.font = Font(name="Arial", size=10)
        value_cell.alignment = Alignment(vertical="center")
        if total_columns > 2:
            sheet.merge_cells(start_row=row, start_column=2, end_row=row, end_column=total_columns)
        row += 1
    for note in table["notes"]:
        cell = sheet.cell(row=row, column=1, value=safe_cell(note))
        cell.font = Font(name="Arial", italic=True, size=9)
        cell.alignment = Alignment(vertical="center")
        if total_columns > 1:
            sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=total_columns)
        row += 1
    row += 1

    # Each activity is grouped beneath its policy category, matching the teacher's grade-sheet
    # workflow rather than flattening every score into one undifferentiated list.
    group_row = row
    start = 1
    while start <= total_columns:
        label = column_groups[start - 1]
        end = start
        while end < total_columns and column_groups[end] == label:
            end += 1
        fill = yellow if label == "STUDENT INFORMATION" else (
            lime if label == "FINAL GRADE" else soft_gray)
        if start != end:
            sheet.merge_cells(start_row=group_row, start_column=start, end_row=group_row, end_column=end)
        cell = sheet.cell(row=group_row, column=start, value=label)
        cell.font = Font(name="Arial", bold=True, italic=True, size=10)
        cell.fill = PatternFill("solid", fgColor=fill)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = grouped
        start = end + 1
    sheet.row_dimensions[group_row].height = 22

    header = group_row + 1
    for col, name in enumerate(table["columns"], start=1):
        cell = sheet.cell(row=header, column=col, value=safe_cell(name))
        role = column_roles[col - 1]
        fill = {"identity": yellow, "activity": soft_gray, "category": light_green,
                "details": soft_gray, "grade": yellow, "remark": cyan, "status": cyan}.get(role)
        cell.font = Font(name="Arial", bold=True, italic=role in ("grade", "remark"), size=10)
        if fill:
            cell.fill = PatternFill("solid", fgColor=fill)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = header_border
    sheet.row_dimensions[header].height = 30
    for r, data in enumerate(table["rows"], start=header + 1):
        for col, value in enumerate(data, start=1):
            cell = sheet.cell(row=r, column=col, value=safe_cell(value))
            role = column_roles[col - 1]
            fill = {"category": light_green, "grade": yellow, "remark": cyan, "status": cyan}.get(role)
            if col == 1 and role == "identity":
                fill = yellow
            if fill:
                cell.fill = PatternFill("solid", fgColor=fill)
            cell.font = Font(name="Arial", size=10, bold=role == "category")
            cell.alignment = Alignment(horizontal="left" if role in ("name", "remark", "status")
                                       else "center", vertical="center", wrap_text=table["columns"][col - 1] == "Status")
            if role in ("identity", "name", "grade", "remark", "status", "details"):
                cell.border = Border(left=thin_green, right=thin_green)
            if isinstance(value, float):
                cell.number_format = "0.00"
        sheet.row_dimensions[r].height = 18
    sheet.auto_filter.ref = f"A{header}:{end_column}{max(header, header + len(table['rows']))}"
    sheet.freeze_panes = sheet.cell(row=header + 1, column=4 if table["columns"][0] == "Rank" else 3)
    for col in range(1, len(table["columns"]) + 1):
        name = table["columns"][col - 1]
        widest = max([len(str(name))] + [len(str(d[col - 1])) for d in table["rows"] if d[col - 1] is not None])
        if name == "Name":
            width = max(24, min(widest + 2, 38))
        elif name == "Status":
            width = max(24, min(widest + 2, 40))
        elif name == "Remark":
            width = max(13, min(widest + 2, 20))
        else:
            width = min(max(widest + 2, 10), 18)
        sheet.column_dimensions[get_column_letter(col)].width = width
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_margins.left = 0.25
    sheet.page_margins.right = 0.25
    sheet.page_margins.top = 0.4
    sheet.page_margins.bottom = 0.4
    sheet.print_title_rows = f"{header}:{header}"
    out = BytesIO()
    book.save(out)
    return out.getvalue()


def column_widths(count, ranked=False):
    """Column widths (points) for a landscape A4 table. Many category columns: the fixed columns shrink,
    the name column gets a larger share than a percentage, so names stay readable. `ranked` means a Rank
    column was put in front of the usual layout."""
    last = count - 1
    lead = 1 if ranked else 0
    available = landscape(A4)[0] - 20 * mm
    crowded = count - lead > 11
    base = ({0: 20 * mm, 2: 16 * mm, -3: 13 * mm, -2: 15 * mm, -1: 46 * mm} if crowded
            else {0: 22 * mm, 2: 20 * mm, -3: 15 * mm, -2: 16 * mm, -1: 60 * mm})
    fixed = {(k + lead if k >= 0 else last + 1 + k): v for k, v in base.items()}
    if ranked:
        fixed[0] = 11 * mm
    weights = {i: (2.6 if i == 1 + lead else 1.0) for i in range(count) if i not in fixed}
    unit = (available - sum(fixed.values())) / sum(weights.values())
    return [fixed.get(i, unit * weights.get(i, 1.0)) for i in range(count)]


def to_pdf(table):
    styles = getSampleStyleSheet()
    size = 6.3 if len(table["columns"]) > 11 else 7.5
    small = styles["BodyText"].clone("small", fontSize=size, leading=size + 1.5)
    head = styles["BodyText"].clone("head", fontSize=size, leading=size + 1.5, textColor=colors.white,
                                    fontName="Helvetica-Bold")
    banner = table["banner"]

    def decorate(canvas, doc):
        canvas.saveState()
        width, height = landscape(A4)
        if banner:   # on EVERY page, so a printed preview cannot be mistaken for released grades
            canvas.setFillColor(colors.HexColor("#B42318"))
            canvas.rect(10 * mm, height - 13 * mm, width - 20 * mm, 7 * mm, stroke=0, fill=1)
            canvas.setFillColor(colors.white)
            canvas.setFont("Helvetica-Bold", 9)
            canvas.drawString(12 * mm, height - 11.2 * mm, banner)
        canvas.setFillColor(colors.black)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(10 * mm, 6 * mm, table["notes"][0])
        canvas.drawRightString(width - 10 * mm, 6 * mm, f"Page {doc.page}")
        canvas.restoreState()

    out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm,
                            topMargin=17 * mm, bottomMargin=12 * mm, title=table["title"],
                            author="LearnSync")
    story = [Paragraph(escape(table["title"]), styles["Title"])]
    for label, value in table["meta"]:
        story.append(Paragraph(f"<b>{escape(label)}:</b> {escape(str(value))}", small))
    for note in table["notes"][1:]:
        story.append(Paragraph(f"<i>{escape(note)}</i>", small))
    story.append(Spacer(1, 4 * mm))
    data = [[Paragraph(escape(c), head) for c in table["columns"]]]
    for row in table["rows"]:
        data.append([Paragraph(escape("" if v is None else (f"{v:.2f}" if isinstance(v, float) else str(v))), small)
                     for v in row])
    widths = column_widths(len(table["columns"]), table["columns"][0] == "Rank")
    grid = Table(data, colWidths=widths, repeatRows=1)
    grid.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3A5F")),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#9AA5B1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F6FA")])]))
    story.append(grid)
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    return out.getvalue()
