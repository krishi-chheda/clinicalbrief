"""Phase 6: cross-patient review queue, bulk review, history and governance stats."""
import uuid

from app.core.database import SessionLocal
from app.models.models import AuditLog, ReviewHistory

NOTE = b"Patient has hypertension and asthma. Started lisinopril 10 mg daily."


def note_for(client, auth, patient_id, role="clinician"):
    r = client.post("/api/v1/documents/upload", headers=auth(role), data={"patient_id": patient_id},
                    files={"file": (f"{uuid.uuid4().hex[:6]}.txt", NOTE)})
    return r.json()["document_id"]


def queue(client, auth, role="clinician", **params):
    return client.get("/api/v1/review/queue", headers=auth(role), params=params)


def test_queue_is_scoped_to_accessible_patients(client, auth, world):
    mine = note_for(client, auth, world["mine"])
    other = note_for(client, auth, world["other"], role="admin")  # unassigned: clinician must not see it
    clinician_docs = {i["document_id"] for i in queue(client, auth, limit=200).json()}
    admin_docs = {i["document_id"] for i in queue(client, auth, "admin", limit=200).json()}
    assert mine in clinician_docs and other not in clinician_docs and {mine, other} <= admin_docs
    r = queue(client, auth, patient_id=world["mine"], entity_type="Disease")
    assert r.status_code == 200 and int(r.headers["X-Total-Count"]) >= 2
    assert all(i["entity_type"] == "Disease" and i["method"] == "rule-based" and i["evidence"] for i in r.json())


def test_roles_that_cannot_review_get_403(client, auth):
    for role in ("auditor", "researcher"):
        assert queue(client, auth, role).status_code == 403
        assert client.post("/api/v1/review/bulk", headers=auth(role),
                           json={"entity_ids": ["x"], "status": "approved"}).status_code == 403


def test_bulk_review_is_audited_all_or_nothing_and_undoable(client, auth, world):
    doc = note_for(client, auth, world["mine"])
    ids = [i["entity_id"] for i in queue(client, auth, patient_id=world["mine"], limit=200).json() if i["document_id"] == doc]
    other_doc = note_for(client, auth, world["other"], role="admin")
    foreign = [i["entity_id"] for i in queue(client, auth, "admin", limit=200).json() if i["document_id"] == other_doc]

    # One entity the clinician can't access sinks the whole request; nothing changes.
    r = client.post("/api/v1/review/bulk", headers=auth("clinician"), json={"entity_ids": ids + foreign[:1], "status": "approved"})
    assert r.status_code == 404
    assert all(i["review_status"] == "pending" for i in queue(client, auth, limit=200).json() if i["entity_id"] in ids)

    r = client.post("/api/v1/review/bulk", headers=auth("clinician"), json={"entity_ids": ids, "status": "approved"})
    assert r.status_code == 200 and r.json()["updated"] == len(ids)
    approved = {i["entity_id"] for i in queue(client, auth, status="approved", limit=200).json()}
    assert set(ids) <= approved
    db = SessionLocal()
    assert db.query(ReviewHistory).filter(ReviewHistory.entity_id.in_(ids), ReviewHistory.action == "approved").count() == len(ids)
    assert db.query(AuditLog).filter(AuditLog.action_type == "review_approved",
                                     AuditLog.user_id == world["users"]["clinician"]).count() >= len(ids)
    db.close()

    # Undo = reset to pending, itself recorded in history.
    client.post("/api/v1/review/bulk", headers=auth("clinician"), json={"entity_ids": ids[:1], "status": "pending", "from_status": "approved"})
    assert ids[0] in {i["entity_id"] for i in queue(client, auth, limit=200).json()}
    mine = client.get("/api/v1/review/history", headers=auth("clinician")).json()
    assert mine[0]["action"] == "pending" and mine[0]["entity_id"] == ids[0]


def test_bulk_review_rejects_edit_and_oversized_batches(client, auth):
    assert client.post("/api/v1/review/bulk", headers=auth("clinician"),
                       json={"entity_ids": ["a"], "status": "edited"}).status_code == 422
    assert client.post("/api/v1/review/bulk", headers=auth("clinician"),
                       json={"entity_ids": [str(i) for i in range(201)], "status": "approved"}).status_code == 422


def test_history_everyone_is_governance_only(client, auth):
    assert client.get("/api/v1/review/history?everyone=true", headers=auth("clinician")).status_code == 403
    assert client.get("/api/v1/review/history?everyone=true", headers=auth("auditor")).status_code == 200
    assert client.get("/api/v1/review/history", headers=auth("auditor")).status_code == 403  # auditors don't review


def test_stats_are_real_counts(client, auth, world):
    note_for(client, auth, world["mine"])
    s = client.get("/api/v1/review/stats", headers=auth("auditor")).json()
    assert s["pending"]["total"] == sum(t["pending"] for t in s["by_type"])
    assert s["pending"]["total"] == s["pending"]["under_1_day"] + s["pending"]["1_to_7_days"] + s["pending"]["over_7_days"]
    for t in s["by_type"]:
        if t["decided"] == 0:
            assert t["rates"] == {"approved": None, "edited": None, "rejected": None}  # never a made-up rate
    assert client.get("/api/v1/review/stats", headers=auth("clinician")).status_code == 403


def test_stale_page_cannot_overwrite_a_colleagues_decision(client, auth, world):
    """N-15: bulk only changes entities still in the state the reviewer saw."""
    doc = note_for(client, auth, world["mine"], role="admin")
    eid = next(i["entity_id"] for i in queue(client, auth, "admin", limit=200).json() if i["document_id"] == doc)
    assert client.post("/api/v1/review/bulk", headers=auth("consultant"), json={"entity_ids": [eid], "status": "rejected"}).status_code == 200
    r = client.post("/api/v1/review/bulk", headers=auth("admin"), json={"entity_ids": [eid], "status": "approved"})  # stale: saw "pending"
    assert r.status_code == 409 and eid in r.json()["detail"]["entity_ids"]
    assert eid in {i["entity_id"] for i in queue(client, auth, "admin", status="rejected", limit=200).json()}


def test_undoing_an_edit_restores_the_original_term_and_code(client, auth, world):
    """N-16: undo returns the entity to exactly what the AI extracted."""
    doc = note_for(client, auth, world["mine"])
    item = next(i for i in queue(client, auth, limit=200).json() if i["document_id"] == doc and i["entity_text"].lower() == "hypertension")
    assert item["icd10_code"] == "I10"
    client.post(f"/api/v1/documents/entities/{item['entity_id']}/review", headers=auth("clinician"),
                json={"status": "edited", "edited_text": "asthma"})
    edited = next(i for i in queue(client, auth, status="edited", limit=200).json() if i["entity_id"] == item["entity_id"])
    assert edited["entity_text"] == "asthma" and edited["icd10_code"] != "I10"
    r = client.post("/api/v1/review/bulk", headers=auth("clinician"),
                    json={"entity_ids": [item["entity_id"]], "status": "pending", "from_status": "edited"})
    assert r.status_code == 200
    back = next(i for i in queue(client, auth, limit=200).json() if i["entity_id"] == item["entity_id"])
    assert back["entity_text"].lower() == "hypertension" and back["icd10_code"] == "I10"


def test_own_history_follows_current_access(client, auth, world):
    """N-17: when a clinician loses a patient, their history for that patient is no longer shown."""
    from app.models.models import Patient
    p = client.post("/api/v1/patients", headers=auth("clinician"), json={
        "first_name": "Temp", "last_name": uuid.uuid4().hex[:8], "date_of_birth": "1980-01-01", "gender": "Male"}).json()
    doc = note_for(client, auth, p["patient_id"])
    eid = next(i["entity_id"] for i in queue(client, auth, limit=200).json() if i["document_id"] == doc)
    client.post("/api/v1/review/bulk", headers=auth("clinician"), json={"entity_ids": [eid], "status": "approved"})
    assert eid in {h["entity_id"] for h in client.get("/api/v1/review/history?limit=200", headers=auth("clinician")).json()}
    db = SessionLocal()
    db.query(Patient).filter_by(patient_id=p["patient_id"]).update({Patient.assigned_clinician_id: None}); db.commit(); db.close()
    assert eid not in {h["entity_id"] for h in client.get("/api/v1/review/history?limit=200", headers=auth("clinician")).json()}


def test_single_edit_is_guarded_against_stale_pages(client, auth, world):
    """N-18: the per-entity endpoint refuses (409) when from_status is given and no longer current."""
    doc = note_for(client, auth, world["mine"])
    eid = next(i["entity_id"] for i in queue(client, auth, limit=200).json() if i["document_id"] == doc)
    client.post("/api/v1/review/bulk", headers=auth("consultant"), json={"entity_ids": [eid], "status": "rejected"})
    r = client.post(f"/api/v1/documents/entities/{eid}/review", headers=auth("clinician"),
                    json={"status": "edited", "edited_text": "asthma", "from_status": "pending"})
    assert r.status_code == 409
    assert eid in {i["entity_id"] for i in queue(client, auth, status="rejected", limit=200).json()}
    # Without from_status (older callers, e.g. the note view) behaviour is unchanged.
    assert client.post(f"/api/v1/documents/entities/{eid}/review", headers=auth("clinician"),
                       json={"status": "approved"}).status_code == 200
