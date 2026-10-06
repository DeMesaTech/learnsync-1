"""Split text into retrieval chunks. Pure functions, no database.

Chunks are about 2,000 characters with about 200 characters of overlap, prefer paragraph
boundaries, and never cross a page/slide/section boundary so their locator stays accurate."""
import re

SIZE = 2000
OVERLAP = 200


def _tail(text, overlap):
    """The last ~overlap characters, starting at a word boundary."""
    if len(text) <= overlap:
        return text
    cut = text[-overlap:]
    space = cut.find(" ")
    return cut[space + 1:] if 0 <= space < overlap // 2 else cut


def _hard_split(paragraph, size, overlap):
    """A single paragraph longer than a chunk: cut at whitespace with overlap."""
    pieces, start = [], 0
    while start < len(paragraph):
        end = min(start + size, len(paragraph))
        if end < len(paragraph):
            space = paragraph.rfind(" ", start + size // 2, end)
            end = space if space > start else end
        pieces.append(paragraph[start:end].strip())
        if end >= len(paragraph):
            break
        start = max(end - overlap, start + 1)
    return [p for p in pieces if p]


def chunk_section(text, size=SIZE, overlap=OVERLAP):
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n|\n", text) if p.strip()]
    chunks, current = [], ""
    for paragraph in paragraphs:
        if len(paragraph) > size:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(_hard_split(paragraph, size, overlap))
            continue
        if current and len(current) + len(paragraph) + 1 > size:
            chunks.append(current)
            current = (_tail(current, overlap) + " " + paragraph).strip()
        else:
            current = f"{current}\n{paragraph}".strip() if current else paragraph
    if current:
        chunks.append(current)
    return chunks


def chunk_sections(sections, size=SIZE, overlap=OVERLAP):
    """sections: [(locator, text)] -> [{'locator', 'text'}] in reading order."""
    out = []
    for locator, text in sections:
        out += [{"locator": locator, "text": c} for c in chunk_section(text, size, overlap)]
    return out
