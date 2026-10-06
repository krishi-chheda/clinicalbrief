-- 0010: Persistent full-text search (Phase 8a) over every note and the structured record.
-- Expression indexes, not stored columns: the schema (and the ORM) stays unchanged, and queries that use the
-- same expression - to_tsvector('english', <column>) - are served by these GIN indexes.
CREATE INDEX IF NOT EXISTS ix_clinical_notes_fts ON public.clinical_notes USING gin (to_tsvector('english', original_text));
CREATE INDEX IF NOT EXISTS ix_diagnoses_fts ON public.diagnoses USING gin (to_tsvector('english', display));
CREATE INDEX IF NOT EXISTS ix_medications_fts ON public.medications USING gin (to_tsvector('english', medication_name));
CREATE INDEX IF NOT EXISTS ix_procedures_fts ON public.procedures USING gin (to_tsvector('english', procedure_name));
CREATE INDEX IF NOT EXISTS ix_observations_fts ON public.observations USING gin (to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS ix_allergies_fts ON public.allergies USING gin (to_tsvector('english', allergen));
