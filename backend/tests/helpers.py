import uuid

from fastapi.testclient import TestClient

from app.features.accounts.models import Account, now
from app.main import app
from app.security import passwords

PASSWORD = "a-test-password-2026"


def make_account(db, email, role, number=None):
    account = Account(email=email, display_name=email.split("@")[0], role=role,
                      student_number=number, status="active", email_verified_at=now(),
                      password_hash=passwords.hash(PASSWORD))
    db.add(account)
    db.commit()
    return account


class Api:
    """One signed-in user with their own cookie jar (a TestClient holds one session)."""

    def __init__(self, email):
        self.c = TestClient(app)
        csrf = self.c.get("/api/auth/session").json()["csrf"]
        origin = {"Origin": "http://127.0.0.1:5173"}
        response = self.c.post("/api/auth/login", headers={**origin, "X-CSRF-Token": csrf},
                               json={"email": email, "password": PASSWORD})
        assert response.status_code == 200, response.text
        self.h = {**origin, "X-CSRF-Token": response.json()["csrf"]}

    def get(self, url):
        return self.c.get(url, headers=self.h)

    def post(self, url, json=None):
        return self.c.post(url, headers=self.h, json=json)

    def put(self, url, json=None):
        return self.c.put(url, headers=self.h, json=json)

    def patch(self, url, json=None):
        return self.c.patch(url, headers=self.h, json=json)

    def delete(self, url):
        return self.c.delete(url, headers=self.h)

    def upload(self, url, name, content, data=None):
        return self.c.post(url, headers=self.h, data=data or {}, files={"file": (name, content)})


PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def uid():
    return str(uuid.uuid4())


def make_outline(name="Intro to Entrepreneurship", chapter="Chapter 1 - Foundations"):
    chapter_id, topic_id = uid(), uid()
    return {"course": {"name": name, "code": "ENT 101", "units": "3"},
            "outcomes": [{"id": uid(), "text": "Explain entrepreneurship"}],
            "chapters": [{"id": chapter_id, "title": chapter, "weeks": "Week 1-2",
                          "topics": [{"id": topic_id, "title": "What is a venture?"}]}]}, \
        chapter_id, topic_id


def t(c, path):
    return f"/api/teach/offerings/{c['oid']}{path}"


def learn(c, path):
    return f"/api/learn/offerings/{c['oid']}{path}"


def publish_syllabus(c, outline=None, policy=None):
    outline = outline or make_outline()[0]
    draft = c["fac"].post(t(c, "/syllabus/draft")).json()
    saved = c["fac"].put(t(c, "/syllabus/draft"), {"expected_counter": draft["counter"],
                                                    "outline": outline,
                                                    "grading_policy": policy}).json()
    done = c["fac"].post(t(c, "/syllabus/draft/publish"), {"expected_counter": saved["counter"]})
    assert done.status_code == 200, done.text
    return done.json()


POLICY = {"categories": [{"key": "quiz", "label": "Quizzes", "weight": 20},
                         {"key": "activity", "label": "Activities", "weight": 20},
                         {"key": "attendance", "label": "Attendance", "weight": 10},
                         {"key": "exam", "label": "Examinations", "weight": 50}],
          "periods": [{"key": "midterm", "label": "Midterm", "share": 50},
                      {"key": "finals", "label": "Finals", "share": 50}],
          "transmutation": "raw", "passing": 75, "late_attendance_fraction": 0.5}
