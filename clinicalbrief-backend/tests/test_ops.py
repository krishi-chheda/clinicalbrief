"""Phase 9: request telemetry and the ops endpoints (admin / auditor only, no clinical data)."""
from app.services.telemetry import Telemetry, percentile, telemetry


def test_percentile_nearest_rank():
    assert percentile([], 95) is None
    assert percentile([5.0], 50) == 5.0
    values = list(map(float, range(1, 101)))  # 1..100
    assert (percentile(values, 50), percentile(values, 95), percentile(values, 100)) == (50.0, 95.0, 100.0)


def test_snapshot_aggregates_by_route_and_window():
    t = Telemetry()
    for i, (status, ms) in enumerate([(200, 10), (200, 30), (404, 5), (500, 80)]):
        t.record("GET", "/api/v1/patients/{patient_id}", status, ms, f"r{i}")
    t._events.append(t._events[0].__class__(t.started - 7200, "GET", "/old", 200, 1.0, "old"))  # outside a 15-min window
    snap = t.snapshot(None)
    route = next(r for r in snap["routes"] if r["route"] == "/api/v1/patients/{patient_id}")
    assert (route["count"], route["client_errors"], route["server_errors"], route["max_ms"]) == (4, 1, 1, 80)
    assert [e["request_id"] for e in snap["recent_server_errors"]] == ["r3"]
    assert t.snapshot(900)["overall"]["count"] == 4  # the 2-hour-old event is outside the window


def test_requests_record_route_templates_never_real_paths(client, auth, world):
    r = client.get(f"/api/v1/patients/{world['mine']}?q=secret-query", headers=auth("clinician"))
    assert r.status_code == 200 and len(r.headers["X-Request-ID"]) == 12
    stored = {e.route for e in telemetry._events}
    assert "/api/v1/patients/{patient_id}" in stored
    assert not any(world["mine"] in route or "secret" in route for route in stored)
    match = [e for e in telemetry._events if e.request_id == r.headers["X-Request-ID"]]
    assert match and match[0].status == 200 and match[0].method == "GET"


def test_unmatched_paths_are_grouped(client):
    client.get("/api/v1/no-such-endpoint/12345")
    assert "unmatched" in {e.route for e in telemetry._events}
    assert not any("12345" in e.route for e in telemetry._events)


def test_ops_endpoints_are_governance_only(client, auth):
    for path in ("/api/v1/ops/health", "/api/v1/ops/metrics"):
        assert client.get(path).status_code == 401
        for role in ("clinician", "consultant", "coder", "researcher"):
            assert client.get(path, headers=auth(role)).status_code == 403, (path, role)
        for role in ("admin", "auditor"):
            assert client.get(path, headers=auth(role)).status_code == 200, (path, role)


def test_health_reports_a_down_llm_without_failing(client, auth):
    body = client.get("/api/v1/ops/health", headers=auth("admin")).json()  # tests run without Ollama
    checks = {c["name"]: c for c in body["checks"]}
    assert checks["database"]["ok"] is True and checks["database"]["latency_ms"] >= 0
    assert checks["local_llm"]["ok"] is False and body["status"] == "degraded"
    assert "search_index" in checks


def test_metrics_window_and_shape(client, auth):
    client.get("/api/v1/auth/me", headers=auth("admin"))
    body = client.get("/api/v1/ops/metrics?window=900", headers=auth("admin")).json()
    assert body["overall"]["count"] >= 1 and len(body["per_minute"]) == 15
    assert {"method", "route", "count", "p50_ms", "p95_ms", "max_ms", "client_errors", "server_errors"} <= set(body["routes"][0])
    assert client.get("/api/v1/ops/metrics?window=-1", headers=auth("admin")).status_code == 422


# N-33: a failing check must not echo the raw error, which for Postgres includes host and user names.
def test_failed_database_check_hides_connection_details(client, auth, monkeypatch):
    from sqlalchemy.exc import OperationalError
    from sqlalchemy.orm import Session
    real = Session.execute

    def failing(self, statement, *args, **kwargs):
        if "SELECT 1" in str(statement):
            raise OperationalError("SELECT 1", {}, Exception('connection to server at "db.example.invalid" failed: '
                                                              'password authentication failed for user "postgres.abc"'))
        return real(self, statement, *args, **kwargs)
    monkeypatch.setattr(Session, "execute", failing)
    body = client.get("/api/v1/ops/health", headers=auth("admin")).json()
    db = next(c for c in body["checks"] if c["name"] == "database")
    assert body["status"] == "down" and db["ok"] is False
    assert "example.invalid" not in str(body) and "postgres.abc" not in str(body)
    assert db["detail"] == "OperationalError: check failed (details in the backend log)"


def test_root_reports_the_deployed_commit(client, monkeypatch):
    assert client.get("/").json()["commit"] == "local"
    monkeypatch.setenv("RENDER_GIT_COMMIT", "1a88d5b0123456789abcdef")
    assert client.get("/").json()["commit"] == "1a88d5b"
