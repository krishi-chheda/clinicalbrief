"""Synthea FHIR R4 bundles -> canonical model.

Imported: Patient, Encounter, Condition, MedicationRequest, AllergyIntolerance, Procedure,
Observation, DocumentReference (embedded clinical notes). Every other resource type is counted
as skipped in the run report, not silently dropped.
"""
import base64
import json
from pathlib import Path

from app.ingestion.core import Batch, Reject, det_id, parse_dt, parse_date
from app.models.models import (
    Patient, Encounter, Document, ClinicalNote, Diagnosis, Medication, Allergy, Procedure, Observation,
)

SOURCE = "synthea"
WRITE_ORDER = [Patient, Encounter, Document, ClinicalNote, Diagnosis, Medication, Allergy, Procedure, Observation]


def ref_id(ref: dict | None) -> str | None:
    """'urn:uuid:X' or 'Type/X' -> 'X'. Conditional references ('Type?identifier=...') are not resolvable."""
    value = (ref or {}).get("reference", "")
    if value.startswith("urn:uuid:"):
        return value[9:]
    if "/" in value and "?" not in value:
        return value.rsplit("/", 1)[1]
    return None


def first_coding(concept: dict | None) -> tuple[str | None, str | None, str | None]:
    concept = concept or {}
    coding = (concept.get("coding") or [{}])[0]
    return coding.get("code"), coding.get("system"), concept.get("text") or coding.get("display")


def status_code(concept: dict | None) -> str | None:
    return first_coding(concept)[0]


def bundle_files(path: Path) -> list[Path]:
    return sorted(p for p in path.rglob("*.json"))


def build(path: Path, limit: int | None = None):
    def _build(batch: Batch):
        patients_seen = 0
        for file in bundle_files(path):
            bundle = json.loads(file.read_text(encoding="utf-8"))
            if bundle.get("resourceType") != "Bundle" or bundle.get("type") != "transaction":
                batch.counts["skipped.non_patient_bundle"] += 1
                continue
            if limit is not None and patients_seen >= limit:
                break
            patients_seen += 1
            _bundle(batch, file.name, bundle)
    return _build


def _bundle(batch: Batch, fname: str, bundle: dict):
    resources = [e["resource"] for e in bundle.get("entry", []) if "resource" in e]
    patients = [r for r in resources if r.get("resourceType") == "Patient"]
    if len(patients) != 1:
        batch.reject("patients", fname, fname, f"expected exactly 1 Patient in bundle, found {len(patients)}")
        return
    try:
        pid_src = _patient(batch, patients[0])
    except Reject as e:
        batch.reject("patients", fname, patients[0].get("id"), str(e), patients[0].get("name"))
        return  # nothing else in this bundle can be linked
    patient_id = det_id(SOURCE, "patients", pid_src)
    meds_by_id = {r["id"]: r for r in resources if r.get("resourceType") == "Medication" and "id" in r}

    # Encounters first so other resources can link to them.
    ordered = sorted(resources, key=lambda r: r.get("resourceType") != "Encounter")
    for r in ordered:
        rtype = r.get("resourceType")
        mapper = MAPPERS.get(rtype)
        if rtype in ("Patient", "Medication"):  # Medication is consumed via MedicationRequest references
            continue
        if mapper is None:
            batch.counts[f"skipped.{rtype}"] += 1
            continue
        model, table = mapper[0], mapper[0].__tablename__
        try:
            subject = ref_id(r.get("subject") or r.get("patient"))
            if subject != pid_src:
                raise Reject(f"subject {subject!r} does not match bundle patient")
            if not r.get("id"):
                raise Reject("resource has no id")
            rows = mapper[1](r, patient_id, batch, meds_by_id)
        except Reject as e:
            batch.reject(table, fname, f"{rtype}/{r.get('id')}", str(e), {k: r.get(k) for k in ("id", "code", "status")})
            continue
        for m, row in rows:
            batch.add(m, row)


def _patient(batch: Batch, r: dict) -> str:
    if not r.get("id"):
        raise Reject("Patient has no id")
    names = r.get("name") or []
    name = next((n for n in names if n.get("use") == "official"), names[0] if names else None)
    if not name or not name.get("family"):
        raise Reject("Patient has no family name")
    gender = r.get("gender")
    if gender not in ("male", "female", "other", "unknown"):
        raise Reject(f"invalid gender {gender!r}")
    batch.add(Patient, {
        "patient_id": det_id(SOURCE, "patients", r["id"]), "source_id": r["id"],
        "first_name": " ".join(name.get("given") or [])[:100] or "(no given name)",
        "last_name": name["family"][:100],
        "date_of_birth": parse_date(r.get("birthDate")),
        "deceased_date": parse_date(r.get("deceasedDateTime")),
        "gender": gender.capitalize(),
    })
    return r["id"]


def _encounter_ref(r: dict, batch: Batch) -> str | None:
    src = ref_id(r.get("encounter") or ((r.get("context") or {}).get("encounter") or [None])[0])
    if not src:
        return None
    eid = det_id(SOURCE, "encounters", src)
    if batch.has(Encounter, eid):
        return eid
    batch.counts["encounter_ref.unresolved"] += 1
    return None


def _encounter(r, patient_id, batch, _meds):
    period = r.get("period") or {}
    _, _, etype = first_coding((r.get("type") or [None])[0])
    _, _, reason = first_coding((r.get("reasonCode") or [None])[0])
    return [(Encounter, {
        "encounter_id": det_id(SOURCE, "encounters", r["id"]), "source_id": r["id"], "patient_id": patient_id,
        "encounter_class": (r.get("class") or {}).get("code"),
        "encounter_type": (etype or "")[:255] or None, "reason": (reason or "")[:255] or None,
        "start_at": parse_dt(period.get("start")), "end_at": parse_dt(period.get("end")),
    })]


def _condition(r, patient_id, batch, _meds):
    code, system, display = first_coding(r.get("code"))
    if not display:
        raise Reject("Condition has no code/display")
    return [(Diagnosis, {
        "diagnosis_id": det_id(SOURCE, "diagnoses", r["id"]), "source_id": r["id"], "patient_id": patient_id,
        "encounter_id": _encounter_ref(r, batch), "code": code, "code_system": system, "display": display,
        "clinical_status": status_code(r.get("clinicalStatus")),
        "onset_at": parse_dt(r.get("onsetDateTime")), "abatement_at": parse_dt(r.get("abatementDateTime")),
    })]


def _medication_request(r, patient_id, batch, meds_by_id):
    concept = r.get("medicationCodeableConcept")
    if concept is None and r.get("medicationReference"):
        concept = (meds_by_id.get(ref_id(r["medicationReference"])) or {}).get("code")
    code, system, name = first_coding(concept)
    if not name:
        raise Reject("MedicationRequest has no resolvable medication")
    dose = route = frequency = None
    dosage = (r.get("dosageInstruction") or [None])[0]
    if dosage:
        qty = ((dosage.get("doseAndRate") or [{}])[0]).get("doseQuantity") or {}
        if qty.get("value") is not None:
            dose = f"{qty['value']} {qty.get('unit') or ''}".strip()
        route = first_coding(dosage.get("route"))[2]
        rep = (dosage.get("timing") or {}).get("repeat") or {}
        if rep.get("frequency") and rep.get("period"):
            frequency = f"{rep['frequency']} per {rep['period']} {rep.get('periodUnit', '')}".strip()
        if dosage.get("asNeededBoolean"):
            frequency = f"{frequency} as needed" if frequency else "as needed"
    return [(Medication, {
        "medication_id": det_id(SOURCE, "medications", r["id"]), "source_id": r["id"], "patient_id": patient_id,
        "encounter_id": _encounter_ref(r, batch), "code": code, "code_system": system, "medication_name": name,
        "dose": dose, "route": route, "frequency": frequency, "status": r.get("status"),
        "start_at": parse_dt(r.get("authoredOn")), "end_at": None,
    })]


def _allergy(r, patient_id, batch, _meds):
    code, system, allergen = first_coding(r.get("code"))
    if not allergen:
        raise Reject("AllergyIntolerance has no code/display")
    reaction = (r.get("reaction") or [{}])[0]
    manifestation = first_coding((reaction.get("manifestation") or [None])[0])[2]
    return [(Allergy, {
        "allergy_id": det_id(SOURCE, "allergies", r["id"]), "source_id": r["id"], "patient_id": patient_id,
        "code": code, "code_system": system, "allergen": allergen,
        "category": (r.get("category") or [None])[0], "criticality": r.get("criticality"),
        "reaction": manifestation, "severity": reaction.get("severity"),
        "clinical_status": status_code(r.get("clinicalStatus")), "recorded_at": parse_dt(r.get("recordedDate")),
    })]


def _procedure(r, patient_id, batch, _meds):
    code, system, name = first_coding(r.get("code"))
    if not name:
        raise Reject("Procedure has no code/display")
    performed = r.get("performedDateTime") or (r.get("performedPeriod") or {}).get("start")
    return [(Procedure, {
        "procedure_id": det_id(SOURCE, "procedures", r["id"]), "source_id": r["id"], "patient_id": patient_id,
        "encounter_id": _encounter_ref(r, batch), "code": code, "code_system": system, "procedure_name": name,
        "performed_at": parse_dt(performed),
    })]


def _value(obj: dict) -> tuple[str | None, str | None]:
    if "valueQuantity" in obj:
        q = obj["valueQuantity"]
        return (None if q.get("value") is None else str(q["value"])), q.get("unit")
    if "valueCodeableConcept" in obj:
        return first_coding(obj["valueCodeableConcept"])[2], None
    for key in ("valueString", "valueBoolean", "valueInteger", "valueDateTime"):
        if key in obj:
            return str(obj[key]), None
    return None, None


def _observation(r, patient_id, batch, _meds):
    code, system, name = first_coding(r.get("code"))
    if not name:
        raise Reject("Observation has no code/display")
    value, unit = _value(r)
    if value is None and r.get("component"):
        # e.g. blood pressure: keep each component with its own unit.
        parts = []
        for c in r["component"]:
            v, u = _value(c)
            if v is not None:
                parts.append(f"{first_coding(c.get('code'))[2]}: {v} {u or ''}".strip())
        value = "; ".join(parts) or None
    category = first_coding((r.get("category") or [None])[0])[0]
    return [(Observation, {
        "observation_id": det_id(SOURCE, "observations", r["id"]), "source_id": r["id"], "patient_id": patient_id,
        "encounter_id": _encounter_ref(r, batch), "code": code, "code_system": system, "name": name,
        "category": category, "value": value, "unit": unit, "flag": None, "reference_range": None,
        "effective_at": parse_dt(r.get("effectiveDateTime") or (r.get("effectivePeriod") or {}).get("start")),
    })]


def _document(r, patient_id, batch, _meds):
    attachment = ((r.get("content") or [{}])[0]).get("attachment") or {}
    if not attachment.get("data"):
        raise Reject("DocumentReference has no embedded note text")
    try:
        text = base64.b64decode(attachment["data"]).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        raise Reject("note text is not valid base64 UTF-8")
    if not text.strip():
        raise Reject("note text is empty")
    doc_id = det_id(SOURCE, "documents", r["id"])
    doc_type = first_coding(r.get("type"))[2] or "Clinical note"
    date = parse_dt(r.get("date"))
    return [
        (Document, {
            "document_id": doc_id, "source_id": r["id"], "patient_id": patient_id,
            "encounter_id": _encounter_ref(r, batch), "document_date": date,
            "file_name": f"{doc_type} {date.date() if date else ''}".strip()[:255],
            "file_type": "fhir-note", "file_url": None, "classification": doc_type[:100], "status": "pending",
        }),
        (ClinicalNote, {
            "note_id": det_id(SOURCE, "clinical_notes", r["id"]), "document_id": doc_id,
            "patient_id": patient_id, "original_text": text,
        }),
    ]


MAPPERS = {
    "Encounter": (Encounter, _encounter),
    "Condition": (Diagnosis, _condition),
    "MedicationRequest": (Medication, _medication_request),
    "AllergyIntolerance": (Allergy, _allergy),
    "Procedure": (Procedure, _procedure),
    "Observation": (Observation, _observation),
    "DocumentReference": (Document, _document),
}
