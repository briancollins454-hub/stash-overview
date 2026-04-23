-- ─── Stash — "authorised £0 invoice" audit log for Unpaid Orders ────────────
-- Tracks orders that a senior user has explicitly confirmed are OK to remain
-- at a £0 invoice / no-payment state (e.g. samples / promo / write-offs that
-- slipped past the keyword-based exclusions in the Unpaid Orders page).
-- Once authorised, the row moves from the "Zero priced" bucket into a
-- dedicated "Authorised £0 invoice" section so the work queue stays clean.
--
-- One row per job_number. Unticking a row deletes it so the table only ever
-- holds currently-authorised jobs.

create table if not exists public.stash_zero_invoice_authorised (
    job_number      text primary key,
    authorised_at   timestamptz not null default now(),
    authorised_by   text,
    reason          text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

alter table public.stash_zero_invoice_authorised enable row level security;

-- Read
drop policy if exists "stash_zero_invoice_authorised anon read" on public.stash_zero_invoice_authorised;
create policy "stash_zero_invoice_authorised anon read"
    on public.stash_zero_invoice_authorised
    for select
    to anon
    using (true);

-- Write (insert / update / delete from the browser, gated by app-level auth)
drop policy if exists "stash_zero_invoice_authorised anon write" on public.stash_zero_invoice_authorised;
create policy "stash_zero_invoice_authorised anon write"
    on public.stash_zero_invoice_authorised
    for all
    to anon
    using (true)
    with check (true);
