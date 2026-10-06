-- 0008: Indexes for the lookups the API makes on every patient / note view (Supabase performance
-- advisor "unindexed_foreign_keys"). Without them each "notes for this patient" query scans every row.
CREATE INDEX IF NOT EXISTS ix_documents_patient_id ON public.documents(patient_id);
CREATE INDEX IF NOT EXISTS ix_documents_encounter_id ON public.documents(encounter_id);
CREATE INDEX IF NOT EXISTS ix_clinical_notes_patient_id ON public.clinical_notes(patient_id);
CREATE INDEX IF NOT EXISTS ix_entities_document_id ON public.entities(document_id);
CREATE INDEX IF NOT EXISTS ix_processing_jobs_document_id ON public.processing_jobs(document_id);
CREATE INDEX IF NOT EXISTS ix_copilot_sessions_patient_id ON public.copilot_sessions(patient_id);
CREATE INDEX IF NOT EXISTS ix_copilot_sessions_user_id ON public.copilot_sessions(user_id);
CREATE INDEX IF NOT EXISTS ix_risk_scores_patient_id ON public.risk_scores(patient_id);
CREATE INDEX IF NOT EXISTS ix_review_history_entity_id ON public.review_history(entity_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_timestamp ON public.audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS ix_patients_assigned_clinician_id ON public.patients(assigned_clinician_id);
CREATE INDEX IF NOT EXISTS ix_document_comparisons_patient_id ON public.document_comparisons(patient_id);
CREATE INDEX IF NOT EXISTS ix_embeddings_document_id ON public.embeddings(document_id);
CREATE INDEX IF NOT EXISTS ix_diagnoses_encounter_id ON public.diagnoses(encounter_id);
CREATE INDEX IF NOT EXISTS ix_medications_encounter_id ON public.medications(encounter_id);
CREATE INDEX IF NOT EXISTS ix_procedures_encounter_id ON public.procedures(encounter_id);
CREATE INDEX IF NOT EXISTS ix_observations_encounter_id ON public.observations(encounter_id);
