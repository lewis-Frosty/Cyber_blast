-- Phase 2 Step 1 follow-up. The Supabase security advisor flagged both trigger
-- functions as callable directly via /rest/v1/rpc by anon and authenticated.
-- They are SECURITY DEFINER, so a caller would run them as the owner. Triggers
-- do not need EXECUTE granted to API roles — the trigger fires as the table
-- owner regardless — so revoking it costs nothing and closes the RPC surface.
--
-- Security advisor returns zero lints after this.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.guard_profile_columns() from public, anon, authenticated;
