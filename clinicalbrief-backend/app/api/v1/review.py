"""Phase 6: human review across patients, and the governance numbers behind it.

Every number here is a count of real rows; nothing is estimated. Access follows the usual rules: reviewers
see only entities of patients they may access (clinicians: assigned patients), auditors read stats only.
"""
import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.api.v1.deps import GOVERNANCE_ROLES, REVIEW_ROLES, accessible_patient_ids, require_roles
from app.core.database import get_db
from app.models.models import Document, Entity, ICD10Mapping, Patient, ReviewHistory, User
from app.services.entities import apply_review

router = APIRouter(prefix="/review", tags=["Human review"])
Status = Literal["pending", "approved", "edited", "rejected"]


def _scoped(query, user: User, db: Session):
    allowed = accessible_patient_ids(user, db)
    return query if allowed is None else query.filter(Document.patient_id.in_(allowed))


def _method(reasoning: Optional[str]) -> str:
    """Which extractor produced the entity (recorded in its reasoning text by the pipeline)."""
    return "rule-based" if (reasoning or "").startswith("Rule-based") else "transformer" if reasoning else "unknown"


@router.get("/queue")
def review_queue(
    response: Response,
    status: Status = "pending",
    entity_type: Optional[str] = None,
    patient_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*REVIEW_ROLES)),
):
    """AI entities across every patient the reviewer may access, newest note first, grouped by note."""
    limit, offset = max(1, min(limit, 200)), max(0, offset)
    q = (db.query(Entity, Document, Patient, ICD10Mapping)
         .join(Document, Document.document_id == Entity.document_id)
         .join(Patient, Patient.patient_id == Document.patient_id)
         .outerjoin(ICD10Mapping, ICD10Mapping.entity_id == Entity.entity_id)
         .filter(Entity.review_status == status))
    if entity_type:
        q = q.filter(Entity.entity_type == entity_type)
    if patient_id:
        q = q.filter(Document.patient_id == patient_id)
    q = _scoped(q, current_user, db)
    response.headers["X-Total-Count"] = str(q.count())
    rows = (q.order_by(Document.document_date.desc().nulls_last(), Document.document_id, Entity.entity_type,
                       Entity.entity_text).offset(offset).limit(limit).all())
    return [{
        "entity_id": e.entity_id, "entity_text": e.entity_text, "entity_type": e.entity_type,
        "review_status": e.review_status, "confidence": e.confidence, "evidence": e.evidence,
        "reasoning": e.reasoning, "method": _method(e.reasoning),
        "extracted_at": e.extracted_at, "review_timestamp": e.review_timestamp,
        "icd10_code": m.icd10_code if m else None, "icd10_description": m.code_description if m else None,
        "document_id": d.document_id, "file_name": d.file_name, "document_date": d.document_date,
        "patient_id": p.patient_id, "first_name": p.first_name, "last_name": p.last_name,
        "source_system": p.source_system,
    } for e, d, p, m in rows]


class BulkReview(BaseModel):
    entity_ids: List[str] = Field(min_length=1, max_length=200)
    status: Literal["approved", "rejected", "pending"]  # editing needs a new value, so it is one at a time
    # The state the reviewer saw. If anyone changed an entity since, the request is refused (409), so a stale
    # page can't silently overwrite a colleague's decision. Undo sends the state being undone.
    from_status: Status = "pending"


@router.post("/bulk")
def bulk_review(
    payload: BulkReview,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*REVIEW_ROLES)),
):
    """All-or-nothing: one inaccessible or unknown id rejects the whole request (same 404 as a missing one)."""
    ids = list(dict.fromkeys(payload.entity_ids))
    entities = _scoped(db.query(Entity).join(Document, Document.document_id == Entity.document_id)
                       .filter(Entity.entity_id.in_(ids)), current_user, db).all()
    if len(entities) != len(ids):
        raise HTTPException(status_code=404, detail="One or more entities not found")
    changed = [e.entity_id for e in entities if e.review_status != payload.from_status]
    if changed:
        raise HTTPException(status_code=409, detail={
            "message": "Some findings were changed by someone else since you loaded them; nothing was saved.",
            "entity_ids": changed})
    for entity in entities:
        apply_review(db, entity, payload.status, current_user)
    db.commit()
    return {"updated": len(entities), "status": payload.status}


@router.get("/history")
def review_history(
    response: Response,
    everyone: bool = False,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*(REVIEW_ROLES | GOVERNANCE_ROLES))),
):
    """Your own review decisions, newest first. Admins and auditors may pass everyone=true."""
    if everyone and current_user.role not in GOVERNANCE_ROLES:
        raise HTTPException(status_code=403, detail="Your role does not permit this action")
    if not everyone and current_user.role not in REVIEW_ROLES:
        raise HTTPException(status_code=403, detail="Your role does not review AI output")
    limit, offset = max(1, min(limit, 200)), max(0, offset)
    q = (db.query(ReviewHistory, Entity, Document, User)
         .join(Entity, Entity.entity_id == ReviewHistory.entity_id)
         .join(Document, Document.document_id == Entity.document_id)
         .outerjoin(User, User.id == ReviewHistory.reviewer_id))
    if not everyone:
        # Your own decisions, but only for patients you can still access (N-17: access can be withdrawn).
        q = _scoped(q.filter(ReviewHistory.reviewer_id == current_user.id), current_user, db)
    response.headers["X-Total-Count"] = str(q.count())
    rows = q.order_by(ReviewHistory.timestamp.desc()).offset(offset).limit(limit).all()
    return [{
        "history_id": h.history_id, "action": h.action, "old_value": h.old_value, "new_value": h.new_value,
        "timestamp": h.timestamp, "reviewer": u.email if u else None, "entity_id": e.entity_id,
        "entity_type": e.entity_type, "current_status": e.review_status,
        "document_id": d.document_id, "patient_id": d.patient_id,
    } for h, e, d, u in rows]


@router.get("/stats")
def review_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*GOVERNANCE_ROLES)),
):
    """Governance numbers. Rates are shares of human decisions, not accuracy: nothing here is validated."""
    now = datetime.datetime.now(datetime.timezone.utc)
    by_type_status = db.query(Entity.entity_type, Entity.review_status, func.count()).group_by(
        Entity.entity_type, Entity.review_status).all()
    types: dict[str, dict[str, int]] = {}
    for t, s, n in by_type_status:
        types.setdefault(t, {"pending": 0, "approved": 0, "edited": 0, "rejected": 0})[s] = n

    day, week = now - datetime.timedelta(days=1), now - datetime.timedelta(days=7)
    oldest, under_day, under_week, total_pending = db.query(
        func.min(Entity.extracted_at),
        func.count(case((Entity.extracted_at >= day, 1))),
        func.count(case((Entity.extracted_at >= week, 1))),
        func.count(),
    ).filter(Entity.review_status == "pending").one()

    method = case((Entity.reasoning.like("Rule-based%"), "rule-based"), (Entity.reasoning.is_(None), "unknown"),
                  else_="transformer")
    methods: dict[str, dict[str, int]] = {}
    for m, s, n in db.query(method, Entity.review_status, func.count()).group_by(method, Entity.review_status).all():
        methods.setdefault(m, {})[s] = n

    reviewers = [{"reviewer": email or "deleted user", "action": action, "count": n} for email, action, n in
                 db.query(User.email, ReviewHistory.action, func.count())
                 .outerjoin(User, User.id == ReviewHistory.reviewer_id)
                 .group_by(User.email, ReviewHistory.action).all()]

    def rates(c):
        decided = c["approved"] + c["edited"] + c["rejected"]
        return {k: (round(c[k] / decided, 4) if decided else None) for k in ("approved", "edited", "rejected")}

    return {
        "pending": {"total": total_pending, "under_1_day": under_day, "1_to_7_days": under_week - under_day,
                    "over_7_days": total_pending - under_week, "oldest_extracted_at": oldest},
        "by_type": [{"entity_type": t, **c, "decided": c["approved"] + c["edited"] + c["rejected"], "rates": rates(c)}
                    for t, c in sorted(types.items())],
        "by_method": methods,
        "reviewers": reviewers,
    }
