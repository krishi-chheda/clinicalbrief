from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.api.v1.deps import require_roles, GOVERNANCE_ROLES
from app.models.models import AuditLog, User
from app.schemas.schemas import AuditLogResponse
import logging

logger = logging.getLogger("clinicalbrief.api.audit")
router = APIRouter(prefix="/audit", tags=["Audit Trails"])

@router.get("/logs", response_model=List[AuditLogResponse])
def get_audit_logs(
    response: Response,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*GOVERNANCE_ROLES))
):
    """Newest first, one page at a time (R-08: the log grows with every read). X-Total-Count gives the total."""
    limit, offset = max(1, min(limit, 500)), max(0, offset)
    response.headers["X-Total-Count"] = str(db.query(AuditLog).count())
    return db.query(AuditLog).order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit).all()

