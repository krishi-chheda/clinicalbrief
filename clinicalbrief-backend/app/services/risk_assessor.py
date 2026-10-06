from sqlalchemy.orm import Session
from app.models.models import Patient
from app.services.entities import patient_entities
import datetime

class RiskAssessmentEngine:
    def calculate_patient_risk(self, patient_id: str, db: Session) -> dict:
        patient = db.query(Patient).filter(Patient.patient_id == patient_id).first()
        if not patient:
            return {
                "score": 0.0,
                "risk_level": "Low",
                "risk_factors": [],
                "review_priority": "Low"
            }

        # Calculate age
        # Age is unknown when the source has no birth date; the age factor is then skipped, not guessed.
        age = None
        if patient.date_of_birth:
            today = datetime.date.today()
            dob = patient.date_of_birth
            age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))

        # Only human-reviewed AI entities count; pending ones are reported, never scored.
        entities, pending = patient_entities(db, patient_id)

        score = 20.0  # Base score
        factors = []

        # 1. Age Factor
        if age is None:
            pass
        elif age > 75:
            score += 25
            factors.append(f"Elderly patient (Age {age})")
        elif age > 60:
            score += 15
            factors.append(f"Senior patient (Age {age})")
        elif age < 12:
            score += 10
            factors.append(f"Pediatric patient (Age {age})")

        # 2. Diagnoses Factors
        diseases = [e.entity_text.lower() for e in entities if e.entity_type == "Disease"]
        meds = [e.entity_text.lower() for e in entities if e.entity_type == "Medication"]

        has_stemi = any("myocardial" in d or "stemi" in d or "infarction" in d for d in diseases)
        has_diabetes = any("diabetes" in d for d in diseases)
        has_htn = any("hypertension" in d or "essential" in d for d in diseases)
        has_lipid = any("hyperlipidemia" in d or "lipid" in d for d in diseases)
        has_pneumonia = any("pneumonia" in d for d in diseases)
        has_asthma = any("asthma" in d for d in diseases)

        if has_stemi:
            score += 35
            factors.append("Myocardial infarction mentioned (reviewed)")
        if has_pneumonia:
            score += 20
            factors.append("Pneumonia mentioned (reviewed)")
        if has_diabetes:
            score += 15
            factors.append("Diabetes mentioned (reviewed)")
        if has_htn:
            score += 10
            factors.append("Hypertension mentioned (reviewed)")
        if has_asthma:
            score += 10
            factors.append("Asthma mentioned (reviewed)")

        # 3. Polypharmacy Factor
        if len(meds) > 4:
            score += 15
            factors.append(f"Polypharmacy detected ({len(meds)} active medications)")
        elif len(meds) > 2:
            score += 5
            factors.append(f"Multiple medications prescribed ({len(meds)})")

        # Cap score at 100
        score = min(100.0, score)

        # Categorize
        if score >= 75:
            risk_level = "High"
            review_priority = "Urgent"
        elif score >= 45:
            risk_level = "Medium"
            review_priority = "Medium"
        else:
            risk_level = "Low"
            review_priority = "Low"

        return {
            "score": score,
            "risk_level": risk_level,
            "risk_factors": factors,
            "review_priority": review_priority,
            "method": "heuristic prototype, not clinically validated",
            "reviewed_entities": len(entities),
            "pending_entities": sum(pending.values()),
        }

risk_engine = RiskAssessmentEngine()
