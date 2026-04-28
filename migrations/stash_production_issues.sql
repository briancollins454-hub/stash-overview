-- ─── Stash — Production Issue Log ──────────────────────────────────────────
-- Lightweight queue used by the production team to flag missing/incorrect
-- product info, missing decoration areas, wrong decoration sizes, price
-- mismatches, etc. Someone reviews the list weekly and ticks rows off
-- as they're actioned in the back end.
--
-- Kept deliberately simple — one row per request, free-text description,
-- optional screenshot stored as a data URI (base64). We compress images
-- client-side before insert so rows stay well under PostgREST's row
-- size limits.

create table if not exists public.stash_production_issues (
    id                bigserial primary key,
    created_at        timestamptz not null default now(),
    created_by        text,                          -- auth email / username captured server-known
    requester_name    text,                          -- display name (editable per submission)
    request_type      text not null,                 -- new_product | missing_decoration | amend_decoration | price_update | other
    description       text not null,
    screenshot        text,                          -- nullable base64 data URI, e.g. data:image/jpeg;base64,...
    status            text not null default 'open',  -- open | done
    resolved_at       timestamptz,
    resolved_by       text,
    resolution_notes  text,
    updated_at        timestamptz not null default now()
);

-- Listing is "open first, newest first" — index supports both filtered and
-- unfiltered loads without a sort step.
create index if not exists stash_production_issues_status_idx
    on public.stash_production_issues (status, created_at desc);

-- Bump updated_at on any change so the UI can show "edited" timestamps if
-- we want them later. Cheap; runs once per row mutation.
create or replace function public.stash_production_issues_touch()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists stash_production_issues_touch_trg on public.stash_production_issues;
create trigger stash_production_issues_touch_trg
    before update on public.stash_production_issues
    for each row execute function public.stash_production_issues_touch();

alter table public.stash_production_issues enable row level security;

-- Read: anyone authenticated through the app (anon key is gated by Firebase
-- auth in the UI). Mirrors the pattern used by stash_payment_requests_sent
-- and stash_finance_cache.
drop policy if exists "stash_production_issues anon read" on public.stash_production_issues;
create policy "stash_production_issues anon read"
    on public.stash_production_issues
    for select
    to anon
    using (true);

-- Write: production team logs straight from the browser, so anon must be
-- allowed insert/update/delete. The dashboard only renders the form for
-- authenticated users so anon-in-the-wild can't reach it.
drop policy if exists "stash_production_issues anon write" on public.stash_production_issues;
create policy "stash_production_issues anon write"
    on public.stash_production_issues
    for all
    to anon
    using (true)
    with check (true);
