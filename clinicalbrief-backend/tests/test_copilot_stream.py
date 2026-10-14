"""F-01: /copilot/chat/{id}/stream reports the real pipeline stages, in order, with real counts, and stores them."""
import json

import pytest

from app.core.database import SessionLocal
from app.models.models import AuditLog
from app.services import grounded_copilot as gc
from app.services.llm import LLMUnavailable
from test_grounded_copilot import FakeLLM, two_patients, db  # noqa: F401 (fixtures)

QUESTION = "What conditions does the patient have?"
TERMS = ["pharyngitis", "sore throat"]


def stream(client, headers, cid, question=QUESTION):
    r = client.post(f"/api/v1/copilot/chat/{cid}/stream", headers=headers, json={"content": question})
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/x-ndjson")
    return [json.loads(line) for line in r.text.splitlines() if line.strip()]


def finished(events):
    """The streamed steps as they are stored: finished ones only, without the envelope."""
    return [{k: v for k, v in e.items() if k != "type"} for e in events if e["type"] == "step" and e["status"] != "active"]


@pytest.fixture
def setup(client, auth, db, two_patients, monkeypatch):  # noqa: F811
    """A conversation (admin) on patient A, and a fake model whose answer each test sets."""
    pid = two_patients[0]
    cid = client.post(f"/api/v1/copilot/conversations/{pid}", headers=auth("admin"), json={"title": "t"}).json()["conversation_id"]
    evidence = gc.build_evidence(db, pid, QUESTION, tuple(TERMS))
    dx = next(e.id for e in evidence if e.kind == "diagnosis")
    state = {"answer": ""}
    fake = FakeLLM(lambda m: ", ".join(TERMS) if m[0]["content"] == gc.EXPANSION_PROMPT else state["answer"].format(dx=dx))
    monkeypatch.setattr(gc, "local_llm", fake)
    return {"pid": pid, "cid": cid, "evidence": evidence, "state": state, "h": auth("admin")}


def test_stages_stream_in_order_with_real_counts(client, setup):
    setup["state"]["answer"] = "Acute viral pharyngitis is recorded [{dx}]."
    events = stream(client, setup["h"], setup["cid"])
    order = [(e["id"], e["status"]) for e in events if e["type"] == "step"]
    assert order == [("expand", "active"), ("expand", "done"), ("retrieve", "active"), ("retrieve", "done"),
                     ("generate", "active"), ("generate", "done"), ("verify", "active"), ("verify", "done")]
    assert events[-1]["type"] == "final"
    by_id = {e["id"]: e for e in finished(events)}
    assert by_id["expand"]["label"] == f"Expanded into {len(TERMS)} search terms" and by_id["expand"]["chips"] == TERMS
    assert by_id["retrieve"]["label"].startswith(f"Found {len(setup['evidence'])} records")
    assert len(by_id["retrieve"]["chips"]) == min(4, len(setup["evidence"]))
    assert by_id["retrieve"]["more"] == max(0, len(setup["evidence"]) - 4)
    assert by_id["generate"]["label"] == "Drafted an answer"
    assert next(e for e in events if e["id"] == "generate")["label"] == "Writing an answer with fake-model (local)"
    assert by_id["verify"]["label"] == "Checked 1 statement: 1 cited"
    assert all(isinstance(e["ms"], int) and e["ms"] >= 0 for e in finished(events))
    final = events[-1]["message"]
    assert final["grounding"] == "grounded" and final["steps"] == finished(events) and final["total_ms"] >= 0


def test_dead_ends_appear_only_when_they_happened(client, setup):
    # A statement with no source, and a citation to an id that was never provided.
    setup["state"]["answer"] = "Acute viral pharyngitis is recorded [{dx}, E99]. The patient also has gout."
    labels = [(e["id"], e["label"]) for e in finished(stream(client, setup["h"], setup["cid"])) if e["status"] == "dead"]
    assert labels == [("verify.uncited", "Removed 1 statement with no source"),
                      ("verify.invalid.E99", "Removed a citation to E99 (not provided)")]


def test_treatment_advice_is_withheld_and_records_shown(client, setup):
    setup["state"]["answer"] = "Acute viral pharyngitis is recorded [{dx}]. Start insulin 10 units at night."
    events = stream(client, setup["h"], setup["cid"])
    steps = {e["id"]: e for e in finished(events)}
    assert steps["verify.advice"]["status"] == "dead" and steps["verify.advice"]["label"] == "Draft withheld: treatment advice"
    assert steps["records"]["status"] == "done" and steps["records"]["label"].startswith("Showing ")
    assert events[-1]["message"]["grounding"] == "records-only"


def test_model_down_shows_the_honest_fallback(client, setup, monkeypatch):
    def down(*a, **k):
        raise LLMUnavailable("connection refused")
    monkeypatch.setattr(gc.local_llm, "chat", down)
    events = stream(client, setup["h"], setup["cid"], "What medications is the patient on?")
    steps = finished(events)
    assert [(s["id"], s["status"]) for s in steps] == [("expand", "dead"), ("fallback", "done")]
    assert steps[0]["label"] == "Local model unavailable: using the rule-based answers"
    assert steps[1]["label"].startswith(("Listed ", "Looked for reviewed medications"))
    assert events[-1]["message"]["mode"] == "rule-based" and events[-1]["message"]["steps"] == steps


def test_stored_steps_match_the_stream_and_one_audit_row(client, setup):
    setup["state"]["answer"] = "Acute viral pharyngitis is recorded [{dx}]."
    s = SessionLocal()
    before = s.query(AuditLog).filter(AuditLog.action_type == "copilot_query").count()
    events = stream(client, setup["h"], setup["cid"])
    assert s.query(AuditLog).filter(AuditLog.action_type == "copilot_query").count() == before + 1
    s.close()
    convs = client.get(f"/api/v1/copilot/conversations/{setup['pid']}", headers=setup["h"]).json()
    stored = next(m for c in convs if c["conversation_id"] == setup["cid"] for m in c["messages"]
                  if m["message_id"] == events[-1]["message"]["message_id"])
    assert stored["steps"] == finished(events) and stored["total_ms"] == events[-1]["message"]["total_ms"]


def test_plain_chat_stores_the_same_kind_of_trace(client, setup):
    setup["state"]["answer"] = "Acute viral pharyngitis is recorded [{dx}]."
    r = client.post(f"/api/v1/copilot/chat/{setup['cid']}", headers=setup["h"], json={"content": QUESTION}).json()
    assert [s["id"] for s in r["steps"]] == ["expand", "retrieve", "generate", "verify"] and r["total_ms"] >= 0


def test_stream_access(client, setup, auth):
    url = f"/api/v1/copilot/chat/{setup['cid']}/stream"
    assert client.post(url, headers=auth("consultant"), json={"content": QUESTION}).status_code == 404  # not theirs
    # A malformed id is "not found" everywhere (Postgres used to answer 500: invalid uuid).
    for bad in ("/api/v1/copilot/chat/does-not-exist/stream", "/api/v1/copilot/chat/does-not-exist"):
        assert client.post(bad, headers=setup["h"], json={"content": QUESTION}).status_code == 404, bad
    assert client.delete("/api/v1/copilot/conversations/does-not-exist", headers=setup["h"]).status_code == 404
    assert client.post(url, json={"content": QUESTION}).status_code == 401  # signed out
