from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_supabase_token
from app.models.models import User, Patient
from collections import deque
import logging
import threading
import time

logger = logging.getLogger("clinicalbrief.api.deps")
security = HTTPBearer()

# Role model. Roles live only in public.users and are assigned by an admin, never by the user.
#   admin      - everything, incl. ETL and audit
#   clinician  - full clinical workflow, but only for patients assigned to them
#   consultant - full clinical workflow across all patients (specialist opinion)
#   coder      - reads all records, reviews/edits extracted codes, exports FHIR
#   auditor    - read-only across all records + audit trail + governance
#   researcher - read-only across all records (de-identified views are a later phase)
#   demo       - public "Try the demo" sandbox (anonymous sign-in, migration 0012): read-only, and only the patients
#                flagged is_demo. In none of the role sets below, so every write, review, export and governance
#                endpoint refuses it. Copilot is allowed: conversations are owner-scoped like everyone else's.
ROLES = {"admin", "clinician", "consultant", "coder", "auditor", "researcher", "demo"}
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


# --- S-2: rate limits ---------------------------------------------------------------------------------------------
# Per user and route group, sliding window. Kept in this process's memory.
# ponytail: in-process only; with several API workers or instances each keeps its own count, so move it to Redis then.
RATE_LIMITS = {                        # group: (requests, per seconds)
    "copilot": (20, 60),               # each answer runs retrieval and (locally) a model call
    "search": (60, 60),
    "upload": (30, 60),
}
_hits: dict[tuple[str, str], deque] = {}
_hits_lock = threading.Lock()


def rate_limited(group: str):
    """Dependency: the signed-in user, or 429 with Retry-After once they exceed the group's limit."""
    def checker(current_user: User = Depends(get_current_user)) -> User:
        if not settings.RATE_LIMITS:
            return current_user
        limit, window = RATE_LIMITS[group]
        now = time.monotonic()
        with _hits_lock:
            if len(_hits) > 5000:  # N-40: forget users with no request inside their window, so memory stays bounded
                for k in [k for k, d in _hits.items() if not d or now - d[-1] >= RATE_LIMITS[k[0]][1]]:
                    del _hits[k]
            q = _hits.setdefault((group, current_user.id), deque())
            while q and now - q[0] >= window:
                q.popleft()
            if len(q) >= limit:
                retry = max(1, int(window - (now - q[0])) + 1)
                raise HTTPException(status_code=429, detail="Too many requests. Please wait a moment and try again.",
                                    headers={"Retry-After": str(retry)})
            q.append(now)
        return current_user
    return checker


# Copilot streams each hold a worker thread until the answer is done: at most one per user and a few in total.
MAX_STREAMS, MAX_STREAMS_PER_USER = 6, 1
_streams: dict[str, int] = {}
_streams_lock = threading.Lock()


def acquire_stream(user_id: str) -> None:
    """Reserve a stream slot or raise 429; release_stream(user_id) must follow."""
    with _streams_lock:
        if settings.RATE_LIMITS and (sum(_streams.values()) >= MAX_STREAMS or _streams.get(user_id, 0) >= MAX_STREAMS_PER_USER):
            raise HTTPException(status_code=429, detail="Copilot is busy with another answer. Please try again shortly.",
                                headers={"Retry-After": "5"})
        _streams[user_id] = _streams.get(user_id, 0) + 1


def release_stream(user_id: str) -> None:
    with _streams_lock:
        _streams[user_id] = max(0, _streams.get(user_id, 0) - 1)


def audit_read(db: Session, user: User, action: str, reference: str) -> None:
    """Logs that `user` read clinical data (R-08). Records who, what kind and which id; never the content."""
    from app.models.models import AuditLog
    db.add(AuditLog(user_id=user.id, action_type=action, extraction_source=reference[:255]))
    db.commit()


def can_access_patient(user: User, patient: Patient) -> bool:
    if user.role == "demo":
        return bool(patient.is_demo)
    return user.role in GLOBAL_READ_ROLES or patient.assigned_clinician_id == user.id


def accessible_patient_ids(user: User, db: Session):
    """None means unrestricted; otherwise the set of patient ids the user may see."""
    if user.role == "demo":
        return {pid for (pid,) in db.query(Patient.patient_id).filter(Patient.is_demo.is_(True))}
    if user.role in GLOBAL_READ_ROLES:
        return None
    return {pid for (pid,) in db.query(Patient.patient_id).filter(Patient.assigned_clinician_id == user.id)}


def get_accessible_patient(patient_id: str, db: Session, user: User) -> Patient:
    patient = db.query(Patient).filter(Patient.patient_id == patient_id).first()
    # Same 404 for "missing" and "not yours" so ids can't be probed.
    if not patient or not can_access_patient(user, patient):
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient
