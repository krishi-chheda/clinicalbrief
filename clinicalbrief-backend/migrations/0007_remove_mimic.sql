-- 0007: MIMIC-IV removed from ClinicalBrief (no names or birth dates; not a fit for the product).
-- Drops the MIMIC-only columns briefly added by an earlier 0006. Data was deleted separately
-- (patients where source_system = 'mimic-iv-demo', cascading to their records, and their import runs).
ALTER TABLE public.patients DROP COLUMN IF EXISTS anchor_age;
ALTER TABLE public.patients DROP COLUMN IF EXISTS anchor_year;
ALTER TABLE public.patients DROP COLUMN IF EXISTS anchor_year_group;
