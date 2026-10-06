from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.v1.deps import require_roles, GOVERNANCE_ROLES
from app.models.models import ImportRun, ImportErrorRecord, User

router = APIRouter(prefix="/imports", tags=["Data Imports"])


@router.get("")
def list_import_runs(db: Session = Depends(get_db), current_user: User = Depends(require_roles(*GOVERNANCE_ROLES))):
    """Import history (read-only). Imports themselves run from the CLI: `py -3.12 -m app.cli import ...`."""
    runs = db.query(ImportRun).order_by(ImportRun.started_at.desc()).limit(50).all()
    return [{"run_id": r.run_id, "source_system": r.source_system, "status": r.status, "dry_run": r.dry_run,
             "counts": r.counts, "error_count": r.error_count, "message": r.message,
             "started_at": r.started_at, "finished_at": r.finished_at} for r in runs]


@router.get("/{run_id}/errors")
def list_import_errors(run_id: str, db: Session = Depends(get_db),
                       current_user: User = Depends(require_roles(*GOVERNANCE_ROLES))):
    if not db.get(ImportRun, run_id):
        raise HTTPException(status_code=404, detail="Import run not found")
    errors = db.query(ImportErrorRecord).filter(ImportErrorRecord.run_id == run_id).limit(500).all()
    # Raw source rows may contain clinical data; they stay in the database and are not returned here.
    return [{"source_file": e.source_file, "record_ref": e.record_ref, "reason": e.reason} for e in errors]
