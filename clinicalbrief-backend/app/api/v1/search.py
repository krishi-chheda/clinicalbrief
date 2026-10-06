from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.v1.deps import get_current_user, get_accessible_patient, accessible_patient_ids, audit_read
from app.models.models import User, Document
from app.schemas.schemas import SearchRequest, SearchResponse, QARequest, QAResponse
from app.services.faiss_manager import vector_search_manager
from app.services.qa_engine import qa_engine
import logging

logger = logging.getLogger("clinicalbrief.api.search")
router = APIRouter(prefix="/search", tags=["Semantic Search & QA"])

@router.post("/query", response_model=SearchResponse)
def semantic_query(
    payload: SearchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Executes a similarity search over clinical narrative vector chunks."""
    # Query text may contain PHI, so it is not logged.
    k = max(1, min(payload.k or 5, 50))
    if payload.patient_id:
        get_accessible_patient(payload.patient_id, db, current_user)
        return {"results": vector_search_manager.similarity_search(query=payload.query, patient_id=payload.patient_id, k=k)}

    allowed = accessible_patient_ids(current_user, db)
    if allowed is None:
        return {"results": vector_search_manager.similarity_search(query=payload.query, k=k)}
    return {"results": vector_search_manager.similarity_search(query=payload.query, patient_ids=allowed, k=k)}

@router.post("/qa", response_model=QAResponse)
def document_qa(
    payload: QARequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Contextual QA that answers queries about a single document."""
    # Validate document exists
    doc = db.query(Document).filter(Document.document_id == payload.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Target document not found")
    get_accessible_patient(doc.patient_id, db, current_user)

    logger.info(f"QA execution on document {payload.document_id}")
    answer_result = qa_engine.answer_question(payload.document_id, payload.question)
    
    return answer_result


class RecordSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    patient_id: Optional[str] = None
    kinds: Optional[List[Literal["note", "condition", "medication", "procedure", "observation", "allergy"]]] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    sort: Literal["relevance", "date"] = "relevance"
    expand: bool = True            # ask the local LLM for related terms (drug names, synonyms)
    per_kind: int = Field(default=25, ge=1, le=50)


@router.post("/records")
def search_patient_records(
    payload: RecordSearchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Phase 8a: search every note and the structured record across the patients you may access.

    Full-text search, persistent in Postgres (migration 0010), with patient / type / date filters. Medication hits
    are "started" / "stopped" events, so a date range shows medication changes. Researchers get no note text.
    The query text is never logged.
    """
    from app.services.grounded_copilot import expand_query
    from app.services.llm import LLMUnavailable, local_llm
    from app.services.record_search import search_records
    if payload.patient_id:
        get_accessible_patient(payload.patient_id, db, current_user)
    extra, expansion_note = [], None
    if payload.expand:
        try:
            local_llm.check()
            extra = expand_query(local_llm, payload.query)
        except LLMUnavailable:
            expansion_note = "Local model unavailable: searched for your words only."
        except Exception:
            logger.exception("Query expansion failed")
            expansion_note = "Query expansion failed: searched for your words only."
    result = search_records(
        db, accessible_patient_ids(current_user, db), payload.query, extra, patient_id=payload.patient_id,
        kinds=set(payload.kinds or []), date_from=payload.date_from, date_to=payload.date_to,
        include_notes=current_user.role != "researcher", per_kind=payload.per_kind, sort=payload.sort)
    audit_read(db, current_user, "search_records",
               f"Scope: {payload.patient_id or 'all accessible patients'}; hits: {sum(result.counts.values())}")
    return {"hits": result.hits, "counts": result.counts, "terms": result.terms, "expanded": result.expanded,
            "note": expansion_note, "notes_included": current_user.role != "researcher"}
