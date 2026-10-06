"""Private upload storage. Files live outside the web root under generated keys and are
only ever served through an authorized API route (never a static mount)."""
import hashlib
import re
import uuid
import zipfile
from pathlib import Path

from app.config import settings
from app.errors import fail

from .models import StoredFile

CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}
MAX_ZIP_EXPANDED = 200 * 1024 * 1024   # zip-bomb guard for DOCX/XLSX/PPTX
PNG_MAGIC = bytes([0x89, 0x50, 0x4E, 0x47])
JPEG_MAGIC = bytes([0xFF, 0xD8])


def safe_name(name):
    base = re.sub(r"[^\w.\- ]", "_", Path(name or "upload").name).strip(" .")
    return (base or "upload")[:150]


def path_of(file):
    return settings().upload_root / file.storage_key


def check_structure(path, ext):
    """Verify the bytes really are the claimed type, not just the extension."""
    with path.open("rb") as fh:
        head = fh.read(8)
    if ext == ".pdf" and not head.startswith(b"%PDF"):
        fail(422, "file_invalid", "This is not a valid PDF file.")
    if ext == ".png" and not head.startswith(PNG_MAGIC):
        fail(422, "file_invalid", "This is not a valid PNG image.")
    if ext in {".jpg", ".jpeg"} and not head.startswith(JPEG_MAGIC):
        fail(422, "file_invalid", "This is not a valid JPEG image.")
    if ext in {".docx", ".xlsx", ".pptx"}:
        if not zipfile.is_zipfile(path):
            fail(422, "file_invalid", f"This is not a valid {ext[1:].upper()} file.")
        with zipfile.ZipFile(path) as z:
            if sum(i.file_size for i in z.infolist()) > MAX_ZIP_EXPANDED:
                fail(422, "file_too_large", "This file expands to an unsafe size.")
    if ext == ".csv":
        try:
            path.read_bytes().decode("utf-8-sig")
        except UnicodeDecodeError:
            fail(422, "file_invalid", "CSV files must be UTF-8 encoded.")


def save_upload(db, upload, purpose, actor, allowed):
    """Stream an UploadFile to disk with a size limit; returns the (uncommitted) StoredFile."""
    ext = Path(upload.filename or "").suffix.lower()
    if ext not in allowed:
        fail(422, "file_type_unsupported",
             "Unsupported file type. Use " + ", ".join(sorted(allowed)) + ".")
    file_id = uuid.uuid4()
    key = f"{file_id.hex[:2]}/{file_id.hex}"
    final = settings().upload_root / key
    final.parent.mkdir(parents=True, exist_ok=True)
    tmp = final.with_suffix(".part")
    digest, size = hashlib.sha256(), 0
    try:
        with tmp.open("wb") as out:
            while chunk := upload.file.read(1024 * 1024):
                size += len(chunk)
                if size > settings().upload_max_bytes:
                    fail(413, "file_too_large",
                         f"Files may be at most {settings().upload_max_bytes // 1048576} MiB.")
                digest.update(chunk)
                out.write(chunk)
        if size == 0:
            fail(422, "file_empty", "The uploaded file is empty.")
        check_structure(tmp, ext)
        tmp.replace(final)
    except BaseException:
        tmp.unlink(missing_ok=True)
        final.unlink(missing_ok=True)
        raise
    file = StoredFile(id=file_id, original_name=safe_name(upload.filename),
                      content_type=CONTENT_TYPES[ext], size=size, sha256=digest.hexdigest(),
                      storage_key=key, purpose=purpose, uploader_id=actor.id)
    db.add(file)
    db.flush()
    return file
