"""FHIR R4 transaction bundle built from the canonical clinical record (Phase 5), plus human-reviewed AI findings.

Honesty rules:
- Record resources carry exactly what the source data says. When FHIR requires an element that was never
  captured (Procedure.status, Observation.status, Encounter.status without an end date), the FHIR code
  "unknown" is used rather than a guess. Medications are exported as MedicationStatement, because
  MedicationRequest requires an `intent` the record does not have.
- AI-derived resources: only entities a human approved or edited (the caller filters them); Conditions are
  verificationStatus "unconfirmed", MedicationStatements status "unknown", and both are tagged AI-extracted.
- Every resource is tagged with where it came from (record source system, or the AI pipeline).
- Resources reference each other by bundle fullUrl (urn:uuid), so references resolve inside the transaction.
- A coding is only emitted for a real code; otherwise only `text`. Nothing clinical is invented.

Validation: structural, against the R4 data model (fhir.resources R4B models, see validate_bundle). That is not
profile conformance: AU Base / AU Core are not claimed (see README).
"""
import datetime
import re
from typing import Any, Dict, List, Optional

from app.models.models import Patient as PatientModel, Entity as EntityModel

FHIR_GENDERS = {"male", "female", "other", "unknown"}
AI_TAG = {"system": "urn:clinicalbrief:provenance", "code": "ai-extracted-human-reviewed",
          "display": "Extracted by AI from a clinical note and reviewed by a person"}
ACT_CODE = "http://terminology.hl7.org/CodeSystem/v3-ActCode"
ENCOUNTER_CLASSES = {"AMB", "EMER", "IMP", "HH", "VR", "ACUTE", "NONAC", "OBSENC", "PRENC", "SS", "FLD"}
CONDITION_CLINICAL = {"active", "recurrence", "relapse", "inactive", "remission", "resolved"}
MED_STATEMENT_STATUS = {"active", "completed", "entered-in-error", "intended", "stopped", "on-hold", "unknown", "not-taken"}
ALLERGY_CLINICAL = {"active", "inactive", "resolved"}
ALLERGY_CATEGORY = {"food", "medication", "environment", "biologic"}
ALLERGY_CRITICALITY = {"low", "high", "unable-to-assess"}
REACTION_SEVERITY = {"mild", "moderate", "severe"}
OBS_CATEGORIES = {"social-history", "vital-signs", "imaging", "laboratory", "procedure", "survey", "exam", "therapy", "activity"}
_NUMBER = re.compile(r"^-?\d+(\.\d+)?$")


def _urn(uuid_str: str) -> str:
    return f"urn:uuid:{uuid_str}"


def _dt(value) -> Optional[str]:
    """FHIR dateTime: a time needs a timezone. Naive values (SQLite drops the offset) are UTC, matching the
    importer's convention (ingestion.core.parse_dt); dates stay plain dates."""
    if not value:
        return None
    if isinstance(value, datetime.datetime) and value.tzinfo is None:
        value = value.replace(tzinfo=datetime.timezone.utc)
    return value.isoformat()


def _source_tag(source_system: Optional[str]) -> Dict[str, str]:
    return {"system": "urn:clinicalbrief:provenance", "code": "source-record",
            "display": f"Imported from {source_system or 'an unknown source'} (not AI-generated)"}


def _concept(code: Optional[str], system: Optional[str], text: Optional[str]) -> Dict[str, Any]:
    concept: Dict[str, Any] = {"text": text or code or "unknown"}
    if code and system:
        concept["coding"] = [{"system": system, "code": code, **({"display": text} if text else {})}]
    return concept


def _status_coding(system: str, code: str) -> Dict[str, Any]:
    return {"coding": [{"system": system, "code": code}]}


def _drop_none(d: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


class FHIRExportService:
    # --- patient ------------------------------------------------------------------------------------
    def patient_resource(self, patient: PatientModel) -> Dict[str, Any]:
        gender = (patient.gender or "").lower()
        resource: Dict[str, Any] = {
            "resourceType": "Patient",
            "name": [{"use": "official", "family": patient.last_name, "given": [patient.first_name]}],
            "gender": gender if gender in FHIR_GENDERS else "unknown",
        }
        if getattr(patient, "source_system", None) and getattr(patient, "source_id", None):
            resource["identifier"] = [{"system": f"urn:clinicalbrief:source:{patient.source_system}", "value": patient.source_id}]
            resource["meta"] = {"tag": [_source_tag(patient.source_system)]}
        if patient.date_of_birth:
            resource["birthDate"] = patient.date_of_birth.isoformat()
        if getattr(patient, "deceased_date", None):
            resource["deceasedDateTime"] = patient.deceased_date.isoformat()
        return resource

    # --- canonical record -----------------------------------------------------------------------------
    def encounter_resource(self, pid: str, e) -> Dict[str, Any]:
        cls = (e.encounter_class or "").upper()
        return _drop_none({
            "resourceType": "Encounter", "meta": {"tag": [_source_tag(e.source_system)]},
            "status": "finished" if e.end_at else "unknown",  # only "finished" when the record has an end time
            # class is required (1..1): the record's ActCode, or the standard "unknown" null flavour.
            "class": {"system": ACT_CODE, "code": cls} if cls in ENCOUNTER_CLASSES
            else {"system": "http://terminology.hl7.org/CodeSystem/v3-NullFlavor", "code": "UNK"},
            "type": [{"text": e.encounter_type}] if e.encounter_type else None,
            "reasonCode": [{"text": e.reason}] if e.reason else None,
            "subject": {"reference": _urn(pid)},
            "period": _drop_none({"start": _dt(e.start_at), "end": _dt(e.end_at)}) or None,
        })

    def record_condition_resource(self, pid: str, d) -> Dict[str, Any]:
        status = (d.clinical_status or "").lower()
        return _drop_none({
            "resourceType": "Condition", "meta": {"tag": [_source_tag(d.source_system)]},
            "clinicalStatus": _status_coding("http://terminology.hl7.org/CodeSystem/condition-clinical", status)
            if status in CONDITION_CLINICAL else None,
            "code": _concept(d.code, d.code_system, d.display),
            "subject": {"reference": _urn(pid)},
            "encounter": {"reference": _urn(d.encounter_id)} if d.encounter_id else None,
            "onsetDateTime": _dt(d.onset_at),
            "abatementDateTime": _dt(d.abatement_at),
        })

    def record_medication_resource(self, pid: str, m) -> Dict[str, Any]:
        status = (m.status or "").lower()
        dosage = " ".join(x for x in (m.dose, m.route, m.frequency) if x)
        return _drop_none({
            "resourceType": "MedicationStatement", "meta": {"tag": [_source_tag(m.source_system)]},
            "status": status if status in MED_STATEMENT_STATUS else "unknown",
            "medicationCodeableConcept": _concept(m.code, m.code_system, m.medication_name),
            "subject": {"reference": _urn(pid)},
            "context": {"reference": _urn(m.encounter_id)} if m.encounter_id else None,
            "effectivePeriod": _drop_none({"start": _dt(m.start_at), "end": _dt(m.end_at)}) or None,
            "dosage": [{"text": dosage}] if dosage else None,
        })

    def allergy_resource(self, pid: str, a) -> Dict[str, Any]:
        status, category = (a.clinical_status or "").lower(), (a.category or "").lower()
        criticality, severity = (a.criticality or "").lower(), (a.severity or "").lower()
        reaction = None
        if a.reaction:
            reaction = [_drop_none({"manifestation": [{"text": a.reaction}],
                                    "severity": severity if severity in REACTION_SEVERITY else None})]
        return _drop_none({
            "resourceType": "AllergyIntolerance", "meta": {"tag": [_source_tag(a.source_system)]},
            "clinicalStatus": _status_coding("http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", status)
            if status in ALLERGY_CLINICAL else None,
            "category": [category] if category in ALLERGY_CATEGORY else None,
            "criticality": criticality if criticality in ALLERGY_CRITICALITY else None,
            "code": _concept(a.code, a.code_system, a.allergen),
            "patient": {"reference": _urn(pid)},
            "recordedDate": _dt(a.recorded_at),
            "reaction": reaction,
        })

    def procedure_resource(self, pid: str, p) -> Dict[str, Any]:
        return _drop_none({
            "resourceType": "Procedure", "meta": {"tag": [_source_tag(p.source_system)]},
            "status": "unknown",  # required by FHIR, not captured by the import
            "code": _concept(p.code, p.code_system, p.procedure_name),
            "subject": {"reference": _urn(pid)},
            "encounter": {"reference": _urn(p.encounter_id)} if p.encounter_id else None,
            "performedDateTime": _dt(p.performed_at),
        })

    def observation_resource(self, pid: str, o) -> Dict[str, Any]:
        category = (o.category or "").lower()
        value: Dict[str, Any] = {}
        if o.value is not None and _NUMBER.match(o.value.strip()):
            value["valueQuantity"] = _drop_none({"value": float(o.value), "unit": o.unit})
        elif o.value:
            value["valueString"] = o.value if not o.unit else f"{o.value} {o.unit}"
        return _drop_none({
            "resourceType": "Observation", "meta": {"tag": [_source_tag(o.source_system)]},
            "status": "unknown",  # required by FHIR, not captured by the import
            "category": [_status_coding("http://terminology.hl7.org/CodeSystem/observation-category", category)]
            if category in OBS_CATEGORIES else None,
            "code": _concept(o.code, o.code_system, o.name),
            "subject": {"reference": _urn(pid)},
            "encounter": {"reference": _urn(o.encounter_id)} if o.encounter_id else None,
            "effectiveDateTime": _dt(o.effective_at),
            **value,
            "referenceRange": [{"text": o.reference_range}] if o.reference_range else None,
        })

    # --- reviewed AI findings -------------------------------------------------------------------------
    def condition_resource(self, patient_id: str, entity: EntityModel) -> Dict[str, Any]:
        code: Dict[str, Any] = {"text": entity.entity_text}
        if entity.icd10_mapping:
            code["coding"] = [{"system": "http://hl7.org/fhir/sid/icd-10",
                               "code": entity.icd10_mapping.icd10_code,
                               "display": entity.icd10_mapping.code_description}]
        return {
            "resourceType": "Condition",
            "meta": {"tag": [AI_TAG]},
            # clinicalStatus is omitted on purpose: the note extraction does not establish it.
            "verificationStatus": {"coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/condition-ver-status", "code": "unconfirmed"}]},
            "code": code,
            "subject": {"reference": _urn(patient_id)},
        }

    def medication_statement_resource(self, patient_id: str, entity: EntityModel) -> Dict[str, Any]:
        return {
            "resourceType": "MedicationStatement",
            "meta": {"tag": [AI_TAG]},
            "status": "unknown",  # a mention in a note does not tell us if it is active, stopped or completed
            "medicationCodeableConcept": {"text": entity.entity_text},
            "subject": {"reference": _urn(patient_id)},
        }

    # --- bundle ---------------------------------------------------------------------------------------
    def compile_fhir_bundle(self, patient: PatientModel, entities: List[EntityModel], record: Optional[Dict[str, list]] = None) -> Dict[str, Any]:
        """record: {"encounters", "diagnoses", "medications", "allergies", "procedures", "observations"} rows."""
        pid = patient.patient_id
        entries = [{"fullUrl": _urn(pid), "resource": self.patient_resource(patient),
                    "request": {"method": "POST", "url": "Patient"}}]

        def add(uid: str, resource: Dict[str, Any]):
            entries.append({"fullUrl": _urn(uid), "resource": resource,
                            "request": {"method": "POST", "url": resource["resourceType"]}})

        record = record or {}
        encounter_ids = set()
        for e in record.get("encounters", []):
            add(e.encounter_id, self.encounter_resource(pid, e))
            encounter_ids.add(e.encounter_id)
        builders = [("diagnoses", "diagnosis_id", self.record_condition_resource),
                    ("medications", "medication_id", self.record_medication_resource),
                    ("allergies", "allergy_id", self.allergy_resource),
                    ("procedures", "procedure_id", self.procedure_resource),
                    ("observations", "observation_id", self.observation_resource)]
        for key, id_attr, build in builders:
            for row in record.get(key, []):
                resource = build(pid, row)
                # Only reference encounters that are in this bundle, so every reference resolves.
                for ref in ("encounter", "context"):
                    if ref in resource and resource[ref]["reference"].removeprefix("urn:uuid:") not in encounter_ids:
                        del resource[ref]
                add(getattr(row, id_attr), resource)

        for entity in entities:
            if entity.entity_type == "Disease":
                add(entity.entity_id, self.condition_resource(pid, entity))
            elif entity.entity_type == "Medication":
                add(entity.entity_id, self.medication_statement_resource(pid, entity))
        return {"resourceType": "Bundle", "type": "transaction", "entry": entries}


def validate_bundle(bundle: Dict[str, Any]) -> Optional[str]:
    """None when the bundle passes, else the first problem.

    Checks: R4 types and cardinality (fhir.resources R4B models; they do NOT check invariants or terminology),
    plus two invariants they miss: every reference resolves inside the bundle, and Condition con-4
    (an abatement date requires clinicalStatus inactive / remission / resolved).
    """
    full_urls = {e.get("fullUrl") for e in bundle.get("entry", [])}
    for i, e in enumerate(bundle.get("entry", [])):
        r = e.get("resource", {})
        for key, value in r.items():
            if isinstance(value, dict) and "reference" in value and value["reference"] not in full_urls:
                return f"entry.{i}.resource.{key}: reference {value['reference']} does not resolve inside the bundle"
        if r.get("resourceType") == "Condition" and any(k.startswith("abatement") for k in r):
            status = ((r.get("clinicalStatus") or {}).get("coding") or [{}])[0].get("code")
            if status not in ("inactive", "remission", "resolved"):
                return f"entry.{i}.resource: con-4 (abatement present but clinicalStatus is {status or 'missing'})"
    try:
        from fhir.resources.R4B.bundle import Bundle
        Bundle.model_validate(bundle)
        return None
    except Exception as exc:  # pydantic ValidationError, or anything structural
        errors = getattr(exc, "errors", None)
        if callable(errors):
            first = errors()[0]
            return f"{len(errors())} error(s); first at {'.'.join(map(str, first.get('loc', ())))}: {first.get('msg')}"[:300]
        return str(exc).splitlines()[0][:300]


fhir_exporter = FHIRExportService()
