"""Phase 1 data foundation: adapters, validation, idempotency, dry runs, rollback, record API."""
import base64, json, uuid
from pathlib import Path

import pytest

from app.core.database import SessionLocal
from app.ingestion import synthea
from app.ingestion.core import Batch, det_id, run_import
from app.models.models import (
    Patient, Encounter, Document, ClinicalNote, Diagnosis, Medication, Allergy, Procedure, Observation,
    ImportErrorRecord,
)


@pytest.fixture
def db(client):  # `client` ensures the schema exists
    s = SessionLocal()
    yield s
    s.close()


def run(db, adapter, path, **kw):
    dry_run = kw.pop("dry_run", False)
    return run_import(db, adapter.SOURCE, str(path), adapter.build(path, **kw), adapter.WRITE_ORDER, dry_run=dry_run)


# --- Synthea fixture ----------------------------------------------------------------------------

def synthea_dir(tmp_path: Path) -> tuple[Path, str]:
    pid, enc, med = (str(uuid.uuid4()) for _ in range(3))
    subj = {"reference": f"urn:uuid:{pid}"}
    code = lambda c, d, s="http://snomed.info/sct": {"coding": [{"system": s, "code": c, "display": d}], "text": d}
    note = base64.b64encode(b"# Chief Complaint\nCough for 3 days.").decode()
    resources = [
        {"resourceType": "Patient", "id": pid, "gender": "female", "birthDate": "1980-02-03",
         "name": [{"use": "official", "family": "Tester", "given": ["Ada"]}]},
        {"resourceType": "Encounter", "id": enc, "subject": subj, "class": {"code": "AMB"},
         "type": [code("1", "General examination")], "period": {"start": "2020-01-01T10:00:00+00:00"}},
        {"resourceType": "Condition", "id": str(uuid.uuid4()), "subject": subj, "encounter": {"reference": f"urn:uuid:{enc}"},
         "code": code("195662009", "Acute viral pharyngitis (disorder)"),
         "clinicalStatus": {"coding": [{"code": "resolved"}]}, "onsetDateTime": "2020-01-01T10:00:00+00:00"},
        {"resourceType": "Medication", "id": med, "code": code("313782", "Acetaminophen 325 MG", "http://www.nlm.nih.gov/research/umls/rxnorm")},
        {"resourceType": "MedicationRequest", "id": str(uuid.uuid4()), "subject": subj, "status": "active",
         "medicationReference": {"reference": f"urn:uuid:{med}"}, "authoredOn": "2020-01-01T10:00:00+00:00",
         "dosageInstruction": [{"timing": {"repeat": {"frequency": 2, "period": 1, "periodUnit": "d"}},
                                "doseAndRate": [{"doseQuantity": {"value": 1, "unit": "tablet"}}]}]},
        {"resourceType": "AllergyIntolerance", "id": str(uuid.uuid4()), "patient": subj, "code": code("91936005", "Penicillin allergy"),
         "criticality": "high", "category": ["medication"],
         "reaction": [{"manifestation": [code("247472004", "Wheal (finding)")], "severity": "moderate"}]},
        {"resourceType": "Procedure", "id": str(uuid.uuid4()), "subject": subj, "code": code("1", "Throat swab"),
         "performedPeriod": {"start": "2020-01-01T10:05:00+00:00"}},
        {"resourceType": "Observation", "id": str(uuid.uuid4()), "subject": subj, "code": code("85354-9", "Blood pressure", "http://loinc.org"),
         "category": [{"coding": [{"code": "vital-signs"}]}], "effectiveDateTime": "2020-01-01T10:01:00+00:00",
         "component": [{"code": code("8480-6", "Systolic", "http://loinc.org"), "valueQuantity": {"value": 120, "unit": "mm[Hg]"}},
                       {"code": code("8462-4", "Diastolic", "http://loinc.org"), "valueQuantity": {"value": 80, "unit": "mm[Hg]"}}]},
        {"resourceType": "DocumentReference", "id": str(uuid.uuid4()), "subject": subj, "date": "2020-01-01T10:30:00+00:00",
         "type": code("34117-2", "History and physical note", "http://loinc.org"),
         "context": {"encounter": [{"reference": f"urn:uuid:{enc}"}]}, "content": [{"attachment": {"data": note}}]},
        # --- invalid records: must be rejected and logged, not imported ---
        {"resourceType": "Condition", "id": str(uuid.uuid4()), "subject": subj},                             # no code
        {"resourceType": "Observation", "id": str(uuid.uuid4()), "subject": {"reference": "urn:uuid:someone-else"},
         "code": code("1", "Heart rate")},                                                                     # wrong patient
        {"resourceType": "DocumentReference", "id": str(uuid.uuid4()), "subject": subj,
         "content": [{"attachment": {"data": "!!not-base64!!"}}]},                                           # bad note
        {"resourceType": "Claim", "id": str(uuid.uuid4())},                                                  # unsupported
    ]
    d = tmp_path / "synthea"
    d.mkdir()
    (d / "patient.json").write_text(json.dumps({"resourceType": "Bundle", "type": "transaction",
                                                 "entry": [{"resource": r} for r in resources]}))
    (d / "hospitalInformation.json").write_text(json.dumps({"resourceType": "Bundle", "type": "batch", "entry": []}))
    return d, pid


def test_synthea_import_maps_validates_and_logs(db, tmp_path):
    path, src_pid = synthea_dir(tmp_path)
    r = run(db, synthea, path)
    assert r.status == "completed" and r.error_count == 3
    c = r.counts
    for table in ["patients", "encounters", "diagnoses", "medications", "allergies", "procedures", "observations", "documents"]:
        assert c[f"{table}.written"] == 1, table
    assert c["skipped.Claim"] == 1 and c["skipped.non_patient_bundle"] == 1

    pid = det_id("synthea", "patients", src_pid)
    p = db.get(Patient, pid)
    assert (p.first_name, p.last_name, p.gender, str(p.date_of_birth)) == ("Ada", "Tester", "Female", "1980-02-03")
    assert p.source_system == "synthea" and p.source_id == src_pid and p.provenance == "imported"

    dx = db.query(Diagnosis).filter_by(patient_id=pid).one()
    assert dx.code_system == "http://snomed.info/sct" and dx.clinical_status == "resolved" and dx.encounter_id
    med = db.query(Medication).filter_by(patient_id=pid).one()
    assert (med.medication_name, med.dose, med.frequency) == ("Acetaminophen 325 MG", "1 tablet", "2 per 1 d")
    allergy = db.query(Allergy).filter_by(patient_id=pid).one()
    assert (allergy.reaction, allergy.severity, allergy.criticality) == ("Wheal (finding)", "moderate", "high")
    obs = db.query(Observation).filter_by(patient_id=pid).one()
    assert obs.value == "Systolic: 120 mm[Hg]; Diastolic: 80 mm[Hg]" and obs.category == "vital-signs"
    doc = db.query(Document).filter_by(patient_id=pid).one()
    assert doc.status == "pending" and doc.classification == "History and physical note" and doc.encounter_id
    assert db.query(ClinicalNote).filter_by(document_id=doc.document_id).one().original_text.startswith("# Chief Complaint")

    reasons = {e.reason for e in db.query(ImportErrorRecord).filter_by(run_id=r.run_id)}
    assert reasons == {"Condition has no code/display", "subject 'someone-else' does not match bundle patient",
                       "note text is not valid base64 UTF-8"}


def test_reimport_is_idempotent_and_keeps_processing_state(db, tmp_path):
    path, src_pid = synthea_dir(tmp_path)
    run(db, synthea, path)
    pid = det_id("synthea", "patients", src_pid)
    doc = db.query(Document).filter_by(patient_id=pid).one()
    doc.status = "completed"
    db.commit()

    def counts():
        return [db.query(m).filter_by(patient_id=pid).count()
                for m in (Encounter, Document, Diagnosis, Medication, Allergy, Procedure, Observation)]
    before = counts()
    r2 = run(db, synthea, path)
    assert r2.status == "completed" and counts() == before
    db.expire_all()
    assert db.get(Document, doc.document_id).status == "completed"


def test_dry_run_writes_nothing(db, tmp_path):
    path, src_pid = synthea_dir(tmp_path)
    r = run(db, synthea, path, dry_run=True)
    assert r.status == "completed" and r.dry_run and r.counts["patients.read"] == 1 and "patients.written" not in r.counts
    assert db.get(Patient, det_id("synthea", "patients", src_pid)) is None
    assert r.error_count == 3  # validation still reported


def test_unexpected_failure_rolls_back_everything(db):
    src = str(uuid.uuid4())

    def build(batch: Batch):
        batch.add(Patient, {"patient_id": det_id("broken", "patients", src), "source_id": src,
                            "first_name": "X", "last_name": "Y", "gender": "Female"})
        batch.add(Encounter, {"encounter_id": str(uuid.uuid4()), "patient_id": str(uuid.uuid4())})  # FK violation on write

    r = run_import(db, "broken", "memory", build, [Patient, Encounter])
    assert r.status == "failed" and r.message
    assert db.get(Patient, det_id("broken", "patients", src)) is None


# --- API over the canonical record --------------------------------------------------------------

def test_record_endpoint_and_access(client, db, world, auth, tmp_path):
    path, src_pid = synthea_dir(tmp_path)
    run(db, synthea, path)
    pid = det_id("synthea", "patients", src_pid)  # unassigned -> clinician must not see it
    assert client.get(f"/api/v1/patients/{pid}/record", headers=auth("clinician")).status_code == 404
    rec = client.get(f"/api/v1/patients/{pid}/record", headers=auth("consultant")).json()
    assert rec["counts"] == {"encounters": 1, "diagnoses": 1, "medications": 1, "allergies": 1, "procedures": 1, "observations": 1}
    assert rec["diagnoses"][0]["source_system"] == "synthea"
    assert {e["kind"] for e in rec["timeline"]} == {"encounter", "diagnosis", "medication", "procedure"}
    assert [e["at"] for e in rec["timeline"]] == sorted((e["at"] for e in rec["timeline"]), reverse=True)


def test_graph_draws_current_record_items(client, db, world, auth, tmp_path):
    path, src_pid = synthea_dir(tmp_path)
    run(db, synthea, path)
    pid = det_id("synthea", "patients", src_pid)
    g = client.get(f"/api/v1/patients/{pid}/graph", headers=auth("consultant")).json()
    drawn = {(n["type"], n["source"]) for n in g["nodes"]}
    # Active medication and the allergy come from the record; the resolved condition is not current, so not drawn.
    assert drawn == {("Patient", "record"), ("Medication", "record"), ("Allergy", "record")}
    assert all(e["source"] == f"patient_{pid}" for e in g["edges"])
    assert g["totals"] == {"Medication": 1, "Allergy": 1} and g["pending_review"] == 0


@pytest.mark.parametrize("role,expected", [("admin", 200), ("auditor", 200), ("clinician", 403), ("researcher", 403)])
def test_import_history_access(client, auth, role, expected):
    assert client.get("/api/v1/imports", headers=auth(role)).status_code == expected


def test_process_imported_note(client, db, auth, tmp_path):
    path, src_pid = synthea_dir(tmp_path)
    run(db, synthea, path)
    doc = db.query(Document).filter_by(patient_id=det_id("synthea", "patients", src_pid)).one()
    url = f"/api/v1/documents/{doc.document_id}"
    assert client.post(f"{url}/process", headers=auth("auditor")).status_code == 403
    assert client.post(f"{url}/process", headers=auth("consultant")).status_code == 202  # background task runs in TestClient
    s = client.get(f"{url}/status", headers=auth("consultant")).json()
    assert s["status"] == "completed" and s["step"] == 9 and s["elapsed_seconds"] is not None
    assert client.get(f"{url}/insights", headers=auth("consultant")).json()["classification"] == "History and physical note"
    assert client.post(f"{url}/process", headers=auth("consultant")).status_code == 409


def test_patient_list_includes_note_count_and_last_encounter(client, db, auth, tmp_path):
    path, src_pid = synthea_dir(tmp_path)
    run(db, synthea, path)
    pid = det_id("synthea", "patients", src_pid)
    row = next(p for p in client.get("/api/v1/patients", headers=auth("consultant")).json() if p["patient_id"] == pid)
    assert row["document_count"] == 1 and row["last_encounter_at"].startswith("2020-01-01")
    assert row["source_system"] == "synthea"


def test_fhir_export_is_built_from_the_record(client, db, world, auth, tmp_path):
    """Phase 5: the bundle carries the canonical record, validates as R4, and every reference resolves."""
    from fhir.resources.R4B.bundle import Bundle
    path, src_pid = synthea_dir(tmp_path)
    run(db, synthea, path)
    pid = det_id("synthea", "patients", src_pid)
    r = client.get(f"/api/v1/fhir/export/{pid}", headers=auth("consultant"))
    assert r.status_code == 200 and r.headers["X-FHIR-Validation"] == "structural-r4: pass"
    bundle = r.json()
    Bundle.model_validate(bundle)
    by_type = {}
    for e in bundle["entry"]:
        by_type.setdefault(e["resource"]["resourceType"], []).append(e["resource"])
    assert set(by_type) == {"Patient", "Encounter", "Condition", "MedicationStatement", "AllergyIntolerance", "Procedure", "Observation"}

    # Source codes and statuses are carried, never invented.
    condition = by_type["Condition"][0]
    assert condition["code"]["coding"][0]["system"] == "http://snomed.info/sct"
    assert condition["clinicalStatus"]["coding"][0]["code"] == "resolved" and "verificationStatus" not in condition
    assert by_type["MedicationStatement"][0]["status"] == "active"
    assert by_type["Procedure"][0]["status"] == "unknown" and by_type["Observation"][0]["status"] == "unknown"
    # Multi-part values (BP) are stored as one text value, so they export as valueString, not components.
    assert by_type["Observation"][0]["valueString"] == "Systolic: 120 mm[Hg]; Diastolic: 80 mm[Hg]"
    assert all(t["code"] == "source-record" for res in bundle["entry"] for t in res["resource"].get("meta", {}).get("tag", []))
    assert by_type["Patient"][0]["identifier"][0]["value"] == src_pid

    # Every reference points at an entry in this bundle (transaction semantics).
    full_urls = {e["fullUrl"] for e in bundle["entry"]}
    refs = [v["reference"] for e in bundle["entry"] for k, v in e["resource"].items() if isinstance(v, dict) and "reference" in v]
    assert refs and all(ref in full_urls for ref in refs)
