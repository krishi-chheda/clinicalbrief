from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.api.v1.deps import (
    get_current_user, require_roles, get_accessible_patient, accessible_patient_ids,
    CLINICAL_WRITE_ROLES, GOVERNANCE_ROLES, audit_read,
)
from app.models.models import Patient, User
from app.schemas.schemas import PatientCreate, PatientResponse, PatientListItem
from app.services.entities import patient_entities
import logging
import re

logger = logging.getLogger("clinicalbrief.api.patients")
router = APIRouter(prefix="/patients", tags=["Patient Directory"])

@router.post("", response_model=PatientResponse, status_code=status.HTTP_201_CREATED)
def create_patient(
    patient_data: PatientCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*CLINICAL_WRITE_ROLES))
):
    """Registers a new patient profile in the registry."""
    # Simple deduplication check based on name and DOB
    existing = db.query(Patient).filter(
        Patient.first_name == patient_data.first_name,
        Patient.last_name == patient_data.last_name,
        Patient.date_of_birth == patient_data.date_of_birth
    ).first()

    if existing:
        return get_accessible_patient(existing.patient_id, db, current_user)

    new_patient = Patient(
        first_name=patient_data.first_name,
        last_name=patient_data.last_name,
        date_of_birth=patient_data.date_of_birth,
        gender=patient_data.gender,
        assigned_clinician_id=current_user.id if current_user.role == "clinician" else None,
        source_system="clinicalbrief", provenance="manual",
    )
    db.add(new_patient)
    db.commit()
    db.refresh(new_patient)
    logger.info(f"Registered patient {new_patient.patient_id}")
    return new_patient

@router.get("", response_model=List[PatientListItem])
def list_patients(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Patients visible to the caller: all for global-read roles, assigned ones for clinicians."""
    from sqlalchemy import func
    from app.models.models import Document, Encounter
    allowed = accessible_patient_ids(current_user, db)
    query = db.query(Patient)
    if allowed is not None:
        query = query.filter(Patient.patient_id.in_(allowed))
    patients = query.order_by(Patient.last_name, Patient.first_name).all()
    # Two grouped queries give the list its context (notes, last encounter) without N+1 lookups.
    docs = dict(db.query(Document.patient_id, func.count(Document.document_id)).group_by(Document.patient_id).all())
    last = dict(db.query(Encounter.patient_id, func.max(Encounter.start_at)).group_by(Encounter.patient_id).all())
    return [PatientListItem.model_validate(p).model_copy(update={
        "document_count": docs.get(p.patient_id, 0), "last_encounter_at": last.get(p.patient_id)}) for p in patients]


@router.get("/governance/stats")
def get_governance_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*GOVERNANCE_ROLES))
):
    try:
        from app.models.models import Patient, Document, Entity, AuditLog
        from sqlalchemy import func, select

        # One round trip for all counts: the database can be far away (each trip ~250 ms to Supabase Tokyo).
        def count(model, *where):
            return select(func.count()).select_from(model).where(*where).scalar_subquery()
        row = db.execute(select(
            count(Patient), count(Document), count(Entity), count(AuditLog),
            *(count(Entity, Entity.review_status == s) for s in ("approved", "rejected", "edited", "pending")),
        )).one()
        total_patients, total_documents, total_entities, total_audit_logs,             approved_count, rejected_count, edited_count, pending_count = row

        # Share of reviewed AI entities a human approved unchanged. Not an accuracy measure, and
        # undefined (None) until something has been reviewed.
        reviewed_total = approved_count + edited_count + rejected_count
        approval_rate = round(approved_count / reviewed_total, 4) if reviewed_total else None

        # Entity type breakdown
        type_counts = db.query(Entity.entity_type, func.count(Entity.entity_id)).group_by(Entity.entity_type).all()
        entity_distribution = {t: c for t, c in type_counts}

        return {
            "total_patients": total_patients,
            "total_documents": total_documents,
            "total_entities": total_entities,
            "review_metrics": {
                "pending": pending_count,
                "approved": approved_count,
                "rejected": rejected_count,
                "edited": edited_count,
                "total_reviewed": reviewed_total,
                "approval_rate": approval_rate
            },
            "entity_distribution": entity_distribution,
            "total_audit_logs": total_audit_logs
        }
    except Exception:
        logger.exception("Failed to compute governance stats")
        raise HTTPException(status_code=500, detail="Failed to compute governance stats")


@router.get("/{patient_id}", response_model=PatientResponse)
def get_patient(
    patient_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    patient = get_accessible_patient(patient_id, db, current_user)
    return patient


@router.get("/{patient_id}/risk")
def get_patient_risk(
    patient_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    patient = get_accessible_patient(patient_id, db, current_user)

    from app.services.risk_assessor import risk_engine
    # Read-only: viewing a score must not create rows.
    return risk_engine.calculate_patient_risk(patient_id, db)


GRAPH_MAX_PER_TYPE = 15
_SNOMED_TAG = re.compile(r"\s*\((disorder|finding|situation|morphologic abnormality|procedure|substance|product)\)\s*$", re.I)
_FINDING_TAGS = ("(finding)", "(situation)")  # Synthea records social / situational facts as conditions


@router.get("/{patient_id}/graph")
def get_patient_graph(
    patient_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Patient-centred graph: the structured record (source data) plus human-reviewed AI findings.

    Unreviewed AI output is counted (`pending_review`), never drawn (N-02). Edges only say what the data says:
    the record says the patient has / takes / is allergic to something; a reviewed AI finding was "mentioned in
    note" (not proof of current use), and AI findings from one note are linked as "mentioned in same note".
    """
    from app.models.models import Allergy, Diagnosis, Medication
    patient = get_accessible_patient(patient_id, db, current_user)
    entities, pending = patient_entities(db, patient_id)

    nodes, edges, totals = [], [], {}
    patient_node_id = f"patient_{patient_id}"
    nodes.append({"id": patient_node_id, "label": f"{patient.first_name} {patient.last_name}", "type": "Patient",
                  "source": "record", "details": f"Born {patient.date_of_birth or 'unknown'} | {patient.gender}"})
    seen: dict[tuple, str] = {}

    def add(node_type, label, source, details, edge_label, key=None):
        """One node per (type, label); returns its id, or None when the type is over the display cap."""
        label = _SNOMED_TAG.sub("", label or "").strip()
        if not label:
            return None
        k = (node_type, label.lower())
        if k in seen:
            return seen[k]
        totals[node_type] = totals.get(node_type, 0) + 1
        if totals[node_type] > GRAPH_MAX_PER_TYPE:
            return None
        node_id = f"{source}_{node_type}_{key or len(seen)}"
        seen[k] = node_id
        nodes.append({"id": node_id, "label": label, "type": node_type, "source": source, "details": details})
        edges.append({"source": patient_node_id, "target": node_id, "label": edge_label})
        return node_id

    # 1. Structured record (imported source data). Current items only: active / unresolved conditions, active meds.
    for d in (db.query(Diagnosis).filter(Diagnosis.patient_id == patient_id)
              .order_by(Diagnosis.onset_at.desc().nulls_last()).all()):
        if d.clinical_status not in (None, "active", "recurrence", "relapse"):
            continue
        finding = any(t in (d.display or "").lower() for t in _FINDING_TAGS)
        onset = d.onset_at.date().isoformat() if d.onset_at else "unknown"
        add("Finding" if finding else "Condition", d.display, "record",
            f"From the record ({d.source_system or 'source'}). Onset {onset}. Status {d.clinical_status or 'not recorded'}.",
            "has finding" if finding else "has condition")
    for m in (db.query(Medication).filter(Medication.patient_id == patient_id)
              .order_by(Medication.start_at.desc().nulls_last()).all()):
        if m.status not in (None, "active"):
            continue
        dose = " ".join(x for x in (m.dose, m.route, m.frequency) if x) or "no dosage recorded"
        add("Medication", m.medication_name, "record", f"From the record ({m.source_system or 'source'}). {dose}.", "takes")
    for a in db.query(Allergy).filter(Allergy.patient_id == patient_id).all():
        detail = ", ".join(x for x in (a.reaction, a.severity, a.criticality and f"criticality {a.criticality}") if x)
        add("Allergy", a.allergen, "record", f"From the record ({a.source_system or 'source'}). {detail or 'No reaction recorded'}.",
            "allergic to")

    # 2. Human-reviewed AI findings from notes.
    ai_type = {"Disease": "Condition"}
    by_doc: dict[str, dict[str, list[str]]] = {}
    for ent in entities:
        node_type = ai_type.get(ent.entity_type, ent.entity_type)
        score = "not scored" if ent.confidence is None else f"{round(ent.confidence * 100)}%"
        icd = f" ICD-10 {ent.icd10_mapping.icd10_code}." if ent.entity_type == "Disease" and ent.icd10_mapping else ""
        node_id = add(node_type, ent.entity_text, "ai",
                      f"AI-extracted from a note, {ent.review_status} by a reviewer. Confidence: {score}.{icd}",
                      # A note mention doesn't establish current use or a confirmed allergy (FHIR: status unknown).
                      "mentioned in note",
                      key=ent.entity_id)
        if node_id and node_id.startswith("ai_"):
            by_doc.setdefault(ent.document_id, {}).setdefault(node_type, []).append(node_id)
    for groups in by_doc.values():
        for c in groups.get("Condition", []):
            for m in groups.get("Medication", []):
                edges.append({"source": c, "target": m, "label": "mentioned in same note"})  # co-occurrence only

    return {
        "nodes": nodes,
        "edges": edges,
        "pending_review": sum(pending.values()),
        "totals": totals,              # per type, before the display cap
        "max_per_type": GRAPH_MAX_PER_TYPE,
    }


def _iso(dt):
    return dt.isoformat() if dt else None


@router.get("/{patient_id}/record")
def get_patient_record(
    patient_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 50,
):
    """The patient's structured (canonical) record with provenance, plus a dated timeline.

    Everything here comes from imported or entered source data - nothing is generated.
    """
    from app.models.models import Encounter, Diagnosis, Medication, Allergy, Procedure, Observation
    patient = get_accessible_patient(patient_id, db, current_user)
    audit_read(db, current_user, "view_record", f"Patient ID: {patient_id}")
    limit = max(1, min(limit, 500))

    from sqlalchemy import func, select

    def rows(model, order_col):
        return (db.query(model).filter(model.patient_id == patient_id)
                .order_by(order_col.desc().nulls_last()).limit(limit).all())

    def src(r):
        return {"source_system": r.source_system, "source_id": r.source_id, "provenance": r.provenance}

    # All six counts in one round trip (each trip to the database costs real latency).
    count = lambda m: select(func.count()).select_from(m).where(m.patient_id == patient_id).scalar_subquery()
    n_enc, n_dx, n_med, n_all, n_proc, n_obs = db.execute(select(
        count(Encounter), count(Diagnosis), count(Medication), count(Allergy), count(Procedure), count(Observation))).one()
    encounters = rows(Encounter, Encounter.start_at)
    diagnoses = rows(Diagnosis, Diagnosis.onset_at)
    medications = rows(Medication, Medication.start_at)
    allergies = rows(Allergy, Allergy.recorded_at)
    procedures = rows(Procedure, Procedure.performed_at)
    observations = rows(Observation, Observation.effective_at)

    timeline = sorted(
        [{"at": _iso(e.start_at), "kind": "encounter", "label": e.encounter_type or e.encounter_class or "Encounter",
          "detail": e.reason, "encounter_id": e.encounter_id} for e in encounters if e.start_at]
        + [{"at": _iso(d.onset_at), "kind": "diagnosis", "label": d.display, "detail": d.clinical_status,
            "encounter_id": d.encounter_id} for d in diagnoses if d.onset_at]
        + [{"at": _iso(m.start_at), "kind": "medication", "label": m.medication_name, "detail": m.status,
            "encounter_id": m.encounter_id} for m in medications if m.start_at]
        + [{"at": _iso(p.performed_at), "kind": "procedure", "label": p.procedure_name, "detail": None,
            "encounter_id": p.encounter_id} for p in procedures if p.performed_at],
        key=lambda e: e["at"], reverse=True,
    )[:limit]

    return {
        "patient_id": patient.patient_id,
        "source_system": patient.source_system,
        "date_of_birth_known": patient.date_of_birth is not None,
        "counts": {"encounters": n_enc, "diagnoses": n_dx, "medications": n_med, "allergies": n_all,
                   "procedures": n_proc, "observations": n_obs},
        "encounters": [{"encounter_id": e.encounter_id, "class": e.encounter_class, "type": e.encounter_type,
                        "reason": e.reason, "start_at": _iso(e.start_at), "end_at": _iso(e.end_at), **src(e)} for e in encounters],
        "diagnoses": [{"code": d.code, "code_system": d.code_system, "display": d.display, "clinical_status": d.clinical_status,
                       "onset_at": _iso(d.onset_at), "abatement_at": _iso(d.abatement_at), "encounter_id": d.encounter_id, **src(d)} for d in diagnoses],
        "medications": [{"code": m.code, "code_system": m.code_system, "name": m.medication_name, "dose": m.dose,
                         "route": m.route, "frequency": m.frequency, "status": m.status, "start_at": _iso(m.start_at),
                         "end_at": _iso(m.end_at), **src(m)} for m in medications],
        "allergies": [{"code": a.code, "code_system": a.code_system, "allergen": a.allergen, "category": a.category,
                       "criticality": a.criticality, "reaction": a.reaction, "severity": a.severity,
                       "clinical_status": a.clinical_status, "recorded_at": _iso(a.recorded_at), **src(a)} for a in allergies],
        "procedures": [{"code": p.code, "code_system": p.code_system, "name": p.procedure_name,
                        "performed_at": _iso(p.performed_at), **src(p)} for p in procedures],
        "observations": [{"code": o.code, "code_system": o.code_system, "name": o.name, "category": o.category,
                          "value": o.value, "unit": o.unit, "flag": o.flag, "reference_range": o.reference_range,
                          "effective_at": _iso(o.effective_at), **src(o)} for o in observations],
        "timeline": timeline,
    }
