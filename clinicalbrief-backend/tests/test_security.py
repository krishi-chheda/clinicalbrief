"""Regression tests for the Phase 0 audit findings (auth, authorization, upload safety)."""
import time, uuid
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from conftest import token_for
from app.core import security


# --- Authentication -----------------------------------------------------------------------------

def test_supabase_style_token_with_audience_is_accepted(client, world):
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token_for(world['users']['clinician'])}"})
    assert r.status_code == 200 and r.json()["role"] == "clinician"


@pytest.mark.parametrize("kwargs", [
    {"exp_in": -120},                     # expired (beyond the 30 s clock-skew tolerance)
    {"aud": "anon"},                      # wrong audience
    {"secret": "x" * 40},                 # wrong signing key
])
def test_bad_tokens_are_401(client, world, kwargs):
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token_for(world['users']['admin'], **kwargs)}"})
    assert r.status_code == 401


def test_valid_token_without_profile_is_403_not_401(client):
    # Signed in with Supabase but no ClinicalBrief profile: re-login would not help, so not 401.
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token_for(str(uuid.uuid4()))}"})
    assert r.status_code == 403


def test_asymmetric_es256_token_verified_via_jwks(monkeypatch, world):
    key = ec.generate_private_key(ec.SECP256R1())
    token = jwt.encode({"sub": world["users"]["admin"], "aud": "authenticated", "exp": int(time.time()) + 60},
                       key, algorithm="ES256", headers={"kid": "k1"})

    class FakeJWKS:
        def get_signing_key_from_jwt(self, _):
            return type("K", (), {"key": key.public_key()})()
    monkeypatch.setattr(security, "_jwks_client", lambda: FakeJWKS())
    assert security.decode_supabase_token(token)["sub"] == world["users"]["admin"]

    forged = jwt.encode({"sub": "x", "aud": "authenticated", "exp": int(time.time()) + 60},
                        ec.generate_private_key(ec.SECP256R1()), algorithm="ES256")
    assert security.decode_supabase_token(forged) is None


# --- Patient-level authorization ----------------------------------------------------------------

def test_clinician_sees_only_assigned_patients(client, world, auth):
    ids = {p["patient_id"] for p in client.get("/api/v1/patients", headers=auth("clinician")).json()}
    assert world["mine"] in ids and world["other"] not in ids
    assert client.get(f"/api/v1/patients/{world['other']}", headers=auth("clinician")).status_code == 404
    assert client.get(f"/api/v1/fhir/export/{world['other']}", headers=auth("clinician")).status_code == 404
    assert client.get(f"/api/v1/patients/{world['other']}/graph", headers=auth("clinician")).status_code == 404


@pytest.mark.parametrize("role", ["admin", "consultant", "coder", "auditor", "researcher"])
def test_global_read_roles_see_all_patients(client, world, auth, role):
    assert client.get(f"/api/v1/patients/{world['other']}", headers=auth(role)).status_code == 200


@pytest.mark.parametrize("role,expected", [("admin", 200), ("auditor", 200), ("clinician", 403), ("coder", 403)])
def test_audit_log_access(client, auth, role, expected):
    assert client.get("/api/v1/audit/logs", headers=auth(role)).status_code == expected


# --- Uploads, review, copilot -------------------------------------------------------------------

def upload(client, headers, patient_id, name="note.txt", body=b"Patient has hypertension. Aspirin 81 mg daily."):
    return client.post("/api/v1/documents/upload", headers=headers,
                       data={"patient_id": patient_id}, files={"file": (name, body)})


@pytest.mark.parametrize("role", ["auditor", "researcher", "coder"])
def test_read_only_roles_cannot_upload(client, world, auth, role):
    assert upload(client, auth(role), world["other"]).status_code == 403


def test_clinician_cannot_upload_to_unassigned_patient(client, world, auth):
    assert upload(client, auth("clinician"), world["other"]).status_code == 404


def test_upload_filename_cannot_escape_upload_dir(client, world, auth):
    from app.core.config import settings
    r = upload(client, auth("clinician"), world["mine"], name="../../../evil.txt")
    assert r.status_code == 200
    stored = r.json()["file_url"]
    assert settings.UPLOAD_DIR.resolve() in __import__("pathlib").Path(stored).resolve().parents
    assert r.json()["file_name"] == "evil.txt"


@pytest.mark.parametrize("name,body,code", [("scan.pdf", b"%PDF-1.4", 415), ("x.txt", b"\xff\xfe\x00bad", 422), ("x.txt", b"   ", 422)])
def test_upload_rejects_unsupported_content(client, world, auth, name, body, code):
    assert upload(client, auth("clinician"), world["mine"], name=name, body=body).status_code == code


def _first_entity(client, world, auth):
    doc = upload(client, auth("clinician"), world["mine"]).json()["document_id"]
    return client.get(f"/api/v1/documents/{doc}/insights", headers=auth("clinician")).json()["entities"][0]["entity_id"]


def test_review_rules(client, world, auth):
    eid = _first_entity(client, world, auth)
    url = f"/api/v1/documents/entities/{eid}/review"
    assert client.post(url, headers=auth("clinician"), json={"status": "totally_bogus"}).status_code == 422
    assert client.post(url, headers=auth("clinician"), json={"status": "edited"}).status_code == 422
    assert client.post(url, headers=auth("auditor"), json={"status": "approved"}).status_code == 403
    r = client.post(url, headers=auth("coder"), json={"status": "approved"})
    assert r.status_code == 200 and r.json()["review_status"] == "approved"


def test_copilot_conversations_are_private(client, world, auth):
    conv = client.post(f"/api/v1/copilot/conversations/{world['mine']}", headers=auth("clinician"), json={"title": "t"}).json()
    r = client.post(f"/api/v1/copilot/chat/{conv['conversation_id']}", headers=auth("consultant"), json={"content": "meds?"})
    assert r.status_code == 404
    listed = client.get(f"/api/v1/copilot/conversations/{world['mine']}", headers=auth("consultant")).json()
    assert conv["conversation_id"] not in {c["conversation_id"] for c in listed}



def test_only_the_owner_can_delete_a_conversation(client, world, auth):
    conv = client.post(f"/api/v1/copilot/conversations/{world['mine']}", headers=auth("clinician"), json={"title": "t"}).json()
    url = f"/api/v1/copilot/conversations/{conv['conversation_id']}"
    assert client.delete(url, headers=auth("consultant")).status_code == 404
    assert client.delete(url, headers=auth("clinician")).status_code == 204
    listed = client.get(f"/api/v1/copilot/conversations/{world['mine']}", headers=auth("clinician")).json()
    assert conv["conversation_id"] not in {c["conversation_id"] for c in listed}
    assert client.delete(url, headers=auth("clinician")).status_code == 404

def test_search_does_not_leak_unassigned_patients(client, world, auth):
    upload(client, auth("admin"), world["other"], body=b"Unique marker zebrafish pneumonia.")
    hits = client.post("/api/v1/search/query", headers=auth("clinician"), json={"query": "zebrafish pneumonia"}).json()["results"]
    assert all(h["patient_id"] != world["other"] for h in hits)
    assert client.post("/api/v1/search/query", headers=auth("clinician"),
                       json={"query": "x", "patient_id": world["other"]}).status_code == 404


# --- Schema drift -------------------------------------------------------------------------------

def test_orm_matches_sql_migration(client):
    """Runs only against Postgres with migrations/ applied (TEST_DATABASE_URL)."""
    from sqlalchemy import inspect
    from app.core.database import engine, is_sqlite, Base
    if is_sqlite:
        pytest.skip("schema drift check needs the Postgres migration")
    insp = inspect(engine)
    # Database-maintained columns the app never sets (generated by Postgres), so the ORM doesn't declare them.
    db_only = {"clinical_notes": {"search_vector"}}  # migration 0011: stored full-text vector
    for table in Base.metadata.sorted_tables:
        db_cols = {c["name"]: c for c in insp.get_columns(table.name) if c["name"] not in db_only.get(table.name, set())}
        assert {c.name for c in table.columns} == set(db_cols), table.name
        for c in table.columns:  # NULL-ability must match too (e.g. AI confidence may be NULL)
            assert c.nullable == db_cols[c.name]["nullable"], f"{table.name}.{c.name}: orm nullable={c.nullable}"


def test_copilot_says_when_records_lack_an_answer(client, world, auth):
    """Audit finding: 'What is the patient's blood type?' used to be answered with an unrelated sentence."""
    upload(client, auth("clinician"), world["mine"], body=b"Patient has hypertension. Aspirin 81 mg daily.")
    conv = client.post(f"/api/v1/copilot/conversations/{world['mine']}", headers=auth("clinician"), json={"title": "t"}).json()
    r = client.post(f"/api/v1/copilot/chat/{conv['conversation_id']}", headers=auth("clinician"),
                    json={"content": "What is the patient's blood type?"}).json()
    assert "hypertension" not in r["content"].lower()
    assert "couldn't find" in r["content"].lower() or "could not find" in r["content"].lower()


# --- Row-level security (what a browser holding the publishable key can do directly) ------------

@pytest.fixture
def as_user(client):
    """Runs SQL as Supabase's `authenticated` role for a given user id, like PostgREST does."""
    from sqlalchemy import text
    from app.core.database import engine, is_sqlite
    if is_sqlite:
        pytest.skip("RLS needs Postgres with migrations applied (TEST_PG=1)")

    def run(user_id, sql, params=None, role="authenticated"):
        with engine.connect() as conn, conn.begin() as tx:
            conn.execute(text(f"SET LOCAL ROLE {role}"))
            conn.execute(text("SELECT set_config('request.jwt.claim.sub', :uid, true)"), {"uid": user_id or ""})
            try:
                result = conn.execute(text(sql), params or {})
                return result.fetchall() if result.returns_rows else result.rowcount
            finally:
                tx.rollback()  # never persist anything from these probes
    return run


def test_rls_patient_visibility(as_user, world):
    ids = lambda uid: {str(r[0]) for r in as_user(uid, "select patient_id from patients")}
    assert world["mine"] in ids(world["users"]["clinician"]) and world["other"] not in ids(world["users"]["clinician"])
    assert {world["mine"], world["other"]} <= ids(world["users"]["consultant"])
    assert as_user(None, "select patient_id from patients", role="anon") == []


def test_rls_blocks_client_writes_and_escalation(as_user, world):
    from sqlalchemy.exc import ProgrammingError
    uid = world["users"]["clinician"]
    # No UPDATE policy on users: changing your own role affects zero rows.
    assert as_user(uid, "update users set role = 'admin' where id = :id", {"id": uid}) == 0
    # No INSERT policies on clinical or audit tables: writes must go through the backend.
    for sql in ["insert into patients (first_name, last_name, gender) values ('x', 'y', 'Female')",
                "insert into audit_logs (action_type) values ('forged')"]:
        with pytest.raises(ProgrammingError, match="row-level security"):
            as_user(uid, sql)


def test_rls_audit_log_visibility(as_user, world):
    from sqlalchemy import text
    from app.core.database import engine
    q = "select count(*) from audit_logs"
    with engine.connect() as conn:
        total = conn.execute(text(q)).scalar()  # superuser: true row count
    assert as_user(world["users"]["admin"], q)[0][0] == total
    assert as_user(world["users"]["auditor"], q)[0][0] == total
    assert as_user(world["users"]["clinician"], "select * from audit_logs") == []
    assert as_user(world["users"]["researcher"], "select * from import_runs") == []


def test_rls_users_can_only_read_their_own_profile(as_user, world):
    """Review R-08: any account could list every user's email and role."""
    clinician = world["users"]["clinician"]
    rows = as_user(clinician, "select id from users")
    assert [str(r[0]) for r in rows] == [clinician]
    assert len(as_user(world["users"]["admin"], "select id from users")) >= len(world["users"])


def test_signup_trigger_function_is_not_callable_via_api(as_user, world):
    from sqlalchemy.exc import ProgrammingError
    with pytest.raises(ProgrammingError, match="permission denied"):
        as_user(world["users"]["clinician"], "select public.handle_new_user()")


# Found on first real Supabase sign-in: this machine's clock was ~1 s behind Supabase, so a fresh token's
# `iat` was "in the future" and every sign-in failed (ImmatureSignatureError). Small skew must be tolerated.
@pytest.mark.parametrize("iat_offset,ok", [(5, True), (120, False)])
def test_clock_skew_tolerance(world, iat_offset, ok):
    from app.core.security import decode_supabase_token
    now = int(time.time())
    token = jwt.encode({"sub": world["users"]["admin"], "aud": "authenticated", "iat": now + iat_offset,
                        "exp": now + 3600}, __import__("os").environ["JWT_SECRET"], algorithm="HS256")
    assert (decode_supabase_token(token) is not None) == ok
