-- ─── Stash — payment-request audit log for Shipped Not Invoiced ─────────────
-- Tracks which shipped-but-not-invoiced jobs have had their payment request
-- sent, when, and by whom. Ticked from the Shipped Not Invoiced page; used
-- there to auto-archive rows once the request is out the door.
--
-- One row per job_number (primary key). Unticking a row deletes it so the
-- table only ever holds "currently marked as sent" jobs — easy to reason
-- about and trivially small.

create table if not exists public.stash_payment_requests_sent (
    job_number    text primary key,
    sent_at       timestamptz not null default now(),
    sent_by       text,
    note          text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- Read path is "load everything on page mount" (there will only ever be a
-- handful of hundred rows at most) so no special indexes needed beyond the
-- primary key.

alter table public.stash_payment_requests_sent enable row level security;

-- Read: anyone authenticated (or anon, since this app's anon key is intended
-- as a public read-only credential) can load the current state. Matches the
-- pattern used by stash_finance_cache / stash_slack_messages.
drop policy if exists "stash_payment_requests_sent anon read" on public.stash_payment_requests_sent;
create policy "stash_payment_requests_sent anon read"
    on public.stash_payment_requests_sent
    for select
    to anon
    using (true);

-- Write: users tick the checkbox directly from the browser, so the anon role
-- must be allowed to insert/update/delete. The app UI is already gated by
-- Firebase auth, so "anon" here is only reachable by an authenticated Stash
-- user via the public anon key.
drop policy if exists "stash_payment_requests_sent anon write" on public.stash_payment_requests_sent;
create policy "stash_payment_requests_sent anon write"
    on public.stash_payment_requests_sent
    for all
    to anon
    using (true)
    with check (true);
