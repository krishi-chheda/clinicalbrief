"""Which AI-extracted entities downstream features may treat as clinical fact.

AI output is never fact on its own: only entities a human approved or edited are used by FHIR export,
Copilot structured answers and the risk score. Pending entities are counted so the UI can say
"awaiting review" instead of presenting an empty result as "none".
"""
import datetime
from collections import Counter
from sqlalchemy.orm import Session
from app.models.models import AuditLog, Document, Entity, ICD10Mapping, ReviewHistory, User

REVIEWED_STATUSES = ("approved", "edited")


def patient_entities(db: Session, patient_id: str) -> tuple[list[Entity], Counter]:
    """(reviewed entities, pending count per entity_type) for a patient."""
    rows = (db.query(Entity).join(Document, Document.document_id == Entity.document_id)
            .filter(Document.patient_id == patient_id, Entity.review_status.in_(REVIEWED_STATUSES + ("pending",)))
            .all())
    reviewed = [e for e in rows if e.review_status in REVIEWED_STATUSES]
    pending = Counter(e.entity_type for e in rows if e.review_status == "pending")
    return reviewed, pending


def _remap_icd10(db: Session, entity: Entity) -> None:
    """A disease's ICD-10 code must follow its current term, or be dropped (never left stale)."""
    if entity.entity_type != "Disease":
        return
    from app.services.ai_pipeline import ai_orchestrator
    new_map = ai_orchestrator.resolve_icd10(entity.entity_text, entity.entity_type)
    mapping = entity.icd10_mapping
    if mapping and new_map:
        mapping.icd10_code, mapping.code_description, mapping.confidence = (
            new_map["icd10_code"], new_map["code_description"], new_map["confidence"])
    elif mapping:
        db.delete(mapping)
    elif new_map:
        db.add(ICD10Mapping(entity_id=entity.entity_id, icd10_code=new_map["icd10_code"],
                            code_description=new_map["code_description"], confidence=new_map["confidence"]))


def apply_review(db: Session, entity: Entity, status: str, user: User, edited_text: str | None = None) -> None:
    """Records one human decision on an AI entity: the new state, a review_history row and an audit row.

    Does not commit: the caller commits once, so a decision never exists without its history and audit entry
    (and a bulk review is all-or-nothing). status "pending" resets an earlier decision (undo).
    """
    old_text = entity.entity_text
    entity.review_status = status
    entity.reviewer_id = user.id
    now = datetime.datetime.now(datetime.timezone.utc)  # explicit: DB defaults can be second-resolution
    entity.review_timestamp = now
    if status == "edited" and edited_text:
        entity.entity_text = entity.edited_value = edited_text
        _remap_icd10(db, entity)
    elif status == "pending" and entity.original_value and entity.entity_text != entity.original_value:
        # Undo (N-16): back to exactly what the AI extracted, including its code.
        entity.entity_text = entity.edited_value = entity.original_value
        _remap_icd10(db, entity)
    db.add(ReviewHistory(entity_id=entity.entity_id, reviewer_id=user.id, action=status,
                         old_value=old_text, new_value=entity.entity_text, timestamp=now))
    db.add(AuditLog(user_id=user.id, action_type=f"review_{status}", model_used="Human-in-the-Loop Review",
                    extraction_source=f"Entity {entity.entity_id}: {old_text} -> {entity.entity_text}"[:255]))
