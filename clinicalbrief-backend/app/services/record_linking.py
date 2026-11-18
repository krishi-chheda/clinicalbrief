"""v1.0.1 round 2 (B): link a note to the patient's own coded record.

Finds which of this patient's conditions, medications, procedures and allergies the note mentions by name (whole
words, case-insensitive, SNOMED-style tags such as "(disorder)" ignored). It is linking, not extraction: it can only
find what the record already contains, and on Synthea it is circular (the notes are written from the record), so it
is reported as coverage, never as accuracy.
"""
import re
from sqlalchemy.orm import Session

from app.models.models import Allergy, Diagnosis, Medication, Procedure
from app.services.ai_pipeline import split_sentences
from app.services.terminology import TOKEN, TermIndex

_TAG = re.compile(r"\s*\([a-z /]+\)\s*$", re.I)  # "(disorder)", "(regime/therapy)", "(substance)"
# Synthea codes social and administrative circumstances as conditions tagged (finding) / (situation). The labelling
# guideline excludes them, so they are not shown as linked conditions. Disorders are never filtered.
# ponytail: keyword list over Synthea's vocabulary; a SNOMED hierarchy check if other sources are imported.
_NON_CLINICAL = re.compile(
    r"employ|labor force|education|school|income|housing|homeless|living condition|insurance|transport|marri|"
    r"social contact|social isolation|\bstress\b|victim of|intimate partner|violence|criminal|refugee|armed forces|"
    r"medication review|tobacco|smok|alcohol|risk activity", re.I)


def _name(display: str) -> str:
    return _TAG.sub("", display or "").strip()


def _is_social(display: str) -> bool:
    tag = re.search(r"\((finding|situation)\)\s*$", display or "", re.I)
    return bool(tag and _NON_CLINICAL.search(display))


def record_links(db: Session, patient_id: str, text: str) -> list[dict]:
    rows = []
    for d in db.query(Diagnosis).filter(Diagnosis.patient_id == patient_id):
        if _is_social(d.display):
            continue
        rows.append(("condition", _name(d.display), d.code, d.code_system, d.onset_at, d.clinical_status))
    for m in db.query(Medication).filter(Medication.patient_id == patient_id):
        rows.append(("medication", _name(m.medication_name), m.code, m.code_system, m.start_at, m.status))
    for p in db.query(Procedure).filter(Procedure.patient_id == patient_id):
        rows.append(("procedure", _name(p.procedure_name), p.code, p.code_system, p.performed_at, None))
    for a in db.query(Allergy).filter(Allergy.patient_id == patient_id):
        rows.append(("allergy", _name(a.allergen), a.code, a.code_system, a.recorded_at, a.clinical_status))

    latest: dict[tuple, tuple] = {}  # one entry per (kind, name): the most recent record row (undated rows first)
    for row in sorted(rows, key=lambda r: (r[4] is not None, r[4].replace(tzinfo=None) if r[4] else 0)):
        key = (row[0], " ".join(TOKEN.findall(row[1].lower())))
        if key[1]:
            latest[key] = row
    # TermIndex payload: (type, code, source, description) -> (kind, -, row index, -)
    keys = list(latest)
    idx = TermIndex((term, kind, None, str(i), "") for i, (kind, term) in enumerate(keys))

    found: dict[tuple, dict] = {}
    for _, sentence in split_sentences(text):
        for _s, _e, term, kind, _code, i, _desc in idx.find(sentence):
            if (kind, term) in found:
                continue
            k, name, code, system, when, status = latest[keys[int(i)]]
            found[(kind, term)] = {"kind": k, "name": name, "code": code, "code_system": system,
                                   "date": when.isoformat() if when else None, "status": status, "evidence": sentence}
    order = {"condition": 0, "medication": 1, "procedure": 2, "allergy": 3}
    return sorted(found.values(), key=lambda l: (order[l["kind"]], l["name"].lower()))
