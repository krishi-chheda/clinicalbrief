"""Phase 8a: persistent record search (full-text on Postgres, substring on SQLite), scoped and audited."""
import uuid

import pytest

from app.core.database import SessionLocal
from app.ingestion import synthea
from app.ingestion.core import det_id
from app.models.models import AuditLog, Patient
from test_ingestion import run, synthea_dir


def search(client, auth, role="clinician", **body):
    return client.post("/api/v1/search/records", headers=auth(role), json={"expand": False, **body})


def upload(client, auth, patient_id, text, role="clinician"):
    r = client.post("/api/v1/documents/upload", headers=auth(role), data={"patient_id": patient_id},
                    files={"file": (f"{uuid.uuid4().hex[:6]}.txt", text)})
    return r.json()["document_id"]


@pytest.fixture
def imported(client, db, world, tmp_path):
    """A Synthea patient (record: pharyngitis, acetaminophen started 2020-01-01, penicillin allergy) assigned
    to the clinician, so clinician-scoped searches can see it."""
    path, src = synthea_dir(tmp_path)
    run(db, synthea, path)
    pid = det_id("synthea", "patients", src)
    db.query(Patient).filter_by(patient_id=pid).update({Patient.assigned_clinician_id: world["users"]["clinician"]})
    db.commit()
    return pid


@pytest.fixture
def db(client):
    s = SessionLocal()
    yield s
    s.close()


def kinds(r):
    return {h["kind"] for h in r.json()["hits"]}


def test_notes_and_record_are_searchable_and_scoped(client, auth, world, imported):
    marker = f"zebrafinch{uuid.uuid4().hex[:6]}"
    upload(client, auth, world["mine"], f"Patient reports wheeze. Observed a {marker} pattern on auscultation.".encode())
    upload(client, auth, world["other"], f"Unassigned patient {marker} note.".encode(), role="admin")
    r = search(client, auth, query=marker)
    hits = [h for h in r.json()["hits"] if h["kind"] == "note"]
    assert r.status_code == 200 and [h["patient_id"] for h in hits] == [world["mine"]]  # never the unassigned one
    assert "⟦" in hits[0]["snippet"]  # the match is marked in the snippet
    assert {h["patient_id"] for h in search(client, auth, "admin", query=marker).json()["hits"]} == {world["mine"], world["other"]}

    r = search(client, auth, query="penicillin", patient_id=imported)
    assert kinds(r) == {"allergy"} and r.json()["hits"][0]["label"] == "Penicillin allergy"


def test_query_words_need_not_be_adjacent(client, auth, world):
    marker = f"quokka{uuid.uuid4().hex[:6]}"
    upload(client, auth, world["mine"], f"Chronic {marker} cough worsening at night.".encode())
    assert "note" in kinds(search(client, auth, query=f"{marker} night"))
    assert "note" not in kinds(search(client, auth, query=f"{marker} unrelatedword"))


def test_medication_changes_in_a_date_range(client, auth, imported):
    body = dict(query="acetaminophen", patient_id=imported, kinds=["medication"])
    inside = search(client, auth, date_from="2019-06-01", date_to="2020-06-30", **body).json()["hits"]
    assert [(h["event"], h["date"][:10]) for h in inside] == [("started", "2020-01-01")]
    assert search(client, auth, date_from="2021-01-01", **body).json()["hits"] == []


def test_expansion_widens_the_search_without_inventing_hits(client, auth, imported, monkeypatch):
    from app.services import grounded_copilot, llm
    monkeypatch.setattr(llm.local_llm, "check", lambda: None)
    monkeypatch.setattr(grounded_copilot, "expand_query", lambda _llm, q: ["acetaminophen", "paracetamol"])
    r = search(client, auth, query="pain relief", patient_id=imported, expand=True, kinds=["medication"])
    body = r.json()
    assert body["expanded"] and "acetaminophen" in body["terms"]
    assert [h["label"] for h in body["hits"]] == ["Acetaminophen 325 MG"]


def test_without_the_model_search_is_literal_and_says_so(client, auth, imported):
    body = search(client, auth, query="pain relief", patient_id=imported, expand=True).json()  # tests have no LLM
    assert body["hits"] == [] and not body["expanded"] and "unavailable" in body["note"]


def test_researchers_get_no_note_text(client, auth, world):
    marker = f"wombat{uuid.uuid4().hex[:6]}"
    upload(client, auth, world["mine"], f"Phone 0412 345 678, {marker} findings.".encode())
    body = search(client, auth, "researcher", query=marker).json()
    assert body["notes_included"] is False and "note" not in {h["kind"] for h in body["hits"]}
    assert "0412" not in str(body)


def test_search_is_audited_without_the_query(client, auth, world):
    secret = f"secretterm{uuid.uuid4().hex[:6]}"
    search(client, auth, query=secret)
    db = SessionLocal()
    log = db.query(AuditLog).filter_by(action_type="search_records").order_by(AuditLog.timestamp.desc()).first()
    db.close()
    assert log and secret not in (log.extraction_source or "")


def test_inaccessible_patient_filter_is_404(client, auth, world):
    assert search(client, auth, query="cough", patient_id=world["other"]).status_code == 404
