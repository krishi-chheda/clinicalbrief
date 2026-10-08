"""Public demo sandbox (migration 0012): the anonymous 'demo' role is read-only and sees only is_demo patients,
in the API and (TEST_PG=1) in row-level security."""
import datetime
import uuid

import pytest
from sqlalchemy import text

from app.core.database import SessionLocal, is_sqlite
from app.models.models import Patient, User
from conftest import token_for
from test_security import as_user, upload  # noqa: F401 (as_user is a fixture)

MARKER = f"okapi{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="module")
def demo(client, world):
    """A demo visitor, one demo patient (with an analysed note) and the non-demo patient from `world` (with a note)."""
    db = SessionLocal()
    uid = str(uuid.uuid4())
    if is_sqlite:
        db.add(User(id=uid, email=f"anonymous-{uid}@demo.invalid", role="demo"))
    else:
        # Postgres: an anonymous Supabase sign-in (no email); the signup trigger must make it 'demo'.
        db.execute(text("INSERT INTO auth.users (id, email, is_anonymous) VALUES (:id, NULL, true)"), {"id": uid})
    shown = Patient(first_name="Demo", last_name="Patient", date_of_birth=datetime.date(1980, 5, 5), gender="Female", is_demo=True)
    db.add(shown)
    db.commit()
    shown_id = shown.patient_id
    db.close()
    admin = {"Authorization": f"Bearer {token_for(world['users']['admin'])}"}
    body = f"Patient has hypertension. Aspirin 81 mg daily. Marker {MARKER}.".encode()
    return {"user": uid, "h": {"Authorization": f"Bearer {token_for(uid)}"}, "shown": shown_id, "hidden": world["other"],
            "shown_doc": upload(client, admin, shown_id, body=body).json()["document_id"],
            "hidden_doc": upload(client, admin, world["other"], body=body).json()["document_id"]}


def demo_ids():
    db = SessionLocal()
    try:
        return {pid for (pid,) in db.query(Patient.patient_id).filter(Patient.is_demo.is_(True))}
    finally:
        db.close()


def test_demo_profile_is_valid(client, demo):
    me = client.get("/api/v1/auth/me", headers=demo["h"])
    assert me.status_code == 200 and me.json()["role"] == "demo"


def test_demo_lists_exactly_the_demo_patients(client, demo):
    listed = {p["patient_id"] for p in client.get("/api/v1/patients", headers=demo["h"]).json()}
    assert listed == demo_ids() and demo["shown"] in listed and demo["hidden"] not in listed


def test_demo_can_read_demo_patients(client, demo):
    h, pid = demo["h"], demo["shown"]
    for url in [f"/api/v1/patients/{pid}", f"/api/v1/patients/{pid}/record", f"/api/v1/patients/{pid}/graph",
                f"/api/v1/documents/patient/{pid}", f"/api/v1/documents/{demo['shown_doc']}/redacted"]:
        assert client.get(url, headers=h).status_code == 200, url
    r = client.post("/api/v1/search/records", headers=h, json={"query": MARKER, "expand": False})
    assert r.status_code == 200 and {x["patient_id"] for x in r.json()["hits"]} == {pid}


def test_non_demo_patient_is_404_everywhere(client, demo):
    h, pid = demo["h"], demo["hidden"]
    for url in [f"/api/v1/patients/{pid}", f"/api/v1/patients/{pid}/record", f"/api/v1/patients/{pid}/graph",
                f"/api/v1/patients/{pid}/risk", f"/api/v1/documents/patient/{pid}", f"/api/v1/documents/compare/{pid}",
                f"/api/v1/documents/{demo['hidden_doc']}/redacted", f"/api/v1/documents/{demo['hidden_doc']}/insights",
                f"/api/v1/copilot/conversations/{pid}"]:
        assert client.get(url, headers=h).status_code == 404, url
    assert client.post(f"/api/v1/copilot/conversations/{pid}", headers=h, json={"title": "t"}).status_code == 404
    assert client.post("/api/v1/search/records", headers=h, json={"query": MARKER, "patient_id": pid, "expand": False}).status_code == 404
    assert client.post("/api/v1/search/query", headers=h, json={"query": MARKER, "patient_id": pid}).status_code == 404
    # Global searches never return the hidden patient either.
    hits = client.post("/api/v1/search/records", headers=h, json={"query": MARKER, "expand": False}).json()["hits"]
    assert pid not in {x["patient_id"] for x in hits}
    hits = client.post("/api/v1/search/query", headers=h, json={"query": MARKER}).json()["results"]
    assert pid not in {x["patient_id"] for x in hits}


def test_demo_is_read_only(client, demo):
    h, pid, doc = demo["h"], demo["shown"], demo["shown_doc"]
    entity = client.get(f"/api/v1/documents/{doc}/insights", headers=h).json()["entities"][0]["entity_id"]
    refused = [
        upload(client, h, pid),
        client.post(f"/api/v1/documents/entities/{entity}/review", headers=h, json={"status": "approved"}),
        client.post("/api/v1/review/bulk", headers=h, json={"entity_ids": [entity], "status": "approved"}),
        client.get("/api/v1/review/queue", headers=h),
        client.post(f"/api/v1/documents/{doc}/process", headers=h),
        client.get(f"/api/v1/fhir/export/{pid}", headers=h),
        client.get("/api/v1/audit/logs", headers=h),
        client.get("/api/v1/imports", headers=h),
        client.get("/api/v1/ops/health", headers=h),
        client.get("/api/v1/ops/metrics", headers=h),
        client.get("/api/v1/patients/governance/stats", headers=h),
        client.get("/api/v1/review/stats", headers=h),
        client.post("/api/v1/patients", headers=h, json={"first_name": "X", "last_name": "Y", "gender": "Male",
                                                          "date_of_birth": "1990-01-01"}),
    ]
    assert [r.status_code for r in refused] == [403] * len(refused)


def test_demo_copilot_is_allowed_and_private(client, demo, auth):
    conv = client.post(f"/api/v1/copilot/conversations/{demo['shown']}", headers=demo["h"], json={"title": "t"})
    assert conv.status_code == 201
    cid = conv.json()["conversation_id"]
    assert client.post(f"/api/v1/copilot/chat/{cid}", headers=demo["h"], json={"content": "What medications?"}).status_code == 200
    # Another user (even a global-read role) cannot see or use the visitor's conversation.
    listed = client.get(f"/api/v1/copilot/conversations/{demo['shown']}", headers=auth("consultant")).json()
    assert cid not in {c["conversation_id"] for c in listed}
    assert client.post(f"/api/v1/copilot/chat/{cid}", headers=auth("consultant"), json={"content": "x"}).status_code == 404


# --- Postgres only: RLS and the signup trigger ----------------------------------------------------

def test_rls_demo_sees_only_demo_patients(as_user, demo):
    rows = {str(r[0]) for r in as_user(demo["user"], "select patient_id from patients")}
    assert rows == demo_ids() and demo["hidden"] not in rows
    # Child tables follow: the hidden patient's documents are invisible too.
    assert as_user(demo["user"], "select 1 from documents where patient_id = :p", {"p": demo["hidden"]}) == []


def test_rls_demo_sees_no_assigned_non_demo_patient(as_user, demo):
    """Even a non-demo patient assigned to the demo account stays hidden (the role decides, not the assignment)."""
    if is_sqlite:
        pytest.skip("Postgres only")
    db = SessionLocal()
    try:
        db.execute(text("UPDATE patients SET assigned_clinician_id = :u WHERE patient_id = :p"), {"u": demo["user"], "p": demo["hidden"]})
        db.commit()
        assert demo["hidden"] not in {str(r[0]) for r in as_user(demo["user"], "select patient_id from patients")}
    finally:
        db.execute(text("UPDATE patients SET assigned_clinician_id = NULL WHERE patient_id = :p"), {"p": demo["hidden"]})
        db.commit()
        db.close()


def test_signup_trigger_roles(client, demo):
    if is_sqlite:
        pytest.skip("the signup trigger needs Postgres with migrations applied (TEST_PG=1)")
    db = SessionLocal()
    try:
        anon = db.get(User, demo["user"])
        assert anon.role == "demo" and anon.email == f"anonymous-{demo['user']}@demo.invalid"
        uid = str(uuid.uuid4())
        db.execute(text("INSERT INTO auth.users (id, email, is_anonymous) VALUES (:id, :e, false)"),
                   {"id": uid, "e": f"real-{uid[:6]}@test.local"})
        db.commit()
        assert db.get(User, uid).role == "pending"
    finally:
        db.close()


# --- CLI: choosing the demo patients -----------------------------------------------------------

def test_flag_demo_dry_run_then_apply(client, demo, world, tmp_path, capsys):
    from app.cli import flag_demo
    from app.ingestion import synthea
    from app.ingestion.core import det_id
    from app.models.models import Document
    from test_ingestion import run, synthea_dir
    db = SessionLocal()
    before = demo_ids()
    try:
        path, src = synthea_dir(tmp_path)
        run(db, synthea, path)
        pid = det_id("synthea", "patients", src)
        upload(client, {"Authorization": f"Bearer {token_for(world['users']['admin'])}"}, pid)  # a second note
        db.query(Document).filter(Document.patient_id == pid).update({Document.status: "completed"})
        db.commit()

        flag_demo(db, 10, apply=False)
        assert pid in capsys.readouterr().out and demo_ids() == before  # dry run: printed, nothing changed

        flag_demo(db, 10, apply=True)
        flagged = demo_ids()
        assert pid in flagged and demo["shown"] not in flagged  # exactly the chosen ones; hand-made demo row cleared
    finally:
        db.query(Patient).update({Patient.is_demo: False}, synchronize_session=False)
        db.query(Patient).filter(Patient.patient_id.in_(before)).update({Patient.is_demo: True}, synchronize_session=False)
        db.commit()
        db.close()
