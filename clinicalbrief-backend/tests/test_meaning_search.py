"""v1.0.1 roadmap 8b: "match meaning" note search (migration 0014). Embeddings are faked: tests never call a model."""
import pytest
from sqlalchemy import text
from conftest import token_for
from test_security import as_user  # noqa: F401 (fixture)
from app.core.database import SessionLocal, is_sqlite
from app.models.models import ClinicalNote, Document, Patient
from app.services import embeddings
from app.services.llm import LLMUnavailable

DIM = 768
EAR, BONE = [1.0] + [0.0] * (DIM - 1), [0.0, 1.0] + [0.0] * (DIM - 2)   # two orthogonal "meanings"


@pytest.fixture
def notes(client, world):
    if is_sqlite:
        pytest.skip("note embeddings live in Postgres (migration 0014)")
    db = SessionLocal()
    made = {}
    try:
        for key, pid, body, vec in [("ear", world["mine"], "History of otitis media (disorder).", EAR),
                                    ("bone", world["mine"], "History of fracture of clavicle (disorder).", BONE),
                                    ("other", world["other"], "Otitis media again (disorder).", EAR)]:
            d = Document(patient_id=pid, file_name=key, file_type="txt", status="completed")
            db.add(d); db.flush()
            db.add(ClinicalNote(document_id=d.document_id, patient_id=pid, original_text=body))
            db.flush()
            db.execute(text("INSERT INTO note_embeddings (document_id, model, embedding) VALUES (:d, 'test', CAST(:v AS extensions.vector))"),
                       {"d": d.document_id, "v": embeddings.to_pg(embeddings.shorten([vec])[0])})
            made[key] = d.document_id
        db.commit()
        yield made
    finally:
        db.execute(text("DELETE FROM note_embeddings")); db.commit(); db.close()


def _search(client, role, world, **body):
    r = client.post("/api/v1/search/records", headers={"Authorization": f"Bearer {token_for(world['users'][role])}"},
                    json={"query": "ear infection", "expand": False, "kinds": ["note"], **body})
    assert r.status_code == 200, r.text
    return r.json()


def test_meaning_finds_what_keywords_miss(client, world, notes, monkeypatch):
    monkeypatch.setattr(embeddings, "embed", lambda texts, task: [EAR])
    assert _search(client, "consultant", world)["hits"] == []            # no note says "ear infection"
    r = _search(client, "consultant", world, meaning=True)
    assert r["meaning"] is True and r["meaning_note"] is None
    ids = [h["document_id"] for h in r["hits"]]
    assert set(ids[:2]) == {notes["ear"], notes["other"]} and ids[2] == notes["bone"]   # nearest first
    assert all(h["by_meaning"] for h in r["hits"])                       # none shares a word with the query


def test_meaning_keeps_patient_scope(client, world, notes, monkeypatch):
    monkeypatch.setattr(embeddings, "embed", lambda texts, task: [EAR])
    ids = {h["document_id"] for h in _search(client, "clinician", world, meaning=True)["hits"]}
    assert notes["other"] not in ids and notes["ear"] in ids            # clinician: assigned patient only


def test_meaning_falls_back_to_keywords_without_the_model(client, world, notes, monkeypatch):
    def down(texts, task):
        raise LLMUnavailable("not running")
    monkeypatch.setattr(embeddings, "embed", down)
    r = _search(client, "consultant", world, meaning=True, query="otitis")
    assert r["meaning"] is False and "Local model unavailable" in r["meaning_note"]
    assert {notes["ear"], notes["other"]} <= {h["document_id"] for h in r["hits"]}   # the keyword hits


def test_meaning_explains_why_it_was_not_used(client, world, monkeypatch):
    """No fixture embeddings: Postgres says to run embed-notes, SQLite says it needs Postgres. Keyword results either way."""
    monkeypatch.setattr(embeddings, "embed", lambda texts, task: [EAR])
    r = _search(client, "consultant", world, meaning=True)
    assert r["meaning"] is False
    assert ("Postgres" if is_sqlite else "embed-notes") in r["meaning_note"]


def test_embedding_table_is_not_readable_through_the_api_roles(as_user, world, notes):
    assert as_user(world["users"]["admin"], "select * from note_embeddings") == []

