from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.v1.deps import require_roles, get_accessible_patient
from app.services.entities import patient_entities
from fastapi.responses import JSONResponse
from app.models.models import User, AuditLog
from app.services.fhir_generator import fhir_exporter, validate_bundle
import logging

logger = logging.getLogger("clinicalbrief.api.fhir")
router = APIRouter(prefix="/fhir", tags=["FHIR Interoperability"])

# Matches the README role table; auditors and researchers read records but do not export them.
FHIR_EXPORT_ROLES = ("admin", "clinician", "consultant", "coder")


@router.get("/export/{patient_id}")
def export_patient_fhir(
    patient_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*FHIR_EXPORT_ROLES))
):
    """FHIR R4 transaction bundle: the patient's canonical record plus HUMAN-REVIEWED AI findings.

    Pending (unreviewed) and rejected AI entities are never exported; X-Pending-Entities says how many await
    review. X-FHIR-Validation reports the structural R4 check ("structural-r4: pass" or the first error);
    this is not AU Base / AU Core profile validation.
    """
    from app.models.models import Allergy, Diagnosis, Encounter, Medication, Observation, Procedure
    patient = get_accessible_patient(patient_id, db, current_user)
    entities, pending = patient_entities(db, patient_id)
    rows = lambda model, order: db.query(model).filter(model.patient_id == patient_id).order_by(order).all()
    record = {
        "encounters": rows(Encounter, Encounter.start_at),
        "diagnoses": rows(Diagnosis, Diagnosis.onset_at),
        "medications": rows(Medication, Medication.start_at),
        "allergies": rows(Allergy, Allergy.recorded_at),
        "procedures": rows(Procedure, Procedure.performed_at),
        "observations": rows(Observation, Observation.effective_at),
    }
    bundle = fhir_exporter.compile_fhir_bundle(patient, entities, record)
    error = validate_bundle(bundle)
    if error:
        logger.error(f"FHIR bundle for patient {patient_id} failed structural validation: {error}")

    db.add(AuditLog(
        user_id=current_user.id,
        action_type="export_fhir_bundle",
        extraction_source=f"Patient ID: {patient_id}; entries: {len(bundle['entry'])}",
        model_used="FHIR exporter (canonical record + reviewed AI entities)"
    ))
    db.commit()
    logger.info(f"Exported FHIR bundle for patient {patient_id}: {len(bundle['entry'])} entries")
    return JSONResponse(bundle, headers={
        "X-Pending-Entities": str(sum(pending.values())),
        "X-FHIR-Validation": "structural-r4: pass" if not error else f"structural-r4: FAIL {error}"[:250],
    })
