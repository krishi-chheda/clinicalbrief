import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import Base, engine
from app.api.router import api_router
from app.services.ai_pipeline import ai_orchestrator

# Configure Logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("clinicalbrief")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Postgres/Supabase schema is owned by SQL migrations (migrations/). Only the local SQLite
    # dev database is created from the ORM.
    # ponytail: create_all never alters existing tables; after model changes delete clinicalbrief_dev.db and re-import.
    from app.core.database import is_sqlite
    if is_sqlite:
        Base.metadata.create_all(bind=engine)

    logger.info("Initializing DB index on startup...")
    try:
        from app.core.database import SessionLocal
        from app.models.models import Document, ClinicalNote
        from app.services.faiss_manager import vector_search_manager
        db = SessionLocal()
        # ponytail: in-memory index rebuilt from note text on every start; moves to pgvector in the RAG phase.
        completed = (db.query(Document.document_id, Document.patient_id, ClinicalNote.original_text)
                     .join(ClinicalNote, ClinicalNote.document_id == Document.document_id)
                     .filter(Document.status == "completed").all())
        for doc_id, patient_id, text in completed:
            vector_search_manager.add_document(doc_id, patient_id, text)
        logger.info(f"Re-indexed {len(completed)} processed documents into the search index.")
        db.close()
        logger.info("Startup database index re-loaded successfully.")
    except Exception as e:
        logger.error(f"Error during startup indexing: {e}")
    yield

# 2. Initialize FastAPI Application
app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Backend pipeline for AI-powered Clinical Document Intelligence Platform",
    lifespan=lifespan
)

# 3. Configure CORS Middleware for Next.js communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=False,  # auth is a Bearer header, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
    # X-Pending-Entities: FHIR export, AI entities awaiting review. X-Total-Count: full size of a limited list.
    expose_headers=["X-Pending-Entities", "X-Total-Count", "X-FHIR-Validation", "X-Request-ID"],
)


# Phase 9: time every request and tag it with an id. Only the route template is recorded (see services/telemetry.py).
@app.middleware("http")
async def request_telemetry(request: Request, call_next):
    from app.services.telemetry import SLOW_MS, telemetry
    request_id = uuid.uuid4().hex[:12]
    t0 = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["X-Request-ID"] = request_id
        return response
    finally:
        ms = (time.perf_counter() - t0) * 1000
        route = getattr(request.scope.get("route"), "path", None) or "unmatched"
        if request.method != "OPTIONS":  # CORS preflights are not API calls
            telemetry.record(request.method, route, status, ms, request_id)
        if status >= 500 or ms > SLOW_MS:
            logger.warning("request_id=%s %s %s status=%s ms=%.0f", request_id, request.method, route, status, ms)

# 4. Include Unified Router
app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/")
def read_root():
    return {
        "status": "online",
        "project": "ClinicalBrief",
        "version": settings.VERSION,
        # Tells the UI what actually produced AI output, so it never claims transformer models it isn't running.
        "ai_mode": "rule-based-prototype" if ai_orchestrator.use_mock else "transformers",
        "docs_url": "/docs"
    }
