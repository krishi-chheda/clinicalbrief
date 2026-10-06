"""Regression tests for the remaining R-08 items: paging, read auditing, researcher note view, limits, sign-ups."""
import uuid

import pytest
from sqlalchemy import text

from app.core.database import SessionLocal, is_sqlite
from app.models.models import AuditLog
from conftest import token_for

NOTE = b"Patient has hypertension. Phone 0412 345 678."


@pytest.fixture
def note(client, auth, world):
    """A note for the patient assigned to `clinician`."""
    r = client.post("/api/v1/documents/upload", headers=auth("clinician"), data={"patient_id": world["mine"]},
                    files={"file": ("note.txt", NOTE)})
    return r.json()["document_id"]


def last_log(action):
    db = SessionLocal()
    log = db.query(AuditLog).filter_by(action_type=action).order_by(AuditLog.timestamp.desc()).first()
    db.close()
    return log


def test_audit_logs_are_paged(client, auth):
    r = client.get("/api/v1/audit/logs?limit=2", headers=auth("admin"))
    assert r.status_code == 200 and len(r.json()) <= 2
    assert int(r.headers["X-Total-Count"]) >= len(r.json())
    assert len(client.get("/api/v1/audit/logs?limit=100000", headers=auth("admin")).json()) <= 500


def test_record_and_note_reads_are_audited_without_content(client, auth, world, note):
    client.get(f"/api/v1/patients/{world['mine']}/record", headers=auth("clinician"))
    log = last_log("view_record")
    assert log and world["mine"] in log.extraction_source and log.user_id == world["users"]["clinician"]
    client.get(f"/api/v1/documents/{note}/redacted", headers=auth("clinician"))
    log = last_log("view_note_text")
    assert log and note in log.extraction_source and "hypertension" not in log.extraction_source


def test_researcher_gets_redacted_text_only(client, auth, note):
    clinician = client.get(f"/api/v1/documents/{note}/redacted", headers=auth("clinician")).json()
    researcher = client.get(f"/api/v1/documents/{note}/redacted", headers=auth("researcher")).json()
    assert "0412 345 678" in clinician["original_text"]
    assert researcher["original_text"] is None and "0412 345 678" not in researcher["redacted_text"]

    # N-13: an unprocessed note (no stored redaction) is redacted on the fly; nothing original may leak.
    from app.models.models import ClinicalNote
    db = SessionLocal()
    db.query(ClinicalNote).filter_by(document_id=note).update({ClinicalNote.redacted_text: None}); db.commit(); db.close()
    researcher = client.get(f"/api/v1/documents/{note}/redacted", headers=auth("researcher")).json()
    assert researcher["original_text"] is None and researcher["redactions"]
    assert "0412 345 678" not in str(researcher)
    assert "0412 345 678" in str(client.get(f"/api/v1/documents/{note}/redacted", headers=auth("clinician")).json())


def test_insights_reads_are_audited(client, auth, note):
    client.get(f"/api/v1/documents/{note}/insights", headers=auth("clinician"))
    log = last_log("view_note_insights")
    assert log and note in log.extraction_source


def test_length_limits(client, auth, world):
    r = client.post(f"/api/v1/copilot/conversations/{world['mine']}", headers=auth("clinician"), json={"title": "x" * 256})
    assert r.status_code == 422
    r = client.post("/api/v1/dashboard/layout", headers=auth("clinician"), json={"layout_json": "x" * 20_001})
    assert r.status_code == 422


def test_new_signup_has_no_access_until_a_role_is_assigned(client):
    if is_sqlite:
        pytest.skip("The sign-up trigger lives in Postgres (TEST_PG=1)")
    uid = str(uuid.uuid4())
    db = SessionLocal()
    db.execute(text("INSERT INTO auth.users (id, email) VALUES (:id, :email)"), {"id": uid, "email": f"new-{uid[:6]}@test.local"})
    db.commit()
    role = db.execute(text("select role from public.users where id = :id"), {"id": uid}).scalar()
    db.close()
    assert role == "pending"
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token_for(uid)}"}).status_code == 403
