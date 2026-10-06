-- 0005: RLS helper functions live in a schema the REST API does not expose (Supabase advisor 0029).
-- Policies reference functions by OID, so users_select_self_or_admin keeps working after the move.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;
ALTER FUNCTION public.is_admin() SET SCHEMA private;
