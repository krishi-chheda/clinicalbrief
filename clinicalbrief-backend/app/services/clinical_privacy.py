import re
from typing import Dict, List, Any, Tuple, Iterable

class ClinicalPrivacyEngine:
    def __init__(self):
        # Compile standard patterns
        self.dob_pattern = re.compile(r'\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[012])[-/.](19|20)?\d\d\b')
        self.date_pattern = re.compile(r'\b(19|20)\d\d-(0?[1-9]|1[012])-(0?[1-9]|[12]\d|3[01])\b')
        # US-style 3-3-4 numbers, plus Australian numbers: 04xx xxx xxx, (0x) xxxx xxxx, +61 4xx xxx xxx.
        self.phone_pattern = re.compile(
            r'\b(\+\d{1,2}\s)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b'
            r'|(?:\+61[\s-]?\(?0?\)?|\(?0)[2-478]\)?(?:[\s-]?\d){8}\b')
        self.email_pattern = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b')
        self.mrn_pattern = re.compile(r'\bMRN-?\d{6,8}\b', re.IGNORECASE)
        self.insurance_pattern = re.compile(r'\bINS-?\d{8,10}\b', re.IGNORECASE)

    def redact_text(self, text: str) -> Tuple[str, List[Dict[str, Any]]]:
        redacted_text = text
        redacted_entities = []

        # 1. DOBs (patient names: see redact_names below, which knows the patient)
        matches = self.dob_pattern.finditer(redacted_text)
        for m in list(matches):
            original = m.group()
            if "[DATE_OF_BIRTH]" not in original:
                redacted_text = redacted_text.replace(original, "[DATE_OF_BIRTH]")
                redacted_entities.append({
                    "entity_type": "Date of Birth",
                    "original_text": original,
                    "redacted_text": "[DATE_OF_BIRTH]"
                })

        # 3. Standard dates in notes (e.g. ADMISSION DATE: 2026-06-01)
        matches = self.date_pattern.finditer(redacted_text)
        for m in list(matches):
            original = m.group()
            if "DOB:" not in text[max(0, text.find(original)-10) : text.find(original)]:
                redacted_text = redacted_text.replace(original, "[DATE_RECORDED]")
                redacted_entities.append({
                    "entity_type": "Clinical Date",
                    "original_text": original,
                    "redacted_text": "[DATE_RECORDED]"
                })

        # 4. Phones
        matches = self.phone_pattern.finditer(redacted_text)
        for m in list(matches):
            original = m.group()
            redacted_text = redacted_text.replace(original, "[PHONE_NUMBER]")
            redacted_entities.append({
                "entity_type": "Phone Number",
                "original_text": original,
                "redacted_text": "[PHONE_NUMBER]"
            })

        # 5. Emails
        matches = self.email_pattern.finditer(redacted_text)
        for m in list(matches):
            original = m.group()
            redacted_text = redacted_text.replace(original, "[EMAIL_ADDRESS]")
            redacted_entities.append({
                "entity_type": "Email Address",
                "original_text": original,
                "redacted_text": "[EMAIL_ADDRESS]"
            })

        # 6. MRN
        matches = self.mrn_pattern.finditer(redacted_text)
        for m in list(matches):
            original = m.group()
            redacted_text = redacted_text.replace(original, "[MEDICAL_RECORD_NUMBER]")
            redacted_entities.append({
                "entity_type": "MRN",
                "original_text": original,
                "redacted_text": "[MEDICAL_RECORD_NUMBER]"
            })

        # 7. Insurance ID
        matches = self.insurance_pattern.finditer(redacted_text)
        for m in list(matches):
            original = m.group()
            redacted_text = redacted_text.replace(original, "[INSURANCE_ID]")
            redacted_entities.append({
                "entity_type": "Insurance ID",
                "original_text": original,
                "redacted_text": "[INSURANCE_ID]"
            })

        return redacted_text, redacted_entities

privacy_engine = ClinicalPrivacyEngine()


# --- v1.0.1 Part D: the researcher view ----------------------------------------------------------------------------
# Direct identifiers removed: names, date of birth (year kept), date of death. Not a validated de-identification:
# clinical dates in the structured record are kept, and free text is only cleaned of this patient's own name and
# birth date plus the regex patterns above.

def pseudonym(patient_id: str) -> str:
    """Stable label for a patient. Researchers already see the random patient id (it is in every URL), so the
    pseudonym is derived from it rather than from a secret."""
    return f"Patient {patient_id[:8].upper()}"


def deidentify_patient(data: dict) -> dict:
    dob = data.get("date_of_birth")
    return {**data, "first_name": "Patient", "last_name": data["patient_id"][:8].upper(),
            "date_of_birth": None, "birth_year": dob.year if dob else None, "deceased_date": None, "deidentified": True}


def identifiers(patient) -> List[str]:
    """The strings that identify this patient in free text: names and the birth date in common formats."""
    out = [patient.first_name, patient.last_name]
    if patient.date_of_birth:
        d = patient.date_of_birth
        out += [d.isoformat(), d.strftime("%d/%m/%Y"), d.strftime("%m/%d/%Y")]
    return out


def redact_names(text: str, names: Iterable[str]) -> str:
    """Replaces each name as a whole word, case-insensitively and literally (never as a regex)."""
    for name in {n.strip() for n in names if n and len(n.strip()) >= 2}:
        text = re.sub(r"(?<!\w)" + re.escape(name) + r"(?!\w)", "[NAME]", text, flags=re.IGNORECASE)
    return text


def scrub(obj: Any, names: Iterable[str]) -> Any:
    """`redact_names` over every string inside a JSON-like value (dicts, lists, strings)."""
    names = list(names)
    if isinstance(obj, str):
        return redact_names(obj, names)
    if isinstance(obj, dict):
        return {k: scrub(v, names) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [scrub(v, names) for v in obj]
    return obj
