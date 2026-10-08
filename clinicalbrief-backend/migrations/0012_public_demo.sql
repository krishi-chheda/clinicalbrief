-- 0012: Public "Try the demo" sandbox.
-- Visitors sign in anonymously (Supabase anonymous sign-ins) and get the read-only role 'demo', which sees only the
-- patients flagged is_demo (10 synthetic Synthea patients, flagged with `py -3.12 -m app.cli flag-demo`).
-- The API enforces the same scope (app/api/v1/deps.py); this migration mirrors it for direct table access.

-- 1. Demo flag on patients (default false: nothing is public until the CLI flags it).
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ix_patients_is_demo ON public.patients(patient_id) WHERE is_demo;

-- 2. The 'demo' role.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
    CHECK (role IN ('pending', 'demo', 'admin', 'clinician', 'consultant', 'coder', 'auditor', 'researcher'));

-- 3. Anonymous sign-ins become 'demo'; every other sign-up stays 'pending' (no access) until an admin sets a role.
--    Anonymous users have no email, but users.email is NOT NULL UNIQUE: they get a placeholder on the reserved
--    .invalid domain (RFC 2606), which can never be a real address.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, role, created_at)
    VALUES (NEW.id,
            COALESCE(NEW.email, 'anonymous-' || NEW.id::text || '@demo.invalid'),
            CASE WHEN COALESCE(NEW.is_anonymous, false) THEN 'demo' ELSE 'pending' END,
            COALESCE(NEW.created_at, NOW()))
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 4. RLS: 'demo' sees only is_demo patients, even if one were ever assigned to it. Child tables (documents, notes,
--    record, graph, ...) already chain through patients, so they follow automatically. No profile row -> NULL -> no rows.
DROP POLICY IF EXISTS patients_role_policy ON public.patients;
CREATE POLICY patients_role_policy ON public.patients FOR SELECT TO authenticated
USING (
    (SELECT CASE
                WHEN u.role = 'demo' THEN patients.is_demo
                WHEN u.role IN ('admin', 'consultant', 'coder', 'auditor', 'researcher') THEN true
                ELSE patients.assigned_clinician_id = auth.uid()
            END
     FROM public.users u WHERE u.id = auth.uid())
);
