"""Review R-01 (Phase 2): the rule-based pipeline must not invent diagnoses, confidences or plans."""
from app.services.ai_pipeline import ai_orchestrator

REVIEW_NOTE = ("Patient is taking lisinopril. No history of diabetes. Denies chest pain. "
               "Seen in the last decade for a cascade of falls.")


def extracted(text):
    return {(e["entity_text"].lower(), e["entity_type"]) for e in ai_orchestrator.extract_entities(text)}


def test_review_repro_note():
    ents = extracted(REVIEW_NOTE)
    assert ("lisinopril", "Medication") in ents
    for bad in ["aki", "cad", "diabetes", "chest pain"]:  # substring hits and negated mentions
        assert not any(text == bad for text, _ in ents), bad


def test_no_invented_confidence_and_evidence_is_the_source_sentence():
    for e in ai_orchestrator.extract_entities("Patient has hypertension. Started metformin 500 mg daily."):
        assert e["confidence"] is None  # dictionary matching has no calibrated score
        assert e["entity_text"].lower() in e["evidence"].lower()


def test_negation_scope():
    ents = extracted("No fever but reports cough. Pneumonia was ruled out. Denies dyspnea; has asthma.")
    assert ("cough", "Symptom") in ents and ("asthma", "Disease") in ents
    assert not {("fever", "Symptom"), ("pneumonia", "Disease"), ("dyspnea", "Symptom")} & ents


def test_affirmed_mention_elsewhere_wins():
    assert ("diabetes", "Disease") in extracted("No history of asthma. Known diabetes, on insulin.")
    assert ("diabetes", "Disease") in extracted("Denies chest pain. Diabetes is well controlled.")


def test_allergy_is_not_a_medication():
    ents = extracted("Allergic to penicillin (hives). Started amoxicillin.")
    assert ("penicillin", "Allergy") in ents and ("penicillin", "Medication") not in ents
    assert ("amoxicillin", "Medication") in ents


def test_summary_uses_only_note_text():
    note = "Patient has hypertension. Blood pressure 150/95. Started lisinopril 10 mg daily. Follow up in 2 weeks."
    summary = ai_orchestrator.generate_summary(note)
    sentences = {s.strip() for s in note.replace(". ", ".\n").splitlines()}
    assert summary and all(part.strip() in sentences for part in summary.split("\n"))
    assert "Recommended plan" not in summary and "Initial evaluations" not in summary


def test_icd_mapping_has_no_default_code():
    assert ai_orchestrator.resolve_icd10("hypertension", "Disease")["icd10_code"] == "I10"
    assert ai_orchestrator.resolve_icd10("hypertension", "Disease")["confidence"] is None
    assert ai_orchestrator.resolve_icd10("zebrafish syndrome", "Disease") is None  # unmapped, not R69


def test_negation_covers_comma_lists():
    ents = extracted("Denies chest pain, fever or nausea. Reports headache.")
    assert not {("chest pain", "Symptom"), ("fever", "Symptom"), ("nausea", "Symptom")} & ents
    assert ("headache", "Symptom") in ents


def test_retrieval_filters_before_ranking():
    """Review R-05: with 50+ other documents indexed, the target document's answer must be found."""
    import uuid
    from app.services.faiss_manager import vector_search_manager
    from app.services.qa_engine import qa_engine
    target, target_patient = str(uuid.uuid4()), str(uuid.uuid4())
    vector_search_manager.add_document(target, target_patient, "Warfarin 5 mg was started for atrial fibrillation.")
    for i in range(60):  # distractors that match the question better than the target does
        vector_search_manager.add_document(str(uuid.uuid4()), str(uuid.uuid4()),
                                           f"Which medication was started? The medication started was aspirin {i}.")
    answer = qa_engine.answer_question(target, "Which medication was started?")
    assert "Warfarin" in answer["answer"]

    hits = vector_search_manager.similarity_search("medication started", patient_ids={target_patient}, k=5)
    assert hits and {h["patient_id"] for h in hits} == {target_patient}


def test_rule_based_qa_reports_no_invented_confidence():
    import uuid
    from app.services.faiss_manager import vector_search_manager
    from app.services.qa_engine import qa_engine
    doc = str(uuid.uuid4())
    vector_search_manager.add_document(doc, str(uuid.uuid4()), "Metformin 500 mg was prescribed for diabetes.")
    assert qa_engine.answer_question(doc, "Which medication was prescribed?")["confidence"] is None
