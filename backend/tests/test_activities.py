import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from helpers import PDF, Api, make_account
from sqlalchemy import select
from test_assessments import a, create, iso, la, make_manual, make_quiz

from app.features.assessments.models import AssessmentRevision, ResultPublication
from app.main import app


def score(c, aid, student, value, **extra):
    return c["fac"].put(a(c, f"/{aid}/scores/{student.id}"), {"score": value, **extra})


def rows(c, aid):
    return {r["student"]: r for r in c["fac"].get(a(c, f"/{aid}/scores")).json()}


def submit_pdf(st, c, aid, note="", name="work.pdf", content=PDF):
    return st.upload(la(c, f"/assessments/{aid}/submissions"), name, content, {"note": note})


def set_deadline(db, aid, when):
    rev = db.scalar(select(AssessmentRevision).where(
        AssessmentRevision.assessment_id == uuid.UUID(aid),
        AssessmentRevision.state == "published"))
    rev.deadline = when
    db.commit()


def past():
    return datetime.now(UTC) - timedelta(hours=3)


# ---------------- faculty-entered scores ----------------

def test_pending_versus_zero_and_score_limits(graded):
    aid = make_manual(graded, "offline_quiz", "Paper quiz", points="20")
    s1 = graded["students"][0]
    assert [r["score"] for r in rows(graded, aid).values()] == [None, None]        # pending, not zero
    zero = score(graded, aid, s1, 0)
    assert zero.status_code == 200 and zero.json()["score"] == 0.0                 # an explicit zero
    assert rows(graded, aid)["s1"]["score"] == 0.0 and rows(graded, aid)["s2"]["score"] is None
    assert score(graded, aid, s1, 21).json()["error"]["code"] == "score_exceeds_max"
    assert score(graded, aid, s1, -1).status_code == 422
    assert graded["fac"].put(a(graded, f"/{aid}/scores/{uuid.uuid4()}"), {"score": 5}).status_code == 422
    # clearing returns the student to pending
    assert score(graded, aid, s1, None).status_code == 200
    assert rows(graded, aid)["s1"]["score"] is None


def test_score_conflicts_are_detected(graded):
    aid = make_manual(graded, "exam", "Midterm exam")
    s1, s2 = graded["students"]
    # a student with no score yet starts at revision 0, which is what the pages send
    first_ever = score(graded, aid, s2, 10, expected_revision=0)
    assert first_ever.status_code == 200 and first_ever.json()["revision"] == 1
    assert rows(graded, aid)["s2"]["score_revision"] == 1
    first = score(graded, aid, s1, 40).json()
    assert score(graded, aid, s1, 41, expected_revision=first["revision"]).status_code == 200
    stale = score(graded, aid, s1, 42, expected_revision=first["revision"])
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "score_conflict"


def test_scores_need_a_published_assessment(graded):
    aid = create(graded, "exam", "Not published yet")["id"]
    refused = score(graded, aid, graded["students"][0], 10)
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "not_published"


def test_released_results_are_immutable_snapshots(db, graded):
    aid = make_manual(graded, "offline_quiz", "Paper quiz", points="20")
    s1, s2 = graded["students"]
    fac, st1 = graded["fac"], graded["st1"]
    score(graded, aid, s1, 0, feedback="Absent that day")
    score(graded, aid, s2, 18)
    # nothing is visible to students before release
    assert st1.get(la(graded, "/results")).json()["results"] == []
    assert fac.post(a(graded, f"/{aid}/release"), {"student_ids": [str(s1.id)]}).json() == {"released": 1}
    mine = st1.get(la(graded, "/results")).json()["results"]
    assert [(r["score"], r["feedback"], r["release_number"]) for r in mine] == [(0.0, "Absent that day", 1)]
    assert graded["st2"].get(la(graded, "/results")).json()["results"] == []     # s2 not released yet
    # a later correction changes the working score only
    score(graded, aid, s1, 15, feedback="Re-marked")
    assert st1.get(la(graded, "/results")).json()["results"][0]["score"] == 0.0
    book = fac.get(f"/api/teach/offerings/{graded['oid']}/gradebook").json()
    changes = {r["student_id"]: r["cells"][aid]["unreleased_change"] for r in book["rows"]}
    assert changes[str(s1.id)] is True
    fac.post(a(graded, f"/{aid}/release"), {"student_ids": None})
    latest = st1.get(la(graded, "/results")).json()["results"][0]
    assert (latest["score"], latest["release_number"]) == (15.0, 2)
    history = db.scalars(select(ResultPublication).where(
        ResultPublication.assessment_id == uuid.UUID(aid),
        ResultPublication.student_id == s1.id).order_by(ResultPublication.release_number)).all()
    assert [(h.release_number, float(h.score)) for h in history] == [(1, 0.0), (2, 15.0)]   # both kept


# ---------------- activity submissions ----------------

def test_submission_versions_files_and_downloads(db, graded):
    aid = make_manual(graded, "activity", "Business plan", points="20", category_key="activity",
                      deadline=iso(24))
    st1, st2, fac = graded["st1"], graded["st2"], graded["fac"]
    assert submit_pdf(st1, graded, aid, name="work.docx").status_code == 422
    assert submit_pdf(st1, graded, aid, content=b"not a pdf").status_code == 422
    v1 = submit_pdf(st1, graded, aid, note="first draft")
    assert v1.status_code == 201 and v1.json()["version"] == 1
    v2 = submit_pdf(st1, graded, aid, note="revised", content=PDF + b"\n% v2")
    assert v2.json()["version"] == 2 and v2.json()["file"]["id"] != v1.json()["file"]["id"]
    item = next(i for i in st1.get(la(graded, "/assessments")).json() if i["id"] == aid)
    assert [s["version"] for s in item["submissions"]] == [1, 2] and item["state"] == "resubmit"
    # downloads: the owner and the assigned teacher only
    old, new = v1.json()["file"]["id"], v2.json()["file"]["id"]
    for fid in (old, new):
        assert st1.get(f"/api/files/{fid}/download").status_code == 200
        assert fac.get(f"/api/files/{fid}/download").status_code == 200
        assert st2.get(f"/api/files/{fid}/download").status_code == 404
        assert graded["admin"].get(f"/api/files/{fid}/download").status_code == 404
        assert TestClient(app).get(f"/api/files/{fid}/download").status_code == 401
    other = Api(make_account(db, "other@example.com", "faculty").email)
    assert other.get(f"/api/files/{new}/download").status_code == 404
    # the teacher sees the latest version and the full count
    row = rows(graded, aid)["s1"]
    assert row["versions"] == 2 and row["latest"]["version"] == 2 and row["latest"]["note"] == "revised"
    # quizzes and activities do not share endpoints
    quiz = make_quiz(graded)
    assert submit_pdf(st1, graded, quiz["aid"]).status_code == 404
    assert st1.post(la(graded, f"/assessments/{aid}/attempts")).status_code == 404


def test_deadline_late_policy_and_teacher_permission(db, graded):
    strict = make_manual(graded, "activity", "Strict", points="10", category_key="activity", deadline=iso(5))
    lenient = make_manual(graded, "activity", "Lenient", points="10", category_key="activity",
                          deadline=iso(5), allow_late=True)
    st1, fac, s1 = graded["st1"], graded["fac"], graded["students"][0]
    assert submit_pdf(st1, graded, strict).status_code == 201                         # on time
    for aid in (strict, lenient):
        set_deadline(db, aid, past())
    # replacing on-time work after the deadline needs permission, even though the first upload was on time
    closed = submit_pdf(st1, graded, strict)
    assert closed.status_code == 409 and closed.json()["error"]["code"] == "closed"
    # a FIRST submission after the deadline is allowed only when the activity allows late work
    late = submit_pdf(st1, graded, lenient)
    assert late.status_code == 201 and late.json()["is_late"] is True
    # ...but allowing late work does not allow replacing it afterwards
    assert submit_pdf(st1, graded, lenient).status_code == 409
    # teacher grants a one-use permission with a reason and an expiry
    assert fac.post(a(graded, f"/{strict}/permissions"),
                    {"student_id": str(s1.id), "reason": "Medical", "expires_at": iso(-1)}).status_code == 422
    granted = fac.post(a(graded, f"/{strict}/permissions"),
                       {"student_id": str(s1.id), "reason": "Medical", "expires_at": iso(48)})
    assert granted.status_code == 201
    assert graded["st2"].upload(la(graded, f"/assessments/{strict}/submissions"), "w.pdf", PDF,
                                {"note": ""}).status_code == 409                      # permission is personal
    reopened = submit_pdf(st1, graded, strict, note="after permission")
    assert reopened.status_code == 201 and reopened.json()["version"] == 2 and reopened.json()["is_late"]
    assert submit_pdf(st1, graded, strict).status_code == 409                        # consumed
    assert any(e["action"] == "submission.permission_granted"
               for e in graded["admin"].get("/api/audit").json())


def test_new_version_never_changes_a_released_result(graded):
    aid = make_manual(graded, "activity", "Case study", points="20", category_key="activity",
                      deadline=iso(24))
    st1, fac, s1 = graded["st1"], graded["fac"], graded["students"][0]
    submit_pdf(st1, graded, aid, note="v1")
    assert score(graded, aid, s1, 16, feedback="Good").status_code == 200
    fac.post(a(graded, f"/{aid}/release"), {"student_ids": None})
    assert rows(graded, aid)["s1"]["graded_current_version"] is True
    submit_pdf(st1, graded, aid, note="v2", content=PDF + b"\n% v2")
    row = rows(graded, aid)["s1"]
    assert row["new_version_since_grading"] is True and row["score"] == 16.0          # waits for review
    shown = st1.get(la(graded, "/results")).json()["results"]
    assert [(r["score"], r["feedback"]) for r in shown] == [(16.0, "Good")]          # last release preserved
    # grading again links the new version
    score(graded, aid, s1, 18)
    assert rows(graded, aid)["s1"]["graded_current_version"] is True


def test_students_see_their_activity_state(graded):
    aid = make_manual(graded, "activity", "Poster", points="10", category_key="activity")
    item = next(i for i in graded["st1"].get(la(graded, "/assessments")).json() if i["id"] == aid)
    assert item["state"] == "available" and item["submissions"] == [] and item["result"] is None
    assert "score" not in item and item["can_submit"] is True
