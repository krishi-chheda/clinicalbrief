-- 0011: Store each note's search vector once (Phase 8a). Measured on the live data with 0010's expression index:
-- a common query matched 15,021 notes; ranking them took 3.8 s and date-ordering 0.9 s, because ts_rank
-- re-tokenised every matching note and the planner expected ~350 matches. A stored, database-generated vector
-- is tokenised once on write and gives the planner real statistics.
-- The column is database-maintained and not part of the ORM model (tests/test_security.py lists it as DB-only).
ALTER TABLE public.clinical_notes
    ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', original_text)) STORED;
CREATE INDEX IF NOT EXISTS ix_clinical_notes_search_vector ON public.clinical_notes USING gin (search_vector);
DROP INDEX IF EXISTS public.ix_clinical_notes_fts;  -- replaced by the index on the stored vector
ANALYZE public.clinical_notes;
