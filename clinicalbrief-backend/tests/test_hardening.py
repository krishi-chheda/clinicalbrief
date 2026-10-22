"""Security audit fixes S-1..S-6: headers, rate limits, stream cap, input limits, hidden docs, JWT issuer."""
import os
import time

import jwt
import pytest

from app.api.v1 import deps
from app.core import security
from app.core.config import settings


@pytest.fixture
def limits_on(monkeypatch):
    """Rate limits on, with an empty history (the rest of the suite runs with them off)."""
    monkeypatch.setattr(settings, "RATE_LIMITS", True)
    deps._hits.clear()
    yield
    deps._hits.clear()


# --- S-1: security headers -------------------------------------------------------------------------------------------

@pytest.mark.parametrize("path", ["/", "/api/v1/patients"])   # a normal response and a 401
def test_security_headers_on_every_response(client, path):
    h = client.get(path).headers
    assert h["X-Content-Type-Options"] == "nosniff" and h["X-Frame-Options"] == "DENY"
    assert h["Referrer-Policy"] == "no-referrer" and "max-age=" in h["Strict-Transport-Security"]
    assert "default-src 'none'" in h["Content-Security-Policy"] and "frame-ancestors 'none'" in h["Content-Security-Policy"]


# --- S-2: rate limits and the stream cap ------------------------------------------------------------------------------

def test_search_is_rate_limited_per_user(client, auth, limits_on, monkeypatch):
    monkeypatch.setitem(deps.RATE_LIMITS, "search", (2, 60))
    body = {"query": "aspirin", "expand": False}
    codes = [client.post("/api/v1/search/records", headers=auth("admin"), json=body).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    r = client.post("/api/v1/search/records", headers=auth("admin"), json=body)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1
    # Another user has their own allowance.
    assert client.post("/api/v1/search/records", headers=auth("consultant"), json=body).status_code == 200


def test_limits_are_off_when_switched_off(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMITS", False)
    monkeypatch.setitem(deps.RATE_LIMITS, "search", (1, 60))
    body = {"query": "aspirin", "expand": False}
    assert [client.post("/api/v1/search/records", headers=auth("coder"), json=body).status_code for _ in range(3)] == [200] * 3


def test_one_stream_per_user(client, auth, world, limits_on):
    cid = client.post(f"/api/v1/copilot/conversations/{world['mine']}", headers=auth("clinician"), json={"title": "t"}).json()["conversation_id"]
    uid = world["users"]["clinician"]
    deps._streams[uid] = 1                                   # an answer is already running for this user
    try:
        r = client.post(f"/api/v1/copilot/chat/{cid}/stream", headers=auth("clinician"), json={"content": "meds?"})
        assert r.status_code == 429 and r.headers["Retry-After"]
    finally:
        deps._streams[uid] = 0
    # The slot is released after a stream finishes, so the next one is accepted.
    for _ in range(2):
        assert client.post(f"/api/v1/copilot/chat/{cid}/stream", headers=auth("clinician"), json={"content": "meds?"}).status_code == 200
    assert deps._streams.get(uid, 0) == 0


# --- S-3: input limits -----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("field,value", [("first_name", "x" * 101), ("last_name", "y" * 101), ("gender", "z" * 21), ("first_name", "")])
def test_patient_fields_are_bounded(client, auth, field, value):
    body = {"first_name": "Ada", "last_name": "Lovelace", "gender": "Female", "date_of_birth": "1990-01-01", field: value}
    assert client.post("/api/v1/patients", headers=auth("clinician"), json=body).status_code == 422


def test_search_and_qa_text_are_bounded(client, auth):
    assert client.post("/api/v1/search/query", headers=auth("admin"), json={"query": "q" * 501}).status_code == 422
    assert client.post("/api/v1/search/qa", headers=auth("admin"), json={"document_id": "x", "question": "q" * 2001}).status_code == 422


# --- S-4: API docs hidden by default ----------------------------------------------------------------------------------

def test_api_docs_are_off_by_default(client):
    assert not settings.EXPOSE_API_DOCS
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path
    assert client.get("/").json()["docs_url"] is None


# --- S-6: JWT issuer --------------------------------------------------------------------------------------------------

def test_token_must_come_from_this_project(world, monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://proj.supabase.co")
    now, uid = int(time.time()), world["users"]["admin"]
    sign = lambda **claims: jwt.encode({"sub": uid, "aud": "authenticated", "exp": now + 60, **claims},
                                       os.environ["JWT_SECRET"], algorithm="HS256")
    assert security.decode_supabase_token(sign(iss="https://proj.supabase.co/auth/v1"))["sub"] == uid
    assert security.decode_supabase_token(sign(iss="https://other.supabase.co/auth/v1")) is None   # another project
    assert security.decode_supabase_token(sign()) is None                                          # no issuer at all


def test_rate_limit_memory_is_bounded(client, auth, limits_on):
    """N-40: users with nothing inside their window are forgotten once the table grows past its bound."""
    stale = time.monotonic() - 3600
    for i in range(5001):
        deps._hits[("search", f"gone-{i}")] = deps.deque([stale])
    assert client.post("/api/v1/search/records", headers=auth("admin"), json={"query": "aspirin", "expand": False}).status_code == 200
    assert not any(k[1].startswith("gone-") for k in deps._hits) and len(deps._hits) == 1
