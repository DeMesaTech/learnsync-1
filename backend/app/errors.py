from fastapi import HTTPException


def fail(status: int, code: str, message: str, fields: dict | None = None):
    detail = {"code": code, "message": message}
    if fields:
        detail["fields"] = fields        # per-item messages, e.g. which batch cells were rejected
    raise HTTPException(status_code=status, detail=detail)
