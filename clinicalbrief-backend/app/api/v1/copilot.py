from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
import json
import logging
import uuid
import datetime

from app.core.database import get_db
from app.api.v1.deps import get_current_user, get_accessible_patient
from app.models.models import User, Patient, CopilotConversation, AuditLog
from app.schemas.schemas import CopilotConversationResponse, CopilotMessageResponse, CopilotMessageCreate, CopilotConversationCreate
from app.services.qa_engine import qa_engine
from app.services.faiss_manager import vector_search_manager

logger = logging.getLogger("clinicalbrief.api.copilot")
router = APIRouter(prefix="/copilot", tags=["Clinical AI Copilot"])

@router.get("/conversations/{patient_id}", response_model=List[CopilotConversationResponse])
def get_conversations(
    patient_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieves the caller's own conversations for a patient."""
    get_accessible_patient(patient_id, db, current_user)
    conversations = db.query(CopilotConversation).filter(
        CopilotConversation.patient_id == patient_id,
        CopilotConversation.user_id == current_user.id,
    ).order_by(CopilotConversation.created_at.desc()).all()
    return conversations

@router.post("/conversations/{patient_id}", response_model=CopilotConversationResponse, status_code=status.HTTP_201_CREATED)
def create_conversation(
    patient_id: str,
    payload: CopilotConversationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Creates a new AI Copilot conversation session."""
    patient = get_accessible_patient(patient_id, db, current_user)

    new_conv = CopilotConversation(
        patient_id=patient_id,
        user_id=current_user.id,
        title=payload.title,
        messages=[]
    )
    db.add(new_conv)
    db.commit()
    db.refresh(new_conv)

    welcome_text = f"Welcome to the AI Clinical Copilot for patient {patient.first_name} {patient.last_name}. I answer from this patient's processed notes only, and say so when the records do not contain an answer."
    welcome_msg = {
        "message_id": str(uuid.uuid4()),
        "conversation_id": new_conv.conversation_id,
        "sender": "assistant",
        "content": welcome_text,
        "citations": json.dumps([]),
        "confidence": 1.0,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

    new_conv.messages = [welcome_msg]
    db.commit()
    db.refresh(new_conv)
    return new_conv

@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Deletes one of the caller's own conversations (others' are 404, never revealed)."""
    conversation = db.query(CopilotConversation).filter(
        CopilotConversation.conversation_id == conversation_id,
        CopilotConversation.user_id == current_user.id,
    ).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation session not found")
    db.add(AuditLog(user_id=current_user.id, action_type="copilot_conversation_deleted",
                    extraction_source=f"Patient ID: {conversation.patient_id}"))
    db.delete(conversation)
    db.commit()

@router.post("/chat/{conversation_id}", response_model=CopilotMessageResponse)
def send_copilot_message(
    conversation_id: str,
    payload: CopilotMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Submits a chat message, retrieves semantic context, and formulates response."""
    conversation = db.query(CopilotConversation).filter(
        CopilotConversation.conversation_id == conversation_id,
        CopilotConversation.user_id == current_user.id,
    ).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation session not found")

    # Patient access may have been revoked since the conversation started.
    get_accessible_patient(conversation.patient_id, db, current_user)

    # 1. Store User Message
    user_msg = {
        "message_id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "sender": "user",
        "content": payload.content,
        "citations": json.dumps([]),
        "confidence": 1.0,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

    current_msgs = list(conversation.messages)
    current_msgs.append(user_msg)
    conversation.messages = current_msgs
    db.commit()

    # 2. Grounded answer from the LOCAL model; rule-based fallback only if it is unavailable.
    from app.services.grounded_copilot import grounded_answer
    from app.services.llm import LLMUnavailable
    try:
        result = grounded_answer(db, conversation.patient_id, payload.content)
        answer, citations_list, confidence = result["answer"], result["citations"], None
        mode, grounding, warnings = result["mode"], result["grounding"], result["warnings"]
        search_terms = result.get("search_terms") or []
        suggested_questions = ["What are the active diagnoses?", "What medications is the patient on?",
                               "What were the most recent lab results?"]
    except LLMUnavailable as e:
        logger.warning(f"Local LLM unavailable, using rule-based fallback: {e}")
        answer, citations_list, confidence, suggested_questions = _rule_based_answer(db, conversation.patient_id, payload.content)
        mode, grounding, warnings = "rule-based", None, [f"Local LLM unavailable ({e}). Answered by the rule-based fallback."]
        search_terms = []

    # Audit the access, never the question or answer text.
    db.add(AuditLog(user_id=current_user.id, action_type="copilot_query", model_used=mode[:100],
                    extraction_source=f"Patient ID: {conversation.patient_id}; grounding: {grounding}"))

    # 3. Store Assistant Message in DB
    assistant_msg = {
        "message_id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "sender": "assistant",
        "content": answer,
        "citations": json.dumps(citations_list),
        "confidence": confidence,
        "mode": mode,
        "grounding": grounding,
        "warnings": warnings,
        "search_terms": search_terms,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }
    current_msgs = list(conversation.messages)
    current_msgs.append(assistant_msg)
    conversation.messages = current_msgs
    db.commit()

    # 4. Map to Pydantic Response Model
    return CopilotMessageResponse(
        message_id=assistant_msg["message_id"],
        conversation_id=assistant_msg["conversation_id"],
        sender=assistant_msg["sender"],
        content=assistant_msg["content"],
        citations=assistant_msg["citations"],
        confidence=assistant_msg["confidence"],
        timestamp=datetime.datetime.fromisoformat(assistant_msg["timestamp"]),
        suggested_questions=suggested_questions,
        mode=mode,
        grounding=grounding,
        warnings=warnings,
        search_terms=search_terms,
    )


def _rule_based_answer(db: Session, patient_id: str, content: str):
    """Fallback when the local LLM is unavailable: keyword intents over reviewed entities + note search."""
    from app.models.models import Document, Entity, ICD10Mapping, Summary
    docs = db.query(Document).filter(Document.patient_id == patient_id).all()
    doc_ids = [d.document_id for d in docs]

    # Only human-reviewed AI entities are presented as fact; pending ones are counted, not shown.
    from app.services.entities import patient_entities
    entities, pending = patient_entities(db, patient_id)

    def nothing_reviewed(entity_type: str, noun: str) -> str:
        n = pending.get(entity_type, 0)
        if n:
            return (f"No reviewed {noun} yet. {n} AI-extracted {noun} {'is' if n == 1 else 'are'} "
                    f"awaiting human review and {'is' if n == 1 else 'are'} not shown as fact.")
        return f"No reviewed {noun} are recorded for this patient."

    q_lower = content.lower().strip()

    answer = ""
    citations_list = []
    confidence = None  # only retrieval-based answers carry a measured score
    suggested_questions = []

    # Intent 1: Medications Query
    if any(word in q_lower for word in ["medication", "meds", "drug", "prescrib", "takes", "taking"]):
        med_entities = [e for e in entities if e.entity_type == "Medication"]
        if med_entities:
            med_list = []
            for m in med_entities:
                med_list.append(f"- {m.entity_text}")
                citations_list.append({
                    "document_id": m.document_id,
                    "text": m.evidence or f"Prescribed {m.entity_text}.",
                    "similarity": None  # structured lookup, not a similarity search
                })
            answer = "Reviewed medications from the processed notes:\n" + "\n".join(med_list)
        else:
            answer = nothing_reviewed("Medication", "medications")
        suggested_questions = [
            "Are there any allergies?",
            "What is the risk assessment score?"
        ]

    # Intent 2: Allergy Queries
    elif any(word in q_lower for word in ["allergy", "allergies", "allergic"]):
        allergy_entities = [e for e in entities if e.entity_type == "Allergy"]
        if allergy_entities:
            all_list = []
            for a in allergy_entities:
                all_list.append(f"- {a.entity_text} (Evidence: {a.evidence or 'None'})")
                citations_list.append({
                    "document_id": a.document_id,
                    "text": a.evidence or f"Allergic to {a.entity_text}.",
                    "similarity": None  # structured lookup, not a similarity search
                })
            answer = "Reviewed allergies from the processed notes:\n" + "\n".join(all_list)
        else:
            answer = nothing_reviewed("Allergy", "allergies")
        suggested_questions = [
            "List the active medications.",
            "What was the primary diagnosis?"
        ]

    # Intent 3: Diagnosis Queries
    elif any(word in q_lower for word in ["diagnosis", "diagnoses", "condition", "illness", "disease"]):
        disease_entities = [e for e in entities if e.entity_type == "Disease"]
        if disease_entities:
            diag_list = []
            for d in disease_entities:
                code_str = f" [{d.icd10_mapping.icd10_code}]" if d.icd10_mapping else ""
                diag_list.append(f"- {d.entity_text}{code_str}")
                citations_list.append({
                    "document_id": d.document_id,
                    "text": d.evidence or f"Diagnosed with {d.entity_text}.",
                    "similarity": None  # structured lookup, not a similarity search
                })
            answer = "Reviewed diagnoses from the processed notes:\n" + "\n".join(diag_list)
        else:
            answer = nothing_reviewed("Disease", "diagnoses")
        suggested_questions = [
            "What medications were prescribed?",
            "Summarize the clinical note."
        ]

    # Intent 4: ICD-10 Code lookup
    elif "icd" in q_lower or "code" in q_lower:
        disease_entities = [e for e in entities if e.entity_type == "Disease" and e.icd10_mapping]
        if disease_entities:
            code_list = []
            for d in disease_entities:
                code_list.append(f"- {d.entity_text}: {d.icd10_mapping.icd10_code} ({d.icd10_mapping.code_description})")
                citations_list.append({
                    "document_id": d.document_id,
                    "text": f"ICD-10 Code: {d.icd10_mapping.icd10_code}",
                    "similarity": None  # structured lookup, not a similarity search
                })
            answer = "ICD-10 codes on reviewed diagnoses:\n" + "\n".join(code_list)
        else:
            answer = nothing_reviewed("Disease", "diagnoses with ICD-10 codes")
        suggested_questions = [
            "What diagnoses were made?",
            "What was the treatment plan?"
        ]

    # Intent 5: Summary Request
    elif "summary" in q_lower or "summarize" in q_lower or "brief" in q_lower:
        summaries = db.query(Summary).filter(Summary.document_id.in_(doc_ids)).all() if doc_ids else []
        if summaries:
            sum_list = [s.summary_text for s in summaries]
            answer = "Summaries of the processed notes (AI-generated, unreviewed):\n\n" + "\n\n".join(sum_list)
            for s in summaries:
                citations_list.append({
                    "document_id": s.document_id,
                    "text": s.summary_text[:120] + "...",
                    "similarity": None  # structured lookup, not a similarity search
                })
        else:
            answer = "No clinical summaries are currently recorded for this patient."
        suggested_questions = [
            "What diagnoses were made?",
            "What medications were prescribed?",
            "Are there any allergies?"
        ]

    # Intent 6: Fallback to vector search QA
    else:
        chunks = vector_search_manager.similarity_search(query=content, patient_id=patient_id, k=3)
        if chunks:
            for c in chunks:
                citations_list.append({
                    "document_id": c["document_id"],
                    "text": c["chunk_text"][:120] + "...",
                    "similarity": c["similarity"]
                })

            doc_id = chunks[0]["document_id"]
            ans_res = qa_engine.answer_question(doc_id, content)
            answer = ans_res["answer"]
            confidence = ans_res["confidence"]
        else:
            answer = "I could not find matching clinical context inside the patient's records to address your question."
            confidence = None
        suggested_questions = [
            "Summarize the patient's note.",
            "What medications is the patient taking?",
            "List all allergies."
        ]

    return answer, citations_list, confidence, suggested_questions
