"""Phase 9: request telemetry kept in process memory.

Every API request is recorded as (time, method, route template, status, duration, request id). Only the route
*template* is stored (e.g. "/api/v1/patients/{patient_id}"), never the real path, query string, headers or body,
so no patient id, search text or note content ever reaches the metrics.

ponytail: a bounded in-memory ring buffer, reset on restart and per-process (one uvicorn worker today). Move to a
metrics backend (Prometheus / OpenTelemetry) if the app runs multiple workers or needs history across restarts.
"""
import threading
import time
from collections import deque
from dataclasses import dataclass

MAX_EVENTS = 20_000          # ~ a few hours of local use; oldest events drop off first
SLOW_MS = 2_000              # requests slower than this are logged as warnings


@dataclass(frozen=True)
class Event:
    at: float          # unix time the request finished
    method: str
    route: str         # route template, or "unmatched"
    status: int
    ms: float
    request_id: str


def percentile(values: list[float], p: float) -> float | None:
    """Nearest-rank percentile (p in 0..100) of a list; None when empty."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, -(-len(ordered) * p // 100))  # ceil(n * p / 100), at least 1
    return ordered[int(rank) - 1]


class Telemetry:
    def __init__(self, max_events: int = MAX_EVENTS):
        self.started = time.time()
        self._events: deque[Event] = deque(maxlen=max_events)
        self._lock = threading.Lock()

    def record(self, method: str, route: str, status: int, ms: float, request_id: str) -> None:
        with self._lock:
            self._events.append(Event(time.time(), method, route, status, round(ms, 1), request_id))

    def snapshot(self, window_s: int | None = 900, now: float | None = None) -> dict:
        """Aggregates for the last `window_s` seconds (None = everything still in memory)."""
        now = now or time.time()
        with self._lock:
            events = list(self._events)
        if window_s:
            events = [e for e in events if e.at >= now - window_s]

        routes: dict[tuple[str, str], list[Event]] = {}
        for e in events:
            routes.setdefault((e.method, e.route), []).append(e)

        def stats(group: list[Event]) -> dict:
            ms = [e.ms for e in group]
            return {
                "count": len(group),
                "client_errors": sum(400 <= e.status < 500 for e in group),
                "server_errors": sum(e.status >= 500 for e in group),
                "p50_ms": percentile(ms, 50), "p95_ms": percentile(ms, 95), "max_ms": max(ms) if ms else None,
            }

        # Requests per minute for the window (oldest first), for a small throughput chart.
        minutes = max(1, min(60, (window_s or int(now - self.started) or 60) // 60))
        per_minute = [0] * minutes
        for e in events:
            age = int((now - e.at) // 60)
            if age < minutes:
                per_minute[minutes - 1 - age] += 1

        errors = [e for e in events if e.status >= 500][-20:]
        return {
            "window_s": window_s,
            "uptime_s": int(now - self.started),
            "events_in_memory": len(self._events),
            "overall": stats(events),
            "per_minute": per_minute,
            "routes": sorted(({"method": m, "route": r, **stats(g)} for (m, r), g in routes.items()),
                             key=lambda x: x["count"], reverse=True),
            "recent_server_errors": [
                {"at": e.at, "method": e.method, "route": e.route, "status": e.status, "ms": e.ms, "request_id": e.request_id}
                for e in reversed(errors)],
        }


telemetry = Telemetry()
