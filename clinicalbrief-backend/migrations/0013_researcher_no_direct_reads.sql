-- v1.0.1 P-9: researchers get no rows when they query tables directly.
-- The browser ships the publishable key, so any signed-in user can call PostgREST with their own token. Until now the
-- researcher role could read every patient (names, dates of birth) and every note that way, skipping the API, which
-- removes direct identifiers for researchers, audits reads and rate-limits. The frontend never reads tables directly,
-- so researchers lose nothing. Child tables (documents, notes, record, graph, ...) chain through patients and follow.
-- Other roles are unchanged.
DROP POLICY IF EXISTS patients_role_policy ON public.patients;
CREATE POLICY patients_role_policy ON public.patients FOR SELECT TO authenticated
USING (
    (SELECT CASE
                WHEN u.role = 'demo' THEN patients.is_demo
                WHEN u.role = 'researcher' THEN false
                WHEN u.role IN ('admin', 'consultant', 'coder', 'auditor') THEN true
                ELSE patients.assigned_clinician_id = auth.uid()
            END
     FROM public.users u WHERE u.id = auth.uid())
);
