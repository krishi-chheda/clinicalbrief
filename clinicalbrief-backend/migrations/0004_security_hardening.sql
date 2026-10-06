-- 0004: Security hardening (Supabase security advisor + review finding R-08).

-- The signup trigger function must not be callable through the REST API (/rest/v1/rpc/handle_new_user).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Keep extensions out of the API-exposed public schema.
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION vector SET SCHEMA extensions;

-- R-08: signed-in users may read their own profile only; admins may read all profiles.
-- (Previously any account could list every user's email and role.)
DROP POLICY IF EXISTS users_select_all ON public.users;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin') $$;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
CREATE POLICY users_select_self_or_admin ON public.users FOR SELECT TO authenticated
USING (id = auth.uid() OR public.is_admin());
