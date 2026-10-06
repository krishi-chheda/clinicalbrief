"""Phase 9: operational health and request metrics, for admins and auditors only.

/ops/health runs live checks (database round trip, local LLM, in-memory search index); /ops/metrics returns the
request telemetry (route templates, status classes, latency percentiles). Neither returns clinical data.
"""
import logging
import time

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.v1.deps import GOVERNANCE_ROLES, require_roles
from app.core.config import settings
from app.core.database import get_db, is_sqlite
from app.models.models import User
from app.services.llm import LLMUnavailable, local_llm
from app.services.telemetry import telemetry

router = APIRouter(prefix="/ops", tags=["Operations"])
logger = logging.getLogger("clinicalbrief.ops")


def _timed(name, check):
    """Runs a check; returns (ok, latency ms, detail). A failure is reported, never raised. Its full text is only
    logged: database errors include host and user names (N-33). LLMUnavailable messages are our own wording."""
    t0 = time.perf_counter()
    try:
        detail = check()
        return True, round((time.perf_counter() - t0) * 1000, 1), detail
    except Exception as e:
        ms = round((time.perf_counter() - t0) * 1000, 1)
        logger.warning("ops health check %s failed: %s: %s", name, type(e).__name__, e)
        if isinstance(e, LLMUnavailable):
            return False, ms, str(e)[:300]
        return False, ms, f"{type(e).__name__}: check failed (details in the backend log)"


@router.get("/health")
def health(db: Session = Depends(get_db), _: User = Depends(require_roles(*GOVERNANCE_ROLES))):
    from app.services.faiss_manager import vector_search_manager

    db_ok, db_ms, db_detail = _timed("database", lambda: (db.execute(text("SELECT 1")).scalar(), "sqlite" if is_sqlite else "postgresql")[1])

    def llm_check():
        thinking = local_llm.check()
        return f"{local_llm.model} (local{', reasoning disabled per call' if thinking else ''})"
    llm_ok, llm_ms, llm_detail = _timed("local_llm", llm_check)

    chunks = vector_search_manager.fallback_index.chunks
    index_docs = len({c["doc_id"] for c in chunks})
    checks = [
        {"name": "database", "ok": db_ok, "latency_ms": db_ms, "detail": db_detail},
        {"name": "local_llm", "ok": llm_ok, "latency_ms": llm_ms, "detail": llm_detail,
         "note": "Copilot falls back to labelled rule-based answers while this is down."},
        {"name": "search_index", "ok": True, "latency_ms": None,
         "detail": f"{index_docs} processed notes in the in-memory index ({len(chunks)} chunks)"},
    ]
    status = "down" if not db_ok else "degraded" if not llm_ok else "ok"
    return {"status": status, "version": settings.VERSION, "uptime_s": int(time.time() - telemetry.started), "checks": checks}


@router.get("/metrics")
def metrics(window: int = Query(900, ge=0, le=86_400, description="Seconds to aggregate; 0 = everything in memory"),
            _: User = Depends(require_roles(*GOVERNANCE_ROLES))):
    return telemetry.snapshot(window or None)
