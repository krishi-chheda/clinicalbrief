"""v1.0.1 round 2 (B): which of the patient's own coded record items a note mentions. Linking, not AI extraction."""
import datetime
from conftest import token_for
from app.core.database import SessionLocal
from app.models.models import Allergy, ClinicalNote, Diagnosis, Document, Medication, Procedure


def _note(world, text, patient="mine"):
    db = SessionLocal()
    try:
        pid = world[patient]
        d = Document(patient_id=pid, file_name="links", file_type="txt", status="completed")
        db.add(d); db.flush()
        db.add(ClinicalNote(document_id=d.document_id, patient_id=pid, original_text=text))
        db.add_all([
            Diagnosis(patient_id=pid, display="Hypertension (disorder)", code="38341003", code_system="http://snomed.info/sct",
                      onset_at=datetime.datetime(2015, 3, 1), clinical_status="active"),
            Diagnosis(patient_id=pid, display="Childhood asthma (disorder)", code="233678006"),
            Diagnosis(patient_id=pid, display="Full-time employment (finding)", code="160903007"),
            Diagnosis(patient_id=pid, display="Medication review due (situation)", code="314529007"),
            Medication(patient_id=pid, medication_name="lisinopril 10 mg oral tablet", code="314076", status="active"),
            Procedure(patient_id=pid, procedure_name="Depression screening (procedure)", code="171207006"),
            Allergy(patient_id=pid, allergen="Peanut (substance)"),
        ])
        db.commit()
        return d.document_id
    finally:
        db.close()


def test_links_only_what_the_note_mentions(client, world):
    doc = _note(world, "History of hypertension. Takes lisinopril 10 mg oral tablet. Depression screening done. "
                       "Hypertension stable. Full-time employment. Medication review due.")   # social: not linked
    r = client.get(f"/api/v1/documents/{doc}/record-links", headers={"Authorization": f"Bearer {token_for(world['users']['clinician'])}"})
    assert r.status_code == 200, r.text
    links = {(l["kind"], l["name"]): l for l in r.json()["links"]}
    assert set(links) == {("condition", "Hypertension"), ("medication", "lisinopril 10 mg oral tablet"),
                          ("procedure", "Depression screening")}                    # asthma and peanut: not mentioned
    h = links[("condition", "Hypertension")]
    assert h["code"] == "38341003" and h["status"] == "active" and h["date"].startswith("2015-03-01")
    assert h["evidence"] == "History of hypertension."                              # first sentence that mentions it


def test_links_follow_patient_access(client, world):
    """Same rule as every note endpoint: the clinician sees assigned patients only, and gets 404 otherwise."""
    h = {"Authorization": f"Bearer {token_for(world['users']['clinician'])}"}
    assert client.get(f"/api/v1/documents/{_note(world, 'History of hypertension.')}/record-links", headers=h).status_code == 200
    doc = _note(world, "History of hypertension.", patient="other")
    assert client.get(f"/api/v1/documents/{doc}/record-links", headers=h).status_code == 404


def test_linking_coverage_counts_labelled_mentions(client, world, tmp_path):
    import json
    from app.services.evaluation import linking_coverage
    text = "History of hypertension. Fatigue. Takes lisinopril 10 mg oral tablet."
    doc = _note(world, text)
    (tmp_path / "notes").mkdir(); (tmp_path / "gold").mkdir()
    (tmp_path / "notes" / f"{doc}.txt").write_text(text, encoding="utf-8")
    (tmp_path / "gold" / f"{doc}.json").write_text(json.dumps({"note_id": doc, "mentions": [
        {"text": "hypertension", "type": "Disease"}, {"text": "fatigue", "type": "Symptom"},
        {"text": "lisinopril 10 mg oral tablet", "type": "Medication"}]}), encoding="utf-8")
    db = SessionLocal()
    try:
        r = linking_coverage(db, tmp_path)
    finally:
        db.close()
    assert (r["targets"], r["linked"], r["links_not_labelled"]) == (3, 2, 0)   # fatigue is not in the record
    assert r["by_type"]["Symptom"]["coverage"] == 0
