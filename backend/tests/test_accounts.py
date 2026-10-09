from conftest import sign_in
from sqlalchemy import select

from app.features.accounts.models import Account, AccountToken, AuditEvent, AuthSession
from app.security import digest


def test_health_and_csrf(client, db, actors, headers):
    assert client.get("/api/health").status_code == 200
    payload={"email":"admin@example.com", "password":"a-test-password-2026"}
    assert client.post("/api/auth/login", json=payload).status_code == 403
    assert client.post("/api/auth/login", headers={**headers,"Origin":"https://evil.example"}, json=payload).status_code == 403
    auth=sign_in(client,headers)
    assert client.get("/api/accounts").status_code == 200
    assert client.post("/api/auth/logout",headers=auth).status_code == 200
    assert client.get("/api/accounts").status_code == 401

def test_invitation_password_and_replay(client, db, actors, headers, sent):
    auth=sign_in(client,headers)
    response=client.post("/api/accounts",headers=auth,json={"email":"new@example.com","display_name":"New teacher","role":"faculty"})
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "invited"
    assert "password_hash" not in response.json()
    email,token,_purpose=sent[-1]
    stored=db.scalar(select(AccountToken).where(AccountToken.token_hash==digest(token)))
    assert stored and stored.token_hash != token
    body={"token":token,"password":"new-teacher-password"}
    assert client.post("/api/auth/accept-invitation",headers=auth,json=body).status_code == 200
    assert client.post("/api/auth/accept-invitation",headers=auth,json=body).status_code == 422
    response=client.post("/api/auth/login",headers=auth,json={"email":email,"password":body["password"]})
    assert response.status_code == 200
    assert client.get("/api/accounts").status_code == 403

def test_roles_cannot_administer(client,db,actors,headers):
    for role in ("faculty","student"):
        auth=sign_in(client,headers,role)
        assert client.get("/api/accounts").status_code == 403
        assert client.get("/api/accounts/count").status_code == 403
        assert client.get("/api/audit").status_code == 403
        assert client.post("/api/accounts",headers=auth,json={"email":"other@example.com","display_name":"Other","role":"admin"}).status_code == 403
        assert client.post("/api/auth/logout",headers=auth).status_code == 200
        headers={**headers,"X-CSRF-Token":client.get("/api/auth/session").json()["csrf"]}

def test_reset_revokes_existing_session(client,db,actors,headers,sent):
    auth=sign_in(client,headers)
    assert client.post("/api/auth/reset-request",headers=auth,json={"email":"admin@example.com"}).status_code == 202
    body={"token":sent[-1][1],"password":"replacement-password"}
    assert client.post("/api/auth/reset-password",headers=auth,json=body).status_code == 200
    assert client.get("/api/accounts").status_code == 401
    fresh={**headers,"X-CSRF-Token":client.get("/api/auth/session").json()["csrf"]}
    assert client.post("/api/auth/reset-password",headers=fresh,json=body).status_code == 422
    assert client.post("/api/auth/login",headers=fresh,json={"email":"admin@example.com","password":body["password"]}).status_code == 200

def test_last_admin_and_deactivation(client,db,actors,headers):
    auth=sign_in(client,headers)
    assert client.patch(f"/api/accounts/{actors[0].id}/status",headers=auth,json={"status":"inactive"}).status_code == 409
    response=client.patch(f"/api/accounts/{actors[1].id}/status",headers=auth,json={"status":"inactive"})
    assert response.status_code == 200
    client.post("/api/auth/logout",headers=auth)
    fresh={**headers,"X-CSRF-Token":client.get("/api/auth/session").json()["csrf"]}
    assert client.post("/api/auth/login",headers=fresh,json={"email":"faculty@example.com","password":"a-test-password-2026"}).status_code == 401

def test_handover_retains_previous_actor(client,db,actors,headers,sent):
    auth=sign_in(client,headers)
    response=client.post(f"/api/accounts/{actors[0].id}/handover",headers=auth,
                         json={"incoming_owner":"Incoming head","reason":"New appointment"})
    assert response.status_code == 200
    token=sent[-1][1]
    assert client.post("/api/auth/accept-invitation",headers=auth,
                       json={"token":token,"password":"incoming-head-password"}).status_code == 200
    assert client.get("/api/accounts").status_code == 401
    db.expire_all()
    account=db.get(Account,actors[0].id)
    assert account.display_name == "Incoming head" and account.ownership_generation == 2
    event=db.scalar(select(AuditEvent).where(AuditEvent.action=="account.handed_over"))
    assert event.actor_label == "Admin" and event.ownership_generation == 1

def test_expired_session(client,db,actors,headers):
    from datetime import timedelta

    from app.features.accounts.models import now
    sign_in(client,headers)
    session=db.scalar(select(AuthSession).where(AuthSession.account_id==actors[0].id))
    session.expires_at=now()-timedelta(seconds=1)
    db.commit()
    assert client.get("/api/accounts").status_code == 401


def test_accounts_can_be_filtered_by_status_and_counted(client, db, actors, headers):
    auth = sign_in(client, headers)
    everyone = client.get("/api/accounts?page_size=100").json()
    assert client.get("/api/accounts/count").json() == {"total": len(everyone)}
    assert client.post("/api/accounts", headers=auth, json={"email": "waiting@example.com", "display_name": "Waiting", "role": "faculty"}).status_code == 201
    invited = client.get("/api/accounts?status=invited").json()
    assert [a["email"] for a in invited] == ["waiting@example.com"]
    assert client.get("/api/accounts/count?status=invited").json() == {"total": 1}
    assert client.get("/api/accounts/count?role=faculty&status=invited&search=wait").json() == {"total": 1}
    assert client.get("/api/accounts/count?status=bogus").status_code == 422
    assert client.get("/api/accounts/count?search=zzz-nobody").json() == {"total": 0}
    client.post("/api/auth/logout", headers=auth)
    assert client.get("/api/accounts/count").status_code == 401


def test_bulk_send_links_reports_successes_and_email_failures(client, db, actors, headers, monkeypatch):
    from fastapi import HTTPException

    invited = Account(email="waiting@example.com", display_name="Waiting", role="faculty",
                      status="invited")
    db.add(invited)
    db.commit()
    sent = []

    def send_link(account, token, purpose):
        if account.id == invited.id:
            raise HTTPException(status_code=503, detail={
                "code": "email_unavailable", "message": "Email could not be sent. Please try again."
            })
        sent.append((account.email, purpose))

    monkeypatch.setattr("app.features.accounts.commands.send_link", send_link)
    auth = sign_in(client, headers)
    response = client.post("/api/accounts/send-links", headers=auth, json={
        "account_ids": [str(invited.id), str(actors[2].id)]
    })

    assert response.status_code == 200, response.text
    assert response.json()["sent"] == 1
    assert response.json()["failed"] == 1
    assert [result["status"] for result in response.json()["results"]] == ["failed", "sent"]
    assert response.json()["results"][0]["message"] == "Email could not be sent. Please try again."
    assert sent == [("student@example.com", "reset")]
    events = db.scalars(select(AuditEvent).where(AuditEvent.action == "account.link_sent")).all()
    assert [event.entity_id for event in events] == [str(actors[2].id)]


def test_bulk_send_links_validates_before_sending_and_requires_admin(client, db, actors, headers, sent):
    auth = sign_in(client, headers)
    invited = Account(email="waiting@example.com", display_name="Waiting", role="faculty",
                      status="invited")
    inactive = Account(email="inactive@example.com", display_name="Inactive", role="faculty",
                       status="inactive")
    db.add_all([invited, inactive])
    db.commit()

    response = client.post("/api/accounts/send-links", headers=auth, json={
        "account_ids": [str(actors[2].id), str(inactive.id)]
    })
    assert response.status_code == 409
    assert sent == []

    response = client.post("/api/accounts/send-links", headers=auth, json={
        "account_ids": [str(invited.id), str(invited.id)]
    })
    assert response.status_code == 422
    assert sent == []

    client.post("/api/auth/logout", headers=auth)
    faculty_auth = sign_in(client, headers, "faculty")
    response = client.post("/api/accounts/send-links", headers=faculty_auth, json={
        "account_ids": [str(invited.id)]
    })
    assert response.status_code == 403


def test_emailed_links_have_a_clear_subject(monkeypatch):
    import smtplib
    from types import SimpleNamespace

    from app.features.accounts import commands
    seen = []

    class FakeSmtp:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def send_message(self, message): seen.append(message["Subject"])
        def starttls(self): pass
        def login(self, *a): pass
    monkeypatch.setattr(smtplib, "SMTP", FakeSmtp)
    account = SimpleNamespace(email="x@example.com", display_name="X")
    for purpose in ("invite", "reset", "handover"):
        commands.send_link(account, "tok", purpose)
    assert seen[0].startswith("You are invited") and seen[1] == "Reset your LearnSync password"
    assert "ownership" in seen[2] and not any(s == f"LearnSync: {p}" for s, p in zip(seen, ("invite", "reset", "handover")))
