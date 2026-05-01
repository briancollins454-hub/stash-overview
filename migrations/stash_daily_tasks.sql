-- ─── Stash — Daily task list ───────────────────────────────────────────────
-- One place to park actionable work for the day: check items off, jot hold
-- notes, pull suggestions from Priority Board + finance tabs. Rows are
-- scoped by task_date (calendar day in the app — client sends YYYY-MM-DD).

create table if not exists public.stash_daily_tasks (
    id              bigserial primary key,
    task_date       date not null,
    title           text not null,
    source_page     text not null default 'manual',  -- manual | priority | finance_sni | finance_credit | finance_unpaid | production_issues
    source_ref      text,                             -- e.g. Deco job #, optional deep-link anchor
    sort_order      integer not null default 0,
    completed       boolean not null default false,
    completed_at    timestamptz,
    hold_note       text,                             -- reason for delay / blocker
    created_by      text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists stash_daily_tasks_date_idx
    on public.stash_daily_tasks (task_date, sort_order, id);

-- Same imported item can't be added twice on the same day (manual rows
-- leave source_ref null so staff can add unlimited free-text tasks).
create unique index if not exists stash_daily_tasks_import_dedupe_idx
    on public.stash_daily_tasks (task_date, source_page, source_ref)
    where source_ref is not null and trim(source_ref) <> '';

create or replace function public.stash_daily_tasks_touch()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists stash_daily_tasks_touch_trg on public.stash_daily_tasks;
create trigger stash_daily_tasks_touch_trg
    before update on public.stash_daily_tasks
    for each row execute function public.stash_daily_tasks_touch();

alter table public.stash_daily_tasks enable row level security;

drop policy if exists "stash_daily_tasks anon read" on public.stash_daily_tasks;
create policy "stash_daily_tasks anon read"
    on public.stash_daily_tasks for select to anon using (true);

drop policy if exists "stash_daily_tasks anon write" on public.stash_daily_tasks;
create policy "stash_daily_tasks anon write"
    on public.stash_daily_tasks for all to anon using (true) with check (true);
