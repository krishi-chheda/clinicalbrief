"""Regression tests for the 2026-10-01 follow-up review (N-02 .. N-06)."""
import uuid

from app.core.database import SessionLocal
from app.models.models import DocumentComparison
from app.services.ai_pipeline import ai_orchestrator

NOTE = b"Patient has hypertension. Aspirin 81 mg daily."


def new_patient(client, auth, *notes):
    p = client.post("/api/v1/patients", headers=auth("clinician"), json={
        "first_name": "Review", "last_name": uuid.uuid4().hex[:8], "date_of_birth": "1970-01-01", "gender": "Male"}).json()
    docs = [client.post("/api/v1/documents/upload", headers=auth("clinician"), data={"patient_id": p["patient_id"]},
                        files={"file": (f"note{i}.txt", n)}).json()["document_id"] for i, n in enumerate(notes)]
    return p["patient_id"], docs


def entity_ids(client, auth, doc_id):
    ents = client.get(f"/api/v1/documents/{doc_id}/insights", headers=auth("clinician")).json()["entities"]
    return {e["entity_text"].lower(): e["entity_id"] for e in ents}


def extracted(text):
    return {(e["entity_text"].lower(), e["entity_type"]) for e in ai_orchestrator.extract_entities(text)}


# --- N-02: graph works with unscored (rule-based) entities and draws reviewed ones only -----------

def test_graph_handles_null_confidence_and_hides_pending(client, auth):
    pid, (doc,) = new_patient(client, auth, NOTE)
    r = client.get(f"/api/v1/patients/{pid}/graph", headers=auth("clinician"))
    assert r.status_code == 200
    body = r.json()
    assert [n["type"] for n in body["nodes"]] == ["Patient"] and body["pending_review"] == 2

    ids = entity_ids(client, auth, doc)
    client.post(f"/api/v1/documents/entities/{ids['hypertension']}/review", headers=auth("clinician"), json={"status": "approved"})
    body = client.get(f"/api/v1/patients/{pid}/graph", headers=auth("clinician")).json()
    labels = {n["label"].lower(): n for n in body["nodes"]}
    assert "hypertension" in labels and "aspirin" not in labels and body["pending_review"] == 1
    assert "not scored" in labels["hypertension"]["details"]


# --- N-03: comparison uses reviewed entities only and is read-only --------------------------------

def test_compare_ignores_pending_and_writes_nothing(client, auth):
    pid, docs = new_patient(client, auth, NOTE, b"Patient has asthma. Started metformin 500 mg.")
    db = SessionLocal()
    before = db.query(DocumentComparison).filter_by(patient_id=pid).count()
    body = client.get(f"/api/v1/documents/compare/{pid}", headers=auth("clinician")).json()
    assert body["can_compare"] and body["pending_review"] == 4
    for group in ("diseases", "medications", "allergies"):
        assert all(v == [] for v in body["analysis"][group].values()), group
    assert db.query(DocumentComparison).filter_by(patient_id=pid).count() == before
    db.close()


# --- N-04: affirmation ends a negation's scope; N-05: relatives' conditions are not the patient's -----

def test_affirmation_ends_negation_scope():
    assert ("hypertension", "Disease") in extracted("Negative for asthma, positive for hypertension.")
    assert ("asthma", "Disease") not in extracted("Negative for asthma, positive for hypertension.")
    assert ("headache", "Symptom") in extracted("Patient denies fever, reports headache.")
    assert ("fever", "Symptom") not in extracted("Patient denies fever, reports headache.")
    assert ("fever", "Symptom") not in extracted("Fever has been ruled out.")  # post-negation still works


def test_family_history_is_not_the_patients():
    assert not {e for e in extracted("Family history of diabetes.") if e[1] == "Disease"}
    assert not {e for e in extracted("Mother had atrial fibrillation.") if e[1] == "Disease"}
    assert ("hypertension", "Disease") in extracted("Mother had diabetes; patient has hypertension.")


# --- N-07: the family check must not swallow the patient's own findings ---------------------------

def test_family_check_keeps_the_patients_findings():
    assert ("asthma", "Disease") in extracted("Patient lives with his mother and has asthma.")
    assert ("asthma", "Disease") in extracted("Father with hypertension, patient with asthma.")
    assert ("hypertension", "Disease") not in extracted("Father with hypertension, patient with asthma.")
    assert ("diabetes", "Disease") not in extracted("Patient's mother had diabetes.")


# --- Review 5: N-11 CLI reads are audited; N-12 AI medication mentions are not "takes" ----------------

def test_cli_ask_is_audited_without_content(client, auth, monkeypatch):
    from app import cli
    from app.models.models import AuditLog
    pid, _ = new_patient(client, auth)
    monkeypatch.setattr("app.services.grounded_copilot.grounded_answer", lambda db, p, q: {
        "mode": "local-llm:fake", "grounding": "grounded", "evidence_count": 0, "search_terms": [],
        "answer": "SECRET ANSWER", "citations": [], "warnings": []})
    cli.main(["ask", pid, "SECRET QUESTION"])
    db = SessionLocal()
    log = db.query(AuditLog).filter_by(action_type="copilot_query_cli").order_by(AuditLog.timestamp.desc()).first()
    db.close()
    assert log and pid in log.extraction_source and "grounded" in log.extraction_source
    assert "SECRET" not in (log.extraction_source or "") + (log.model_used or "")


def test_reviewed_ai_medication_is_mentioned_not_taken(client, auth):
    pid, (doc,) = new_patient(client, auth, NOTE)
    ids = entity_ids(client, auth, doc)
    client.post(f"/api/v1/documents/entities/{ids['aspirin']}/review", headers=auth("clinician"), json={"status": "approved"})
    g = client.get(f"/api/v1/patients/{pid}/graph", headers=auth("clinician")).json()
    med = next(n for n in g["nodes"] if n["label"].lower() == "aspirin")
    assert med["source"] == "ai"
    assert [e["label"] for e in g["edges"] if e["target"] == med["id"]] == ["mentioned in note"]


# --- Review 11: N-20 remote DB is opt-in; N-21 bundle invariants ----------------------------------------

def test_remote_database_requires_explicit_opt_in():
    import os, subprocess, sys
    env = {k: v for k, v in os.environ.items() if k != "CLINICALBRIEF_ALLOW_REMOTE_DB"}
    env["DATABASE_URL"] = "postgresql://user:<db-password>@db.example.invalid:5432/postgres"
    probe = [sys.executable, "-c", "import app.core.database"]
    refused = subprocess.run(probe, env=env, capture_output=True, text=True)
    assert refused.returncode != 0 and "CLINICALBRIEF_ALLOW_REMOTE_DB" in refused.stderr
    allowed = subprocess.run(probe, env={**env, "CLINICALBRIEF_ALLOW_REMOTE_DB": "1"}, capture_output=True, text=True)
    assert allowed.returncode == 0, allowed.stderr  # engine creation is lazy: no connection is attempted
    # N-23: the host can also come from ?host= or PGHOST when the URL itself has none.
    for extra in ({"DATABASE_URL": "postgresql:///postgres?host=db.example.invalid"},
                  {"DATABASE_URL": "postgresql:///postgres", "PGHOST": "db.example.invalid"}):
        r = subprocess.run(probe, env={**env, **extra}, capture_output=True, text=True)
        assert r.returncode != 0 and "db.example.invalid" in r.stderr, extra
    local = subprocess.run(probe, env={**env, "DATABASE_URL": "postgresql:///postgres?host=/tmp/pg"}, capture_output=True, text=True)
    assert local.returncode == 0, local.stderr  # a Unix socket directory is local


def test_validate_bundle_catches_dangling_references_and_con4():
    from app.services.fhir_generator import validate_bundle
    patient = {"fullUrl": "urn:uuid:p", "resource": {"resourceType": "Patient"}, "request": {"method": "POST", "url": "Patient"}}
    def cond(**extra):
        return {"fullUrl": "urn:uuid:c", "request": {"method": "POST", "url": "Condition"}, "resource": {
            "resourceType": "Condition", "subject": {"reference": "urn:uuid:p"}, "code": {"text": "x"}, **extra}}
    bundle = lambda *e: {"resourceType": "Bundle", "type": "transaction", "entry": list(e)}
    status = lambda c: {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical", "code": c}]}
    assert validate_bundle(bundle(patient, cond())) is None
    assert "does not resolve" in validate_bundle(bundle(cond()))
    assert "con-4" in validate_bundle(bundle(patient, cond(abatementDateTime="2020-01-01", clinicalStatus=status("active"))))
    assert validate_bundle(bundle(patient, cond(abatementDateTime="2020-01-01", clinicalStatus=status("resolved")))) is None
