from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import decode_supabase_token
from app.models.models import User, Patient
import logging

logger = logging.getLogger("clinicalbrief.api.deps")
security = HTTPBearer()

# Role model. Roles live only in public.users and are assigned by an admin, never by the user.
#   admin      - everything, incl. ETL and audit
#   clinician  - full clinical workflow, but only for patients assigned to them
#   consultant - full clinical workflow across all patients (specialist opinion)
#   coder      - reads all records, reviews/edits extracted codes, exports FHIR
#   auditor    - read-only across all records + audit trail + governance
#   researcher - read-only across all records (de-identified views are a later phase)
ROLES = {"admin", "clinician", "consultant", "coder", "auditor", "researcher"}
GLOBAL_READ_ROLES = {"admin", "consultant", "coder", "auditor", "researcher"}
CLINICAL_WRITE_ROLES = {"admin", "clinician", "consultant"}       # create patients, upload documents
REVIEW_ROLES = {"admin", "clinician", "consultant", "coder"}       # approve / reject / edit AI output
GOVERNANCE_ROLES = {"admin", "auditor"}                            # audit logs, governance stats


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """Verifies the Supabase access token and loads the matching ClinicalBrief profile."""
    payload = decode_supabase_token(credentials.credentials)
    if not payload:
        # 401 = "your session is invalid, sign in again"
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user or user.role not in ROLES:
        # 403 = "you are signed in, but have no ClinicalBrief access" - signing in again won't help.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No ClinicalBrief profile or role for this account. Ask an administrator.",
        )
    return user


def require_roles(*roles: str):
    allowed = set(roles)

    def checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your role does not permit this action")
        return current_user
    return checker


get_current_admin = require_roles("admin")


def audit_read(db: Session, user: User, action: str, reference: str) -> None:
    """Logs that `user` read clinical data (R-08). Records who, what kind and which id; never the content."""
    from app.models.models import AuditLog
    db.add(AuditLog(user_id=user.id, action_type=action, extraction_source=reference[:255]))
    db.commit()


def can_access_patient(user: User, patient: Patient) -> bool:
    return user.role in GLOBAL_READ_ROLES or patient.assigned_clinician_id == user.id


def accessible_patient_ids(user: User, db: Session):
    """None means unrestricted; otherwise the set of patient ids the user may see."""
    if user.role in GLOBAL_READ_ROLES:
        return None
    return {pid for (pid,) in db.query(Patient.patient_id).filter(Patient.assigned_clinician_id == user.id)}


def get_accessible_patient(patient_id: str, db: Session, user: User) -> Patient:
    patient = db.query(Patient).filter(Patient.patient_id == patient_id).first()
    # Same 404 for "missing" and "not yours" so ids can't be probed.
    if not patient or not can_access_patient(user, patient):
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient
