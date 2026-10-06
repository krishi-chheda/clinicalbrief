"""Clinical note pipeline: classification, entity extraction, summary, ICD-10 suggestions.

Two modes:
- Rule-based prototype (USE_MOCK_MODELS=true, default): dictionary matching with word boundaries and
  NegEx-style negation. It has no calibrated confidence, so confidence is None rather than invented.
- Transformer mode: HuggingFace NER + BART summary, with the same negation filter applied.

Nothing here may invent clinical content: summaries are sentences taken from the note, and a term
with no dictionary code stays unmapped.
"""
import logging
import re
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger("clinicalbrief.ai_pipeline")

# --- Negation (NegEx-style: trigger words within a short window, bounded by scope terminators) ----
_PRE_NEGATION = re.compile(
    r"\b(no|not|denies|denied|denying|without|negative for|free of|absence of|no evidence of|"
    r"no history of|no signs? of|never had|rules? out|ruled out)\b", re.IGNORECASE)
_POST_NEGATION = re.compile(r"^\W*(\w+\W+){0,3}?(was|is|were|are|has been|have been)?\s*"
                            r"(ruled out|excluded|absent|not present|unlikely)\b", re.IGNORECASE)
_SCOPE_END = re.compile(r"\b(but|however|although|though|except|apart from|aside from|yet)\b|[;:]", re.IGNORECASE)
# Affirmation ends a preceding negation's scope (N-04: "Negative for asthma, positive for hypertension").
# Only used looking backwards: "fever has been ruled out" must still read as negated.
_AFFIRMATION = re.compile(r"\b(positive for|reports?|reported|complains? of|presents? with|presenting with|"
                          r"has|have|had|with|admits? to|endorses?|diagnosed with)\b", re.IGNORECASE)
# Experiencer (ConText-style, N-05): a relative's condition is not the patient's.
_FAMILY = re.compile(r"\b(family history of|family hx of|fhx|fh of|mother|father|mum|mom|dad|parents?|sister|brother|"
                     r"siblings?|grandmother|grandfather|grandparents?|aunt|uncle|cousin|son|daughter)('s)?\b", re.IGNORECASE)
_RELATIVES = (r"mother|father|mum|mom|dad|parents?|sister|brother|siblings?|grandmother|grandfather|"
              r"grandparents?|aunt|uncle|cousin|son|daughter|wife|husband|partner")
_PATIENT_SUBJECT = re.compile(r"\b(patient|pt|he|she)\b", re.IGNORECASE)  # "..., patient with asthma"
_SOCIAL_CONTEXT = re.compile(  # "lives with his mother", "accompanied by her daughter": not family history
    r"\b(lives?|living|lived|staying|stays|accompanied|brought in|cared for|supported|visited)\b[^.;]{0,20}?"
    r"\b(with|by)\s+(his|her|their|the)?\s*(" + _RELATIVES + r")\b", re.IGNORECASE)
_PRE_WINDOW_WORDS = 6
_ALLERGY_CONTEXT = re.compile(r"\b(allergic to|allergy to|allergies to|intolerant of|intolerance to)\s*$", re.IGNORECASE)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")


def split_sentences(text: str) -> List[tuple[int, str]]:
    """(start offset, sentence) pairs, skipping blank lines and markdown headings."""
    out, pos = [], 0
    for part in _SENTENCE_SPLIT.split(text):
        start = text.find(part, pos)
        pos = start + len(part)
        s = part.strip()
        if s and not s.startswith("#"):
            out.append((start + (len(part) - len(part.lstrip())), s))
    return out


def _scope_before(sentence: str, start: int, breaks=(_SCOPE_END,)) -> str:
    """The last few words before a mention, cut at the nearest scope break."""
    before = sentence[:start]
    cut = max((m.end() for b in breaks for m in b.finditer(before)), default=0)
    return " ".join(before[cut:].split()[-_PRE_WINDOW_WORDS:])


def is_negated(sentence: str, start: int, end: int) -> bool:
    """True if the mention at sentence[start:end] is negated within its scope."""
    if _PRE_NEGATION.search(_scope_before(sentence, start, (_SCOPE_END, _AFFIRMATION))):
        return True
    after = sentence[end:]
    stop = _SCOPE_END.search(after)
    return bool(_POST_NEGATION.search(after[:stop.start()] if stop else after))


def is_family_history(sentence: str, start: int) -> bool:
    """True if the mention is about a relative ("Mother had atrial fibrillation", "Family history of diabetes").

    The scope ends at a patient subject ("Father with hypertension, patient with asthma"), and social context
    ("lives with his mother") is removed first, so the patient's own findings are kept (N-07)."""
    before = _SOCIAL_CONTEXT.sub(" ", sentence[:start])
    return bool(_FAMILY.search(_scope_before(before, len(before), (_SCOPE_END, _PATIENT_SUBJECT))))


class AIPipelineOrchestrator:
    def __init__(self):
        self.use_mock = settings.USE_MOCK_MODELS
        self.ner_pipeline = None
        self.summary_pipeline = None

        # Small exact-match ICD-10 dictionary. Anything not in it stays unmapped (no default code).
        self.icd10_dictionary = {
            "myocardial infarction": ("I21.9", "Acute myocardial infarction, unspecified"),
            "acute myocardial infarction": ("I21.9", "Acute myocardial infarction, unspecified"),
            "diabetes": ("E11.9", "Type 2 diabetes mellitus without complications"),
            "diabetes mellitus": ("E11.9", "Type 2 diabetes mellitus without complications"),
            "type 2 diabetes": ("E11.9", "Type 2 diabetes mellitus without complications"),
            "hypertension": ("I10", "Essential (primary) hypertension"),
            "hyperlipidemia": ("E78.5", "Hyperlipidemia, unspecified"),
            "acute kidney injury": ("N17.9", "Acute kidney failure, unspecified"),
            "aki": ("N17.9", "Acute kidney failure, unspecified"),
            "pneumonia": ("J18.9", "Pneumonia, unspecified organism"),
            "coronary artery disease": ("I25.10", "Atherosclerotic heart disease of native coronary artery without angina pectoris"),
            "cad": ("I25.10", "Atherosclerotic heart disease of native coronary artery without angina pectoris"),
            "asthma": ("J45.909", "Unspecified asthma, uncomplicated"),
            "chronic kidney disease": ("N18.9", "Chronic kidney disease, unspecified"),
            "ckd": ("N18.9", "Chronic kidney disease, unspecified"),
            "atrial fibrillation": ("I48.91", "Unspecified atrial fibrillation"),
            "afib": ("I48.91", "Unspecified atrial fibrillation"),
        }

        # Vocabulary for the rule-based extractor.
        self.clinical_vocab = {
            "Disease": [
                "myocardial infarction", "acute myocardial infarction", "diabetes",
                "diabetes mellitus", "type 2 diabetes", "hypertension", "hyperlipidemia",
                "acute kidney injury", "aki", "pneumonia", "coronary artery disease",
                "cad", "asthma", "chronic kidney disease", "ckd", "atrial fibrillation", "afib"
            ],
            "Medication": [
                "Aspirin", "Atorvastatin", "Metformin", "Lisinopril", "Albuterol",
                "Penicillin", "Metoprolol", "Warfarin", "Furosemide", "Gabapentin",
                "Insulin", "Plavix", "Amoxicillin", "Lipitor"
            ],
            "Symptom": [
                "chest pain", "dyspnea", "fever", "cough", "headache", "abdominal pain",
                "nausea", "fatigue", "dizziness", "shortness of breath", "edema"
            ],
            "Procedure": [
                "coronary angioplasty", "echocardiogram", "chest x-ray",
                "electrocardiogram", "ecg", "intubation", "appendectomy",
                "dialysis", "cardiopulmonary resuscitation", "cpr", "mri"
            ],
            "Allergy": [
                "Penicillin allergy", "sulfa drugs", "peanuts", "latex", "shellfish", "contrast dye"
            ]
        }
        # Longest terms first so "acute myocardial infarction" wins over "myocardial infarction".
        self._patterns = sorted(
            ((etype, term, re.compile(rf"(?<![\w-]){re.escape(term)}(?![\w-])", re.IGNORECASE))
             for etype, terms in self.clinical_vocab.items() for term in terms),
            key=lambda x: -len(x[1]))

        if not self.use_mock:
            try:
                from transformers import pipeline
                logger.info("Initializing Hugging Face models...")
                self.ner_pipeline = pipeline("token-classification", model=settings.NER_MODEL, aggregation_strategy="simple")
                self.summary_pipeline = pipeline("summarization", model=settings.SUMMARIZATION_MODEL)
                logger.info("Hugging Face models initialized successfully.")
            except Exception as e:
                logger.warning(f"Failed to load local models ({e}). Falling back to the rule-based pipeline.")
                self.use_mock = True

    def classify_document(self, text: str) -> str:
        """Rule-based note type in both modes (no validated clinical note-type classifier is available)."""
        text_lower = text.lower()
        if "discharge summary" in text_lower or "discharged on" in text_lower:
            return "Discharge Summary"
        if "emergency room" in text_lower or "er visit" in text_lower or "emergency department" in text_lower:
            return "Emergency"
        if "referral letter" in text_lower or "referred by" in text_lower:
            return "Referral"
        if "follow-up" in text_lower or "clinic visit" in text_lower:
            return "Follow-up"
        return "Routine Assessment"

    def extract_entities(self, text: str) -> List[Dict[str, Any]]:
        """Affirmed clinical entities, each with its source sentence as evidence."""
        return self._extract_rule_based(text) if self.use_mock else self._extract_transformer(text)

    def _extract_rule_based(self, text: str) -> List[Dict[str, Any]]:
        found: Dict[tuple, Dict[str, Any]] = {}
        for _, sentence in split_sentences(text):
            taken: List[tuple[int, int]] = []  # spans already claimed by a longer term
            for etype, term, pattern in self._patterns:
                for m in pattern.finditer(sentence):
                    if any(m.start() < e and s < m.end() for s, e in taken):
                        continue
                    taken.append((m.start(), m.end()))
                    if is_negated(sentence, m.start(), m.end()) or is_family_history(sentence, m.start()):
                        continue
                    entity_type = etype
                    if etype == "Medication" and _ALLERGY_CONTEXT.search(sentence[:m.start()]):
                        entity_type = "Allergy"  # "allergic to penicillin" is an allergy, not a prescription
                    key = (m.group(0).lower(), entity_type)
                    found.setdefault(key, {
                        "entity_text": m.group(0),
                        "entity_type": entity_type,
                        "confidence": None,  # dictionary matching has no calibrated score
                        "evidence": sentence,
                        "reasoning": f"Rule-based: whole-word dictionary match for '{term}', not negated or about a relative in its sentence.",
                        "review_status": "pending",
                    })
        return list(found.values())

    _NER_TYPES = {"Disease_disorder": "Disease", "Sign_symptom": "Symptom", "Medication": "Medication",
                  "Diagnostic_procedure": "Procedure", "Therapeutic_procedure": "Procedure"}

    def _extract_transformer(self, text: str) -> List[Dict[str, Any]]:
        try:
            results = self.ner_pipeline(text)
        except Exception as e:
            logger.error(f"Error in HF NER pipeline: {e}")
            raise
        sentences = split_sentences(text)
        found: Dict[tuple, Dict[str, Any]] = {}
        for ent in results:
            entity_type = self._NER_TYPES.get(ent.get("entity_group", ""))
            if not entity_type:
                continue  # unknown tags are skipped, never guessed
            start = ent.get("start", 0)
            s_start, sentence = next(((o, s) for o, s in reversed(sentences) if o <= start), (0, text))
            if is_negated(sentence, start - s_start, ent.get("end", start) - s_start) or is_family_history(sentence, start - s_start):
                continue
            key = (ent.get("word", "").lower(), entity_type)
            found.setdefault(key, {
                "entity_text": ent.get("word", ""), "entity_type": entity_type,
                "confidence": float(ent["score"]) if "score" in ent else None,
                "evidence": sentence, "reasoning": f"{settings.NER_MODEL} tag {ent.get('entity_group')}, not negated.",
                "review_status": "pending",
            })
        return list(found.values())

    def generate_summary(self, text: str) -> str:
        if self.use_mock:
            return self._extractive_summary(text)
        try:
            res = self.summary_pipeline(text[:1024], max_length=150, min_length=40, do_sample=False)
            return res[0]["summary_text"]
        except Exception as e:
            logger.error(f"Error in summarization pipeline: {e}")
            raise

    def _extractive_summary(self, text: str, max_sentences: int = 3) -> str:
        """Up to three sentences copied verbatim from the note: those with affirmed findings first."""
        sentences = [s for _, s in split_sentences(text)]
        entity_sentences = {e["evidence"] for e in self._extract_rule_based(text)}
        chosen = [s for s in sentences if s in entity_sentences][:max_sentences] or sentences[:2]
        return "\n".join(chosen)

    def resolve_icd10(self, entity_text: str, entity_type: str) -> Optional[Dict[str, Any]]:
        """Exact dictionary lookup only. Returns None when there is no match (no default code)."""
        if entity_type != "Disease":
            return None
        hit = self.icd10_dictionary.get(entity_text.lower().strip())
        if not hit:
            return None
        return {"icd10_code": hit[0], "code_description": hit[1], "confidence": None}


ai_orchestrator = AIPipelineOrchestrator()
