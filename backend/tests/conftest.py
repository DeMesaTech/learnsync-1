import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
test_url = os.environ.get("TEST_DATABASE_URL", "")
if not test_url or not test_url.rsplit("/", 1)[-1].endswith("_test"):
    raise RuntimeError("TEST_DATABASE_URL must point to an isolated *_test database")
os.environ["DATABASE_URL"] = test_url
import pytest
from pwdlib.hashers.argon2 import Argon2Hasher

from app.security import passwords as _passwords

# Tests log in dozens of times; use a cheap Argon2 setup there. Production keeps the library defaults.
_fast = Argon2Hasher(time_cost=1, memory_cost=1024, parallelism=1)
_passwords.hashers, _passwords.current_hasher = [_fast], _fast
from fastapi.testclient import TestClient
from helpers import POLICY, Api, make_account, publish_syllabus
from sqlalchemy import delete

from app.config import settings
from app.db import Base, SessionLocal
from app.features.accounts import commands
from app.features.accounts.models import Account, now
from app.main import app
from app.security import _limits, passwords


@pytest.fixture(scope="session", autouse=True)
def migrated():
    from alembic import command
    from alembic.config import Config
    command.upgrade(Config(str(Path(__file__).resolve().parents[1] / "alembic.ini")), "head")


@pytest.fixture
def db():
    with SessionLocal() as session:
        for table in reversed(Base.metadata.sorted_tables):
            session.execute(delete(table))
        session.commit()
        _limits.clear()
        yield session
        session.rollback()

@pytest.fixture
def actors(db):
    accounts = []
    for role in ("admin", "faculty", "student"):
        account = Account(email=f"{role}@example.com", display_name=role.title(), role=role,
                          student_number="ST-1" if role == "student" else None,
                          status="active", email_verified_at=now(),
                          password_hash=passwords.hash("a-test-password-2026"))
        db.add(account)
        accounts.append(account)
    db.commit()
    return accounts

@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client

@pytest.fixture
def headers(client):
    data = client.get("/api/auth/session").json()
    return {"Origin":"http://127.0.0.1:5173", "X-CSRF-Token":data["csrf"]}

@pytest.fixture
def sent(monkeypatch):
    links = []
    monkeypatch.setattr(commands, "send_link", lambda account, token, purpose: links.append((account.email, token, purpose)))
    return links

def sign_in(client, headers, role="admin"):
    response = client.post("/api/auth/login", headers=headers,
                           json={"email":f"{role}@example.com", "password":"a-test-password-2026"})
    assert response.status_code == 200, response.text
    return {**headers, "X-CSRF-Token":response.json()["csrf"]}


@pytest.fixture
def world(db, actors):
    """Admin-created term, subject, two sections, one offering for faculty@example.com."""
    admin = Api("admin@example.com")
    faculty = actors[1]
    s1 = make_account(db, "s1@example.com", "student", "S-1")
    s2 = make_account(db, "s2@example.com", "student", "S-2")
    year = admin.post("/api/school-years", {
        "label": "2026-2027", "start_date": "2026-06-01", "end_date": "2027-04-30",
        "terms": [{"name": "First Semester", "sequence": 1, "start_date": "2026-06-01",
                   "end_date": "2026-10-31"}]}).json()
    term = year["terms"][0]
    subject = admin.post("/api/subjects", {
        "code": "ent 101", "title": "Intro to Entrepreneurship", "units": "3",
        "year_level": 1, "semester": 1}).json()
    sections = [admin.post(f"/api/terms/{term['id']}/sections",
                           {"name": name, "year_level": 1}).json() for name in ("1A", "1B")]
    offering = admin.post(f"/api/terms/{term['id']}/offerings", {
        "subject_id": subject["id"], "faculty_id": str(faculty.id),
        "section_ids": [sections[0]["id"]]})
    assert offering.status_code == 201, offering.text
    return {"admin": admin, "term": term, "subject": subject, "sections": sections,
            "offering": offering.json(), "students": [s1, s2], "faculty": faculty}


@pytest.fixture
def course(world, tmp_path, monkeypatch):
    """One offering shared by sections 1A (student s1) and 1B (student s2)."""
    monkeypatch.setattr(settings(), "upload_root", tmp_path / "uploads")
    admin, oid = world["admin"], world["offering"]["id"]
    a, b = world["sections"]
    assert admin.patch(f"/api/offerings/{oid}",
                       {"section_ids": [a["id"], b["id"]]}).status_code == 200
    s1, s2 = world["students"]
    admin.post(f"/api/sections/{a['id']}/members", {"student_id": str(s1.id)})
    admin.post(f"/api/sections/{b['id']}/members", {"student_id": str(s2.id)})
    return {**world, "oid": oid, "fac": Api("faculty@example.com"), "st1": Api("s1@example.com"),
            "st2": Api("s2@example.com"), "sec_a": a, "sec_b": b}


@pytest.fixture
def graded(course):
    """The course with a published syllabus that carries a confirmed grading policy."""
    publish_syllabus(course, policy=POLICY)
    return course


@pytest.fixture(autouse=True)
def real_provider_mode(monkeypatch):
    """A developer's .env may select the development simulator; tests must not depend on it."""
    monkeypatch.setattr(settings(), "ai_provider_mode", "groq")
    from app.features.study import provider
    monkeypatch.setattr(provider, "cooldown_until", 0.0)      # a rate limit in one test must not pause the next
