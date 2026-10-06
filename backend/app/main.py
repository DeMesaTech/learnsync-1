import logging
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .db import SessionLocal
from .features.academics.router import router as academics_router
from .features.accounts.router import router as accounts_router
from .features.assessments.router import router as assessments_router
from .features.dashboard.router import router as dashboard_router
from .features.exports.router import router as exports_router
from .features.files.router import router as files_router
from .features.study.router import router as study_router
from .features.support.router import router as support_router
from .features.teaching.router import router as teaching_router

app = FastAPI(title="LearnSync v2", version="0.1.0")
app.include_router(accounts_router)
app.include_router(academics_router)
app.include_router(teaching_router)
app.include_router(assessments_router)
app.include_router(files_router)
app.include_router(study_router)
app.include_router(exports_router)
app.include_router(support_router)
app.include_router(dashboard_router)
logger = logging.getLogger("learnsync")

@app.middleware("http")
async def request_id(request: Request, call_next):
    request.state.request_id = str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response

def error_response(request, status, code, message, fields=None):
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message,
        "field_errors": fields or {}, "request_id": getattr(request.state, "request_id", "")}})

@app.exception_handler(HTTPException)
async def http_error(request, exc):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "request_failed", "message": str(exc.detail)}
    return error_response(request, exc.status_code, detail["code"], detail["message"])

@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    fields = {".".join(map(str, item["loc"][1:])): item["msg"] for item in exc.errors()}
    return error_response(request, 422, "validation_failed", "Check the highlighted fields.", fields)

@app.exception_handler(IntegrityError)
async def integrity_error(request, exc):
    return error_response(request, 409, "record_conflict", "This record conflicts with an existing record.")

@app.exception_handler(Exception)
async def unexpected_error(request, exc):
    logger.error("Unhandled request %s: %s", getattr(request.state, "request_id", ""), type(exc).__name__)
    return error_response(request, 500, "unexpected_error", "Something went wrong. Try again; your saved work is retained.")

@app.get("/api/health")
def health():
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return {"status": "ok", "application": "learnsync-v2"}
