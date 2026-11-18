"""v1.0.1 Part D: researchers see no direct identifiers (names, date of birth) anywhere in the API.
Not a validated de-identification method: clinical dates in the structured record are kept."""
import datetime
import pytest
from conftest import token_for
from app.core.database import SessionLocal
from app.models.models import Patient, Document, ClinicalNote, Summary, Entity, Diagnosis
from app.services.faiss_manager import vector_search_manager
from app.services.clinical_privacy import pseudonym, deidentify_patient, redact_names


# --- helpers -----------------------------------------------------------------------------------------------------

def test_pseudonym_is_stable_and_distinct():
    assert pseudonym("abcdef12-3456") == pseudonym("abcdef12-3456") == "Patient ABCDEF12"
    assert pseudonym("abcdef12-3456") != pseudonym("bbcdef12-3456")


def test_deidentify_patient_drops_name_and_dob_keeps_year():
    d = deidentify_patient({"patient_id": "abcdef12-x", "first_name": "Ana", "last_name": "Lee", "gender": "female",
                            "date_of_birth": datetime.date(1960, 5, 4), "deceased_date": datetime.date(2020, 1, 2)})
    assert (d["first_name"], d["last_name"]) == ("Patient", "ABCDEF12")
    assert d["date_of_birth"] is None and d["birth_year"] == 1960
    assert d["deceased_date"] is None and d["gender"] == "female" and d["deidentified"] is True
    assert deidentify_patient({"patient_id": "x", "first_name": "A", "last_name": "B", "date_of_birth": None})["birth_year"] is None


@pytest.mark.parametrize("text,names,expected", [
    ("Mr. Lee has an allergy; LEE denies pain.", ["Lee"], "Mr. [NAME] has an allergy; [NAME] denies pain."),
    ("Allergy reviewed by Al.", ["Al"], "Allergy reviewed by [NAME]."),          # whole words only
    ("Seen with O'Brien (x) today.", ["O'Brien", "(x)"], "Seen with [NAME] [NAME] today."),  # escaped, not regex
    ("Nothing to hide.", ["", "  "], "Nothing to hide."),
    ("Ana Lee-Smith", ["Lee-Smith"], "Ana [NAME]"),
])
def test_redact_names(text, names, expected):
    assert redact_names(text, names) == expected


# --- every researcher-reachable endpoint ---------------------------------------------------------------------------

FIRST, LAST, DOB = "Zebulon", "Quackenbush", datetime.date(1951, 7, 9)


@pytest.fixture
def named(client, world):
    """A processed note that mentions the patient by name, so every text path has something to leak."""
    db = SessionLocal()
    try:
        p = Patient(first_name=FIRST, last_name=LAST, date_of_birth=DOB, gender="Male")
        db.add(p); db.flush()
        text = f"{FIRST} {LAST} reports chest pain. Mr {LAST} has hypertension."
        for i in range(2):
            d = Document(patient_id=p.patient_id, file_name=f"note {i}", file_type="txt", status="completed",
                         document_date=datetime.datetime(2020, 1, 1 + i))
            db.add(d); db.flush()
            db.add(ClinicalNote(document_id=d.document_id, patient_id=p.patient_id, original_text=text, redacted_text=f"{FIRST} {LAST} reports chest pain."))
            db.add(Summary(document_id=d.document_id, summary_text=text))
            db.add(Entity(document_id=d.document_id, entity_text="hypertension", entity_type="Disease",
                          evidence=f"Mr {LAST} has hypertension.", review_status="approved"))
            vector_search_manager.add_document(d.document_id, p.patient_id, text)  # the in-memory note search
        db.add(Diagnosis(patient_id=p.patient_id, display="Hypertension", code="38341003"))  # record search hits carry names
        db.commit()
        yield {"pid": p.patient_id, "doc": d.document_id}
    finally:
        db.close()


def _gets(n):
    pid, doc = n["pid"], n["doc"]
    return [("GET", "/api/v1/patients", None), ("GET", f"/api/v1/patients/{pid}", None),
            ("GET", f"/api/v1/patients/{pid}/record", None), ("GET", f"/api/v1/patients/{pid}/graph", None),
            ("GET", f"/api/v1/patients/{pid}/risk", None), ("GET", f"/api/v1/documents/patient/{pid}", None),
            ("GET", f"/api/v1/documents/{doc}/insights", None), ("GET", f"/api/v1/documents/{doc}/redacted", None),
            ("GET", f"/api/v1/documents/compare/{pid}", None), ("GET", f"/api/v1/documents/{doc}/record-links", None),
            ("POST", "/api/v1/search/records", {"query": "hypertension", "expand": False}),
            ("POST", "/api/v1/search/query", {"query": "chest pain hypertension"}),
            ("POST", "/api/v1/search/query", {"query": "chest pain", "patient_id": pid}),
            ("POST", "/api/v1/search/qa", {"document_id": doc, "question": "does the patient have chest pain?"}),
            ("POST", f"/api/v1/copilot/conversations/{pid}", {"title": "t"}),
            ("GET", f"/api/v1/copilot/conversations/{pid}", None)]


def _leaks(body: str):
    return [s for s in (FIRST, LAST, DOB.isoformat()) if s.lower() in body.lower()]


def test_researcher_sees_no_direct_identifiers(client, world, named):
    h = {"Authorization": f"Bearer {token_for(world['users']['researcher'])}"}
    for method, url, body in _gets(named):
        r = client.request(method, url, headers=h, json=body)
        assert r.status_code < 400, (url, r.status_code, r.text[:200])
        assert not _leaks(r.text), (url, _leaks(r.text))


def test_other_roles_still_see_the_name(client, world, named):
    h = {"Authorization": f"Bearer {token_for(world['users']['consultant'])}"}
    r = client.get(f"/api/v1/patients/{named['pid']}", headers=h)
    assert r.json()["first_name"] == FIRST and r.json()["date_of_birth"] == DOB.isoformat()


def test_researcher_copilot_answer_has_no_name(client, world, named):
    h = {"Authorization": f"Bearer {token_for(world['users']['researcher'])}"}
    cid = client.post(f"/api/v1/copilot/conversations/{named['pid']}", headers=h, json={"title": "t"}).json()["conversation_id"]
    q = {"content": f"does {FIRST} have hypertension or chest pain?"}
    r = client.post(f"/api/v1/copilot/chat/{cid}", headers=h, json=q)
    assert r.status_code == 200 and not _leaks(r.text), _leaks(r.text)
    streamed = client.post(f"/api/v1/copilot/chat/{cid}/stream", headers=h, json={"content": "does the patient have chest pain?"})
    assert streamed.status_code == 200 and not _leaks(streamed.text), _leaks(streamed.text)
    stored = client.get(f"/api/v1/copilot/conversations/{named['pid']}", headers=h).json()
    answers = [m for m in stored[0]["messages"] if m["sender"] == "assistant"]
    assert len(answers) == 3 and not _leaks(str(answers)), _leaks(str(answers))
