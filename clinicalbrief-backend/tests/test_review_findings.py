"""Regression tests for the 2026-09-26 independent review (R-01, R-04, R-06, R-07, R-08)."""
import datetime, uuid

import pytest
from fhir.resources.R4B.bundle import Bundle

from app.core.database import SessionLocal
from app.models.models import Document, Entity, ProcessingJob, RiskScore, Summary

NOTE = b"Patient has hypertension. Started lisinopril 10 mg daily. No history of diabetes."


@pytest.fixture
def patient(client, auth):
    """A fresh patient assigned to `clinician`, with one processed note (entities still pending)."""
    p = client.post("/api/v1/patients", headers=auth("clinician"), json={
        "first_name": "Review", "last_name": uuid.uuid4().hex[:8], "date_of_birth": "1970-01-01", "gender": "Female"}).json()
    doc = client.post("/api/v1/documents/upload", headers=auth("clinician"), data={"patient_id": p["patient_id"]},
                      files={"file": ("note.txt", NOTE)}).json()
    return p["patient_id"], doc["document_id"]


def entities(client, auth, doc_id):
    return {e["entity_text"].lower(): e for e in client.get(f"/api/v1/documents/{doc_id}/insights", headers=auth("clinician")).json()["entities"]}


def ask(client, auth, pid, question):
    conv = client.post(f"/api/v1/copilot/conversations/{pid}", headers=auth("clinician"), json={"title": "t"}).json()
    return client.post(f"/api/v1/copilot/chat/{conv['conversation_id']}", headers=auth("clinician"), json={"content": question}).json()["content"]


# --- R-01: consumers ignore unreviewed AI output -------------------------------------------------

def test_pending_entities_are_not_treated_as_fact(client, auth, patient):
    pid, doc_id = patient
    ents = entities(client, auth, doc_id)
    assert {"hypertension", "lisinopril"} <= set(ents) and "diabetes" not in ents  # negation held
    assert all(e["review_status"] == "pending" and e["confidence"] is None for e in ents.values())

    r = client.get(f"/api/v1/fhir/export/{pid}", headers=auth("clinician"))
    assert [e["resource"]["resourceType"] for e in r.json()["entry"]] == ["Patient"]
    assert int(r.headers["X-Pending-Entities"]) == len(ents)

    answer = ask(client, auth, pid, "What diagnoses were made?")
    assert "hypertension" not in answer.lower() and "awaiting human review" in answer

    risk = client.get(f"/api/v1/patients/{pid}/risk", headers=auth("clinician")).json()
    assert risk["reviewed_entities"] == 0 and risk["pending_entities"] == len(ents)
    assert not any("ypertension" in f for f in risk["risk_factors"])


def test_reviewed_entities_are_used_and_fhir_bundle_validates(client, auth, patient):
    pid, doc_id = patient
    ents = entities(client, auth, doc_id)
    for name in ("hypertension", "lisinopril"):
        client.post(f"/api/v1/documents/entities/{ents[name]['entity_id']}/review", headers=auth("clinician"), json={"status": "approved"})

    bundle = client.get(f"/api/v1/fhir/export/{pid}", headers=auth("clinician")).json()
    Bundle.model_validate(bundle)  # R-04: structurally valid (fhir.resources R4B models)
    full_urls = {e["fullUrl"] for e in bundle["entry"]}
    by_type = {e["resource"]["resourceType"]: e["resource"] for e in bundle["entry"]}
    assert set(by_type) == {"Patient", "Condition", "MedicationStatement"}
    for rtype in ("Condition", "MedicationStatement"):
        assert by_type[rtype]["subject"]["reference"] in full_urls  # references resolve inside the bundle
        assert by_type[rtype]["meta"]["tag"][0]["code"] == "ai-extracted-human-reviewed"
    assert by_type["Condition"]["verificationStatus"]["coding"][0]["code"] == "unconfirmed"
    assert by_type["Condition"]["code"]["coding"][0]["code"] == "I10"
    assert "coding" not in by_type["MedicationStatement"]["medicationCodeableConcept"]  # no fake RxNorm "unknown"
    assert "unknown" not in str(bundle).replace("'status': 'unknown'", "")

    assert "hypertension" in ask(client, auth, pid, "What diagnoses were made?").lower()
    risk = client.get(f"/api/v1/patients/{pid}/risk", headers=auth("clinician")).json()
    assert risk["reviewed_entities"] == 2 and "Hypertension mentioned (reviewed)" in risk["risk_factors"]


# --- R-08: FHIR export roles, read-only GET /risk ------------------------------------------------

@pytest.mark.parametrize("role,expected", [("auditor", 403), ("researcher", 403), ("coder", 200), ("consultant", 200)])
def test_fhir_export_roles(client, auth, patient, role, expected):
    assert client.get(f"/api/v1/fhir/export/{patient[0]}", headers=auth(role)).status_code == expected


def test_risk_get_is_read_only(client, auth, patient):
    db = SessionLocal()
    before = db.query(RiskScore).count()
    for _ in range(3):
        client.get(f"/api/v1/patients/{patient[0]}/risk", headers=auth("clinician"))
    assert db.query(RiskScore).count() == before
    db.close()


# --- R-07: pipeline is idempotent and retryable ---------------------------------------------------

def test_failed_run_rolls_back_and_reprocess_yields_one_set(client, auth, monkeypatch):
    from app.services.ai_pipeline import ai_orchestrator
    p = client.post("/api/v1/patients", headers=auth("clinician"), json={
        "first_name": "Retry", "last_name": uuid.uuid4().hex[:8], "date_of_birth": "1970-01-01", "gender": "Male"}).json()
    real_summary = ai_orchestrator.generate_summary
    monkeypatch.setattr(ai_orchestrator, "generate_summary", lambda text: (_ for _ in ()).throw(RuntimeError("boom")))
    doc_id = client.post("/api/v1/documents/upload", headers=auth("clinician"), data={"patient_id": p["patient_id"]},
                         files={"file": ("note.txt", NOTE)}).json()["document_id"]  # fails after the entity step

    db = SessionLocal()
    assert db.get(Document, doc_id).status == "failed"
    assert db.query(Entity).filter_by(document_id=doc_id).count() == 0  # nothing half-written

    monkeypatch.setattr(ai_orchestrator, "generate_summary", real_summary)
    assert client.post(f"/api/v1/documents/{doc_id}/process", headers=auth("clinician")).status_code == 202
    assert client.post(f"/api/v1/documents/{doc_id}/process", headers=auth("clinician")).status_code == 409  # completed
    db.expire_all()
    n_entities = db.query(Entity).filter_by(document_id=doc_id).count()
    assert n_entities == len(entities(client, auth, doc_id)) == 2
    assert db.query(Summary).filter_by(document_id=doc_id).count() == 1
    db.close()


def test_stale_processing_can_be_retried(client, auth, patient):
    _, doc_id = patient
    db = SessionLocal()
    doc, job = db.get(Document, doc_id), db.query(ProcessingJob).filter_by(document_id=doc_id).one()
    doc.status = "processing"
    db.commit()
    assert client.post(f"/api/v1/documents/{doc_id}/process", headers=auth("clinician")).status_code == 409  # fresh run
    job.updated_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
    db.commit()
    assert client.post(f"/api/v1/documents/{doc_id}/process", headers=auth("clinician")).status_code == 202  # crashed run
    db.expire_all()
    assert db.get(Document, doc_id).status == "completed"
    assert db.query(Summary).filter_by(document_id=doc_id).count() == 1
    db.close()


# --- R-06: no approval figure without reviews -----------------------------------------------------

def test_approval_rate_is_null_without_reviews(client, auth, monkeypatch):
    from app.models.models import Entity
    stats = client.get("/api/v1/patients/governance/stats", headers=auth("admin")).json()["review_metrics"]
    assert "accuracy_rate" not in stats
    if stats["total_reviewed"] == 0:
        assert stats["approval_rate"] is None
    else:
        assert stats["approval_rate"] == round(stats["approved"] / stats["total_reviewed"], 4)
    # Force the zero-review case regardless of test order: mark everything pending, then restore.
    db = SessionLocal()
    saved = dict(db.query(Entity.entity_id, Entity.review_status).all())
    try:
        db.query(Entity).update({Entity.review_status: "pending"}); db.commit()
        stats = client.get("/api/v1/patients/governance/stats", headers=auth("admin")).json()["review_metrics"]
        assert stats["total_reviewed"] == 0 and stats["approval_rate"] is None
    finally:
        for eid, status in saved.items():
            db.query(Entity).filter_by(entity_id=eid).update({Entity.review_status: status})
        db.commit(); db.close()


def test_pending_count_header_is_readable_cross_origin(client, auth, patient):
    r = client.get(f"/api/v1/fhir/export/{patient[0]}", headers={**auth("clinician"), "Origin": "http://localhost:3000"})
    assert "x-pending-entities" in r.headers.get("access-control-expose-headers", "").lower()
