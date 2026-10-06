-- 0003: AI confidence is NULL when the extractor has no calibrated score (rule-based mode).
-- Previously the rule-based pipeline stored random numbers here (review finding R-01).
ALTER TABLE public.entities ALTER COLUMN confidence DROP NOT NULL;
ALTER TABLE public.icd10_mappings ALTER COLUMN confidence DROP NOT NULL;
