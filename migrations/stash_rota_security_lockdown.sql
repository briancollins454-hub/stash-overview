-- ─── Stash — Rota security lockdown ───────────────────────────────────────
-- Makes rota tables read-only for anon clients. All writes now go through
-- `/api/rota-data`, which enforces senior-management access server-side and
-- uses the service key to execute permitted mutations.
--
-- Run AFTER stash_rota.sql and stash_rota_v2.sql.

-- v1 tables
drop policy if exists "stash_rota_employees anon write" on public.stash_rota_employees;
drop policy if exists "stash_rota_shifts anon write" on public.stash_rota_shifts;
drop policy if exists "stash_rota_time_off anon write" on public.stash_rota_time_off;
drop policy if exists "stash_rota_closures anon write" on public.stash_rota_closures;
drop policy if exists "stash_rota_swap_requests anon write" on public.stash_rota_swap_requests;

-- v2 tables
drop policy if exists "stash_rota_shift_acks anon write" on public.stash_rota_shift_acks;
drop policy if exists "stash_rota_blocked_dates anon write" on public.stash_rota_blocked_dates;
drop policy if exists "stash_rota_toil anon write" on public.stash_rota_toil;
drop policy if exists "stash_rota_audit anon write" on public.stash_rota_audit;

-- Keep read-only policies in place.
