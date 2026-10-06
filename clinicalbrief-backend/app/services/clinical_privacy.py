import re
from typing import Dict, List, Any, Tuple

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
        
        # Specific names list to strip (could be dynamic)
        self.known_names = ["John Smith", "Clara Jones", "Smith John", "Jones Clara"]

    def redact_text(self, text: str) -> Tuple[str, List[Dict[str, Any]]]:
        redacted_text = text
        redacted_entities = []

        # 1. Names
        for name in self.known_names:
            matches = re.finditer(re.escape(name), redacted_text, re.IGNORECASE)
            for m in list(matches):
                original = m.group()
                redacted_text = redacted_text.replace(original, "[PATIENT_NAME]")
                redacted_entities.append({
                    "entity_type": "Patient Name",
                    "original_text": original,
                    "redacted_text": "[PATIENT_NAME]"
                })

        # 2. DOBs
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
