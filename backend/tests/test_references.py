import io
from email.message import Message

import pytest
from helpers import Api, make_account, t
from reportlab.pdfgen import canvas
from test_study import ai, ask, chunks_of, conversation  # noqa: F401
from test_teaching import new_item

from app.features.study import reference_fetch as rf

PUBLIC = "93.184.216.34"
HOSTS = {"example.org": [PUBLIC], "internal.test": ["10.0.0.5"], "localhost": ["127.0.0.1"],
         "meta.test": ["169.254.169.254"], "v6.test": ["::1"], "mixed.test": [PUBLIC, "192.168.1.9"],
         "other.org": ["93.184.216.35"]}
ARTICLE = ("<html><head><style>.x{}</style><script>alert(1)</script></head><body><nav>menu links</nav>"
           "<h1>Pricing strategies</h1><p>Cost-plus pricing adds a fixed margin to the unit cost of a "
           "product. Value-based pricing starts from what customers are willing to pay.</p>"
           "<footer>copyright</footer></body></html>")


class FakeResponse:
    def __init__(self, status=200, body=b"", ctype="text/html; charset=utf-8", extra=None):
        self.status, self.body = status, body
        self.headers = Message()
        self.headers["Content-Type"] = ctype
        for key, value in (extra or {}).items():
            self.headers[key] = value

    def getheader(self, name, default=None):
        return self.headers.get(name, default)

    def read(self, n=-1):
        return self.body if n < 0 else self.body[:n]


class FakeNet:
    """Scripted responses; records which address each connection was pinned to."""

    def __init__(self):
        self.script, self.connections = [], []

    def __call__(self, address, port, timeout=7):
        net = self

        class Conn:
            def request(self, method, path, headers=None):
                net.connections.append({"address": address, "port": port, "path": path,
                                        "host": (headers or {}).get("Host")})

            def getresponse(self):
                return net.script.pop(0)

            def close(self):
                pass
        return Conn()


@pytest.fixture
def net(monkeypatch):
    fake = FakeNet()
    monkeypatch.setattr(rf, "HTTPConnection", fake)

    def resolve(host, port, type=None):
        if host not in HOSTS:
            raise OSError("no such host")
        return [(2, 1, 6, "", (ip, port)) for ip in HOSTS[host]]
    monkeypatch.setattr(rf.socket, "getaddrinfo", resolve)
    return fake


def fails(url, needle=None):
    with pytest.raises(rf.ReferenceFetchError) as caught:
        rf.fetch_reference_text(url)
    if needle:
        assert needle in str(caught.value).lower()


# ---------------- the fetcher ----------------

def test_unsafe_destinations_are_refused_before_any_connection(net):
    for url, needle in (("ftp://example.org/file", "http"), ("javascript:alert(1)", "http"),
                        ("http://user:pw@example.org/", "http"), ("http://example.org:8080/", "port"),
                        ("http://internal.test/", "public"), ("http://localhost/", "public"),
                        ("http://meta.test/latest/meta-data", "public"), ("http://v6.test/", "public"),
                        ("http://mixed.test/", "public"), ("http://nowhere.invalid/", "found"),
                        ("http://example.org/" + "a" * 2100, "long")):
        fails(url, needle)
    assert net.connections == []                                  # nothing was ever contacted


def test_connections_are_pinned_to_the_checked_public_address(net):
    net.script = [FakeResponse(200, ARTICLE.encode())]
    text = rf.fetch_reference_text("http://example.org/pricing?a=1")
    assert net.connections == [{"address": PUBLIC, "port": 80, "path": "/pricing?a=1", "host": "example.org"}]
    assert "Cost-plus pricing" in text and "alert" not in text and "menu links" not in text
    assert "copyright" not in text and "Pricing strategies" in text


def test_every_redirect_is_validated_again(net):
    net.script = [FakeResponse(302, extra={"Location": "http://internal.test/admin"})]
    fails("http://example.org/start", "public")                    # a public page cannot bounce us inward
    net.script = [FakeResponse(301, extra={"Location": "/next"}), FakeResponse(200, ARTICLE.encode())]
    assert "Cost-plus" in rf.fetch_reference_text("http://example.org/start")      # relative redirects are fine
    net.script = [FakeResponse(301, extra={"Location": "http://other.org/x"}),
                  FakeResponse(200, ARTICLE.encode())]
    assert "Cost-plus" in rf.fetch_reference_text("http://example.org/start")
    assert net.connections[-1]["address"] == "93.184.216.35"                         # re-resolved and re-pinned
    net.script = [FakeResponse(302, extra={"Location": "/again"}) for _ in range(5)]
    fails("http://example.org/loop", "too many")


def test_bad_responses_are_refused(net):
    cases = [(FakeResponse(404), "error"), (FakeResponse(200, b"x", extra={"Content-Length": "9999999"}), "large"),
             (FakeResponse(200, b"x" * 1_600_000), "large"),
             (FakeResponse(200, b"x", extra={"Content-Encoding": "gzip"}), "compressed"),
             (FakeResponse(200, b"GIF89a", ctype="image/gif"), "web page"),
             (FakeResponse(200, b"<p>short</p>"), "too little")]
    for response, needle in cases:
        net.script = [response]
        fails("http://example.org/p", needle)


def test_pdf_references_are_read_with_a_page_limit(net):
    buffer = io.BytesIO()
    page = canvas.Canvas(buffer)
    page.drawString(72, 700, "Break-even analysis shows the number of units needed to cover all costs "
                             "and is a core entrepreneurship tool.")
    page.save()
    net.script = [FakeResponse(200, buffer.getvalue(), ctype="application/pdf")]
    assert "Break-even analysis" in rf.fetch_reference_text("http://example.org/a.pdf")


# ---------------- the faculty workflow ----------------

def reference_item(c, url="https://example.org/pricing"):
    item = new_item(c, "reference", "Pricing article")
    counter = c["fac"].get(t(c, f"/items/{item['id']}")).json()["draft"]["counter"]
    c["fac"].put(t(c, f"/items/{item['id']}/draft"), {"expected_counter": counter,
                                                      "title": "Pricing article", "reference_url": url})
    return item["id"]


def snap_url(c, item, suffix):
    return t(c, f"/items/{item}/reference/{suffix}")


def publish_reference(c, item):
    draft = c["fac"].get(t(c, f"/items/{item}")).json()["draft"]
    return c["fac"].post(t(c, f"/items/{item}/draft/publish"), {"expected_counter": draft["counter"]})


def test_a_link_alone_is_never_study_material(db, course, ai, monkeypatch):  # noqa: F811
    monkeypatch.setattr("app.features.study.references.fetch_reference_text", lambda url: ARTICLE)
    item = reference_item(course)
    assert publish_reference(course, item).status_code == 200
    assert chunks_of(db, item) == []                                          # published, but no approved text
    assert course["fac"].get(t(course, f"/items/{item}")).json()["published"]["study_chunks"] == 0
    cid = conversation(course["st1"], course)
    reply = ask(course["st1"], course, cid, "Explain cost-plus pricing")
    assert reply.json()["assistant"]["sources"] == [] and ai.calls == []


def test_extract_review_approve_then_publish_feeds_study_help(db, course, ai, monkeypatch):  # noqa: F811
    text = "Cost-plus pricing adds a fixed margin to the unit cost of a product. " * 3
    monkeypatch.setattr("app.features.study.references.fetch_reference_text", lambda url: text)
    fac, item = course["fac"], reference_item(course)
    extracted = fac.post(snap_url(course, item, "extract"))
    assert extracted.status_code == 200
    body = extracted.json()
    assert body["status"] == "extracted" and body["method"] == "fetched"
    assert body["source_url"] == "https://example.org/pricing" and "Cost-plus" in body["text"]
    # editing the text without approving keeps it a draft of the snapshot
    edited = fac.put(snap_url(course, item, "snapshot"), {"text": body["text"] + " Reviewed by the teacher.",
                                                          "approve": False})
    assert edited.json()["status"] == "extracted"
    approved = fac.put(snap_url(course, item, "snapshot"), {"text": edited.json()["text"], "approve": True})
    assert approved.json()["status"] == "approved" and approved.json()["approved_at"]
    assert publish_reference(course, item).status_code == 200
    assert [c.locator for c in chunks_of(db, item)] == ["Reference"]
    ai.answer = "Ang cost-plus pricing ay nagdaragdag ng margin [S1]."
    cid = conversation(course["st1"], course)
    reply = ask(course["st1"], course, cid, "Ano ang cost-plus pricing?").json()["assistant"]
    assert reply["sources"][0]["title"] == "Pricing article" and "Reviewed by the teacher" in ai.system()
    assert [m["action"] for m in course["admin"].get("/api/audit").json()
            if m["action"].startswith("reference.")] == ["reference.approved", "reference.extracted"]


def test_approved_text_follows_the_link_into_a_new_draft_only_while_it_is_unchanged(db, course, ai, monkeypatch):  # noqa: F811
    monkeypatch.setattr("app.features.study.references.fetch_reference_text", lambda url: ARTICLE)
    fac, item = course["fac"], reference_item(course)
    fac.post(snap_url(course, item, "extract"))
    fac.put(snap_url(course, item, "snapshot"), {"text": "x" * 80 + " pricing", "approve": True})
    publish_reference(course, item)
    draft = fac.post(t(course, f"/items/{item}/draft")).json()["draft"]
    carried = fac.get(snap_url(course, item, "snapshot")).json()
    assert carried["revision_state"] == "draft" and carried["snapshot"]["status"] == "approved"
    # changing the link drops the old text: a different page needs its own review
    fac.put(t(course, f"/items/{item}/draft"), {"expected_counter": draft["counter"], "title": "Pricing article",
                                                "reference_url": "https://other.org/different"})
    assert fac.get(snap_url(course, item, "snapshot")).json()["snapshot"] is None
    assert publish_reference(course, item).status_code == 200
    assert chunks_of(db, item) == []                                           # the new version has no approved text


def test_unreadable_links_and_manual_text(db, course, monkeypatch):
    def refuse(url):
        raise rf.ReferenceFetchError("There is too little readable text at this link.")
    monkeypatch.setattr("app.features.study.references.fetch_reference_text", refuse)
    fac, item = course["fac"], reference_item(course)
    failed = fac.post(snap_url(course, item, "extract"))
    assert failed.status_code == 422 and failed.json()["error"]["code"] == "reference_unreadable"
    short = fac.put(snap_url(course, item, "snapshot"), {"text": "too short", "approve": True})
    assert short.status_code == 422 and short.json()["error"]["code"] == "text_too_short"
    manual = fac.put(snap_url(course, item, "snapshot"), {
        "text": "Pasted by the teacher: the marketing mix has four Ps, product, price, place and promotion.",
        "approve": True})
    assert manual.status_code == 200 and manual.json()["method"] == "manual" and manual.json()["status"] == "approved"
    publish_reference(course, item)
    assert len(chunks_of(db, item)) == 1


def test_reference_endpoints_are_faculty_only_and_respect_closed_terms(db, course, monkeypatch):
    monkeypatch.setattr("app.features.study.references.fetch_reference_text", lambda url: ARTICLE)
    fac, item = course["fac"], reference_item(course)
    stranger = Api(make_account(db, "other@example.com", "faculty").email)
    for who, code in ((course["st1"], 403), (course["admin"], 403), (stranger, 404)):
        assert who.post(snap_url(course, item, "extract")).status_code == code
        assert who.get(snap_url(course, item, "snapshot")).status_code == code
    lesson_item = new_item(course, "lesson", "Not a link")["id"]
    assert fac.post(snap_url(course, lesson_item, "extract")).status_code == 422
    course["admin"].post(f"/api/terms/{course['term']['id']}/close")
    closed = fac.post(snap_url(course, item, "extract"))
    assert closed.status_code == 409 and closed.json()["error"]["code"] == "term_closed"
