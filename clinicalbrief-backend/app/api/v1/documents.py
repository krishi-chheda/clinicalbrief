from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Optional
import logging
import uuid
import datetime
import time
import os

from app.core.database import get_db
from app.api.v1.deps import (
    get_current_user, get_current_admin, require_roles, get_accessible_patient, can_access_patient,
    CLINICAL_WRITE_ROLES, REVIEW_ROLES, audit_read,
)
from app.models.models import (
    User, Patient, Document, Summary, Entity, ICD10Mapping,
    AuditLog, ClinicalNote, ProcessingJob
)
from app.schemas.schemas import DocumentResponse, DocumentInsightsResponse, EntityResponse, EntityReviewRequest
from app.services.ai_pipeline import ai_orchestrator
from app.services.entities import REVIEWED_STATUSES, apply_review
from app.services.faiss_manager import vector_search_manager
from app.core.config import settings

logger = logging.getLogger("clinicalbrief.api.documents")
router = APIRouter(prefix="/documents", tags=["Clinical Documents"])

# A run that has not reported progress for this long is treated as crashed and may be retried.
STALE_PROCESSING = datetime.timedelta(minutes=10)

# Only plain text is actually parsed today; PDF/OCR is a later pipeline stage.
ALLOWED_UPLOAD_EXTENSIONS = {".txt"}


def get_accessible_document(document_id: str, db: Session, user: User) -> Document:
    doc = db.query(Document).filter(Document.document_id == document_id).first()
    if not doc or not can_access_patient(user, doc.patient):
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def run_ingestion_pipeline(document_id: str, db_session_factory, report_progress: bool = True):
    """Classifies, extracts entities, suggests ICD-10 codes, summarises, redacts and indexes one note.

    Idempotent: AI output is computed in memory and written in ONE transaction that first removes any
    previous output for the document, so re-running (e.g. after a failure) never duplicates entities
    or summaries, and a crash leaves either the old state or the new one. Progress commits only touch
    the processing job row, so the UI can poll real stages. Bulk runs (CLI) pass report_progress=False:
    nobody is polling, and each commit is a database round trip plus a disk flush.
    """
    db = db_session_factory()
    start_time = time.time()
    doc = job = None

    def progress(step: int):
        job.step = step
        if report_progress or step == 1:  # step 1 marks the note "processing" so a crash is visible as stale
            db.commit()

    try:
        doc = db.query(Document).filter(Document.document_id == document_id).first()
        if not doc:
            logger.error(f"Ingestion failed: Document {document_id} not found in DB.")
            return
        job = db.query(ProcessingJob).filter(ProcessingJob.document_id == document_id).first()
        if not job:
            job = ProcessingJob(document_id=document_id)
            db.add(job)
        doc.status = job.status = "processing"
        job.error_message = None
        progress(1)

        note_entry = db.query(ClinicalNote).filter(ClinicalNote.document_id == document_id).first()
        if note_entry:
            raw_text = note_entry.original_text
        else:
            # Fall back to the stored file. If that fails the pipeline fails - never substitute text.
            with open(doc.file_url, "r", encoding="utf-8") as f:
                raw_text = f.read()
            note_entry = ClinicalNote(document_id=document_id, patient_id=doc.patient_id, original_text=raw_text)
            db.add(note_entry)
        progress(2)

        # --- compute everything first; nothing AI-generated is persisted until all steps succeed ---
        # A source-provided document type (e.g. from FHIR) is authoritative; only classify when missing.
        classification = doc.classification or ai_orchestrator.classify_document(raw_text)
        progress(3)
        entities_data = ai_orchestrator.extract_entities(raw_text)
        progress(4)
        mappings = {i: ai_orchestrator.resolve_icd10(e["entity_text"], e["entity_type"])
                    for i, e in enumerate(entities_data)}
        progress(5)
        summary_text = ai_orchestrator.generate_summary(raw_text)
        progress(6)
        from app.services.clinical_privacy import privacy_engine
        redacted_text, _ = privacy_engine.redact_text(raw_text)

        # --- one transaction: replace previous AI output with this run's output ---
        for old in db.query(Entity).filter(Entity.document_id == document_id).all():
            db.delete(old)  # cascades to its ICD-10 mapping
        db.query(Summary).filter(Summary.document_id == document_id).delete()
        db.flush()
        for i, ent in enumerate(entities_data):
            db_ent = Entity(
                document_id=document_id, entity_text=ent["entity_text"], entity_type=ent["entity_type"],
                confidence=ent["confidence"], review_status="pending",
                original_value=ent["entity_text"], edited_value=ent["entity_text"],
                evidence=ent["evidence"], reasoning=ent["reasoning"],
            )
            if mappings[i]:
                db_ent.icd10_mapping = ICD10Mapping(
                    icd10_code=mappings[i]["icd10_code"], code_description=mappings[i]["code_description"],
                    confidence=mappings[i]["confidence"])
            db.add(db_ent)
        db.add(Summary(document_id=document_id, summary_text=summary_text))
        doc.classification = classification
        note_entry.redacted_text = redacted_text
        doc.status = job.status = "completed"
        job.step = 9
        job.elapsed_time = time.time() - start_time
        # Record what actually ran: the rule-based fallback is not the transformer models.
        model_used = ("Rule-based prototype (dictionary NER + negation, extractive summary)" if ai_orchestrator.use_mock
                      else f"NER: {settings.NER_MODEL}, Summarization: {settings.SUMMARIZATION_MODEL}")
        db.add(AuditLog(user_id=doc.uploaded_by, action_type="ingest_document", model_used=model_used[:100],
                        confidence_score=None, extraction_source=f"Document: {document_id}"))
        db.commit()

        # ponytail: in-memory index; a re-processed note may be indexed twice until the pgvector move.
        vector_search_manager.add_document(document_id, doc.patient_id, raw_text)
        logger.info(f"Ingestion pipeline completed for document {document_id}")

    except Exception as e:
        logger.exception(f"Ingestion pipeline failed for document {document_id}")
        db.rollback()
        if doc is not None:
            doc.status = "failed"
        if job is not None:
            job.status = "failed"
            job.error_message = f"{type(e).__name__}: {e}"[:1000]
            job.elapsed_time = time.time() - start_time
        db.commit()
    finally:
        db.close()


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    patient_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*CLINICAL_WRITE_ROLES))
):
    get_accessible_patient(patient_id, db, current_user)

    # The client filename is display-only; it never touches the filesystem path.
    display_name = os.path.basename((file.filename or "upload.txt").replace("\\", "/"))[:255] or "upload.txt"
    extension = os.path.splitext(display_name)[1].lower()
    if extension not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_UPLOAD_EXTENSIONS))}")

    contents = await file.read(settings.MAX_UPLOAD_BYTES + 1)
    if len(contents) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large")
    try:
        raw_text = contents.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="File is not valid UTF-8 text")
    if not raw_text.strip():
        raise HTTPException(status_code=422, detail="File is empty")

    doc_id = str(uuid.uuid4())
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    file_path = settings.UPLOAD_DIR / f"{doc_id}{extension}"
    file_path.write_bytes(contents)

    # Write document entry to DB
    new_doc = Document(
        document_id=doc_id,
        patient_id=patient_id,
        file_name=display_name,
        file_type=extension.lstrip("."),
        file_url=str(file_path),
        source_system="upload", provenance="manual",
        status="pending",
        uploaded_by=current_user.id
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)

    # Write note original text entry to DB
    new_note = ClinicalNote(
        document_id=doc_id,
        patient_id=patient_id,
        original_text=raw_text
    )
    db.add(new_note)
    db.commit()

    # Trigger background pipeline runner
    from app.core.database import SessionLocal
    background_tasks.add_task(run_ingestion_pipeline, new_doc.document_id, SessionLocal)

    return new_doc


@router.get("/patient/{patient_id}", response_model=List[DocumentResponse])
def get_patient_documents(
    patient_id: str,
    response: Response,
    limit: int = 100,
    include: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """A patient's notes, newest clinical date first. At most `limit` (busy patients have
    1,000+); X-Total-Count gives the full number. `include` adds one specific note (e.g. from a link)."""
    get_accessible_patient(patient_id, db, current_user)
    limit = max(1, min(limit, 500))
    base = db.query(Document).filter(Document.patient_id == patient_id)
    docs = (base.order_by(func.coalesce(Document.document_date, Document.upload_date).desc(), Document.document_id)
            .limit(limit).all())
    if include and all(d.document_id != include for d in docs):
        extra = base.filter(Document.document_id == include).first()
        if extra:
            docs.append(extra)
    response.headers["X-Total-Count"] = str(base.count())
    return docs


@router.get("/{document_id}/insights", response_model=DocumentInsightsResponse)
def get_document_insights(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    doc = get_accessible_document(document_id, db, current_user)
    audit_read(db, current_user, "view_note_insights", f"Document ID: {document_id}")  # N-14: evidence = note text
    return doc


@router.post("/entities/{entity_id}/review", response_model=EntityResponse)
def review_entity(
    entity_id: str,
    review: EntityReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*REVIEW_ROLES))
):
    entity = db.query(Entity).filter(Entity.entity_id == entity_id).first()
    if not entity or not can_access_patient(current_user, entity.document.patient):
        raise HTTPException(status_code=404, detail="Clinical Entity not found")
    if review.from_status and entity.review_status != review.from_status:
        raise HTTPException(status_code=409, detail={
            "message": "This finding was changed by someone else since you loaded it; nothing was saved.",
            "entity_ids": [entity_id]})

    apply_review(db, entity, review.status, current_user, review.edited_text)
    db.commit()
    db.refresh(entity)
    return entity


@router.get("/{document_id}/redacted")
def get_redacted_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Note text. Redaction is a pattern-matching PROTOTYPE, not validated de-identification, so this is not a
    de-identified view. Researchers still get the redacted text only (original_text is null) (R-08)."""
    doc = get_accessible_document(document_id, db, current_user)
    audit_read(db, current_user, "view_note_text", f"Document ID: {document_id}")
    show_original = current_user.role != "researcher"

    note_entry = db.query(ClinicalNote).filter(ClinicalNote.document_id == document_id).first()
    if note_entry and note_entry.redacted_text:
        return {
            "document_id": document_id,
            "original_text": note_entry.original_text if show_original else None,
            "redacted_text": note_entry.redacted_text,
            "redactions": []
        }

    if note_entry:
        raw_text = note_entry.original_text
    else:
        try:
            with open(doc.file_url, "r", encoding="utf-8") as f:
                raw_text = f.read()
        except (OSError, TypeError):
            logger.error(f"Source text unavailable for document {document_id}")
            raise HTTPException(status_code=404, detail="Document text is not available")

    from app.services.clinical_privacy import privacy_engine
    redacted_text, redacted_entities = privacy_engine.redact_text(raw_text)

    if not show_original:  # N-13: each redaction carries the matched text; researchers get type + placeholder only
        redacted_entities = [{k: r[k] for k in ("entity_type", "redacted_text")} for r in redacted_entities]
    return {
        "document_id": document_id,
        "original_text": raw_text if show_original else None,
        "redacted_text": redacted_text,
        "redactions": redacted_entities
    }


@router.get("/compare/{patient_id}")
def compare_patient_documents(
    patient_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Earliest vs latest processed note, from reviewed entities only. Read-only (N-03)."""
    get_accessible_patient(patient_id, db, current_user)
    docs = db.query(Document).filter(
        Document.patient_id == patient_id,
        Document.status == "completed"
    ).all()
    # Clinical date first: imported notes all share one upload (ingestion) time.
    docs.sort(key=lambda d: d.document_date or d.upload_date)

    if len(docs) < 2:
        return {
            "patient_id": patient_id,
            "can_compare": False,
            "message": "Need at least two completed documents to run side-by-side timeline analysis.",
            "comparison": None
        }

    doc1 = docs[0]
    doc2 = docs[-1]

    sum1 = doc1.summary.summary_text if doc1.summary else "No summary available."
    sum2 = doc2.summary.summary_text if doc2.summary else "No summary available."

    # Only reviewed (approved / edited) entities count as findings; unreviewed AI output is reported as a count.
    def reviewed(doc):
        rows = db.query(Entity).filter(Entity.document_id == doc.document_id).all()
        return [e for e in rows if e.review_status in REVIEWED_STATUSES], sum(e.review_status == "pending" for e in rows)
    (ents1, pending1), (ents2, pending2) = reviewed(doc1), reviewed(doc2)

    diseases1 = {e.entity_text.lower(): e for e in ents1 if e.entity_type == "Disease"}
    diseases2 = {e.entity_text.lower(): e for e in ents2 if e.entity_type == "Disease"}

    meds1 = {e.entity_text.lower(): e for e in ents1 if e.entity_type == "Medication"}
    meds2 = {e.entity_text.lower(): e for e in ents2 if e.entity_type == "Medication"}

    allergies1 = {e.entity_text.lower(): e for e in ents1 if e.entity_type == "Allergy"}
    allergies2 = {e.entity_text.lower(): e for e in ents2 if e.entity_type == "Allergy"}

    added_diseases = [e.entity_text for k, e in diseases2.items() if k not in diseases1]
    resolved_diseases = [e.entity_text for k, e in diseases1.items() if k not in diseases2]
    maintained_diseases = [e.entity_text for k, e in diseases2.items() if k in diseases1]

    added_meds = [e.entity_text for k, e in meds2.items() if k not in meds1]
    discontinued_meds = [e.entity_text for k, e in meds1.items() if k not in meds2]
    maintained_meds = [e.entity_text for k, e in meds2.items() if k in meds1]

    added_allergies = [e.entity_text for k, e in allergies2.items() if k not in allergies1]
    discontinued_allergies = [e.entity_text for k, e in allergies1.items() if k not in allergies2]
    maintained_allergies = [e.entity_text for k, e in allergies2.items() if k in allergies1]

    icd1 = {e.icd10_mapping.icd10_code: e.icd10_mapping for e in ents1 if e.entity_type == "Disease" and e.icd10_mapping}
    icd2 = {e.icd10_mapping.icd10_code: e.icd10_mapping for e in ents2 if e.entity_type == "Disease" and e.icd10_mapping}

    added_icd = [{"code": code, "description": mapping.code_description} for code, mapping in icd2.items() if code not in icd1]
    removed_icd = [{"code": code, "description": mapping.code_description} for code, mapping in icd1.items() if code not in icd2]
    maintained_icd = [{"code": code, "description": mapping.code_description} for code, mapping in icd2.items() if code in icd1]

    timeline_diffs = []
    note_date = lambda d: (d.document_date or d.upload_date).strftime('%Y-%m-%d') if (d.document_date or d.upload_date) else "unknown date"
    timeline_diffs.append(f"Earlier note: {note_date(doc1)} ({doc1.classification or 'unclassified'}).")
    timeline_diffs.append(f"Later note: {note_date(doc2)} ({doc2.classification or 'unclassified'}).")

    procedures1 = [e.entity_text for e in ents1 if e.entity_type == "Procedure"]
    procedures2 = [e.entity_text for e in ents2 if e.entity_type == "Procedure"]
    if procedures1 or procedures2:
        timeline_diffs.append(f"Procedures mentioned: [{', '.join(procedures1) or 'None'}] to [{', '.join(procedures2) or 'None'}].")

    comparison_payload = {
        "can_compare": True,
        "doc1": {
            "document_id": doc1.document_id,
            "file_name": doc1.file_name,
            "classification": doc1.classification or "Unclassified",
            "upload_date": (doc1.document_date or doc1.upload_date).isoformat() if (doc1.document_date or doc1.upload_date) else None,
            "summary": sum1
        },
        "doc2": {
            "document_id": doc2.document_id,
            "file_name": doc2.file_name,
            "classification": doc2.classification or "Unclassified",
            "upload_date": (doc2.document_date or doc2.upload_date).isoformat() if (doc2.document_date or doc2.upload_date) else None,
            "summary": sum2
        },
        "analysis": {
            "diseases": {
                "added": added_diseases,
                "resolved": resolved_diseases,
                "maintained": maintained_diseases
            },
            "medications": {
                "added": added_meds,
                "discontinued": discontinued_meds,
                "maintained": maintained_meds
            },
            "allergies": {
                "added": added_allergies,
                "discontinued": discontinued_allergies,
                "maintained": maintained_allergies
            },
            "icd10": {
                "added": added_icd,
                "removed": removed_icd,
                "maintained": maintained_icd
            },
            "timeline_differences": timeline_diffs
        },
        # "added" / "resolved" etc. only mean "mentioned in one note and not the other".
        "pending_review": pending1 + pending2,
    }
    return comparison_payload


@router.post("/{document_id}/process", status_code=status.HTTP_202_ACCEPTED)
def process_document(
    document_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*CLINICAL_WRITE_ROLES))
):
    """Runs the AI pipeline on an existing (e.g. imported) note that has not been processed yet."""
    doc = get_accessible_document(document_id, db, current_user)
    if doc.status == "processing":
        job = db.query(ProcessingJob).filter(ProcessingJob.document_id == document_id).first()
        last_update = job.updated_at if job else None
        if last_update and last_update.tzinfo is None:
            last_update = last_update.replace(tzinfo=datetime.timezone.utc)
        stale = last_update is None or datetime.datetime.now(datetime.timezone.utc) - last_update > STALE_PROCESSING
        if not stale:
            raise HTTPException(status_code=409, detail="Document is already being processed")
        logger.warning(f"Retrying document {document_id}: processing state is stale (crashed run)")
    if doc.status == "completed":
        raise HTTPException(status_code=409, detail="Document has already been processed")
    if not doc.clinical_note:
        raise HTTPException(status_code=422, detail="Document has no text to process")
    doc.status = "processing"
    db.commit()
    from app.core.database import SessionLocal
    background_tasks.add_task(run_ingestion_pipeline, document_id, SessionLocal)
    return {"document_id": document_id, "status": "processing"}


@router.get("/{document_id}/status")
def get_document_status(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Real processing state for the upload UI (no simulated progress)."""
    doc = get_accessible_document(document_id, db, current_user)
    job = db.query(ProcessingJob).filter(ProcessingJob.document_id == document_id).first()
    return {
        "document_id": doc.document_id,
        "status": doc.status,
        "step": job.step if job else 0,
        "elapsed_seconds": round(job.elapsed_time, 2) if job else None,
        "error": "Processing failed. See server logs." if doc.status == "failed" else None,
    }
