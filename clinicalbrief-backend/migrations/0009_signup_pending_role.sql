-- 0009: Self-signups get NO access until an admin assigns a role (review R-08).
-- Previously every new Supabase Auth account became 'clinician' (a clinical write role).
-- 'pending' is outside the API's ROLES set, so get_current_user answers 403 for it on every endpoint.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
    CHECK (role IN ('pending', 'admin', 'clinician', 'consultant', 'coder', 'auditor', 'researcher'));
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'pending';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, role, created_at)
    VALUES (NEW.id, NEW.email, 'pending', COALESCE(NEW.created_at, NOW()))
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
