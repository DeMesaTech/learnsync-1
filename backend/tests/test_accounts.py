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
