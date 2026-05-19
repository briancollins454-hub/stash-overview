-- ─── Stash — Rota (RotaCloud replacement) ─────────────────────────────────
-- Salaried-staff scheduling + time-off + manual bank holidays.
-- No clocking, no hourly pay, no labour-cost forecasting.
--
-- Tables (all `stash_rota_*`):
--   stash_rota_employees     — HR profile bolted onto stash_users by user_id
--   stash_rota_shifts        — planned roster entries (one per shift)
--   stash_rota_time_off      — leave requests & decisions
--   stash_rota_closures      — manual bank holidays / company closures
--   stash_rota_swap_requests — staff-initiated swaps (feature flagged off in v1)
--
-- Anon RLS read/write is permissive — server proxies access via supabase-data
-- and the app gates writes by role. Same pattern as other stash_* tables.

-- 1. HR profile -------------------------------------------------------------
create table if not exists public.stash_rota_employees (
    user_id                 text primary key,
    display_name            text not null,
    job_title               text default '',
    team                    text default '',
    location                text default '',
    start_date              date,
    weekly_hours            numeric default 40,
    holiday_allowance_days  numeric default 28,
    carried_over_days       numeric default 0,
    manager_user_id         text,
    is_active               boolean not null default true,
    email                   text,
    notes                   text default '',
    rotacloud_id            text,
    updated_at              timestamptz not null default now()
);

create index if not exists stash_rota_employees_active_idx
    on public.stash_rota_employees (is_active);

-- 2. Shifts (the rota itself) ----------------------------------------------
create table if not exists public.stash_rota_shifts (
    id              bigserial primary key,
    user_id         text not null,
    start_at        timestamptz not null,
    end_at          timestamptz not null,
    role            text default '',
    location        text default '',
    notes           text default '',
    published       boolean not null default true,
    template_key    text,
    created_by      text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists stash_rota_shifts_user_date_idx
    on public.stash_rota_shifts (user_id, start_at);

create index if not exists stash_rota_shifts_range_idx
    on public.stash_rota_shifts (start_at, end_at);

-- 3. Time-off requests -----------------------------------------------------
create table if not exists public.stash_rota_time_off (
    id              bigserial primary key,
    user_id         text not null,
    type            text not null default 'holiday',
        -- holiday | sick | unpaid | other
    start_date      date not null,
    end_date        date not null,
    half_day        text,
        -- null | 'am' | 'pm' (only valid when start_date = end_date)
    reason          text default '',
    status          text not null default 'pending',
        -- pending | approved | declined | cancelled
    decided_by      text,
    decided_at      timestamptz,
    decided_note    text default '',
    requested_at    timestamptz not null default now(),
    days_count      numeric default 0,
        -- decimal days deducted from allowance (0.5 for half day)
    updated_at      timestamptz not null default now()
);

create index if not exists stash_rota_time_off_user_idx
    on public.stash_rota_time_off (user_id, start_date desc);

create index if not exists stash_rota_time_off_status_idx
    on public.stash_rota_time_off (status, start_date);

-- 4. Manual company closures / bank holidays --------------------------------
create table if not exists public.stash_rota_closures (
    closure_date    date primary key,
    label           text not null,
    paid            boolean not null default true,
    notes           text default '',
    created_by      text,
    created_at      timestamptz not null default now()
);

-- 5. Shift swap requests (UI hidden in v1; schema future-proofed) ----------
create table if not exists public.stash_rota_swap_requests (
    id              bigserial primary key,
    requester_id    text not null,
    counterparty_id text,                            -- nullable: open swap
    shift_id        bigint references public.stash_rota_shifts(id) on delete cascade,
    offered_shift_id bigint references public.stash_rota_shifts(id) on delete set null,
    reason          text default '',
    status          text not null default 'pending', -- pending | accepted | declined | cancelled
    decided_by      text,
    decided_at      timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- ─── updated_at touch triggers ────────────────────────────────────────────
create or replace function public.stash_rota_touch()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists stash_rota_employees_touch_trg on public.stash_rota_employees;
create trigger stash_rota_employees_touch_trg
    before update on public.stash_rota_employees
    for each row execute function public.stash_rota_touch();

drop trigger if exists stash_rota_shifts_touch_trg on public.stash_rota_shifts;
create trigger stash_rota_shifts_touch_trg
    before update on public.stash_rota_shifts
    for each row execute function public.stash_rota_touch();

drop trigger if exists stash_rota_time_off_touch_trg on public.stash_rota_time_off;
create trigger stash_rota_time_off_touch_trg
    before update on public.stash_rota_time_off
    for each row execute function public.stash_rota_touch();

drop trigger if exists stash_rota_swap_requests_touch_trg on public.stash_rota_swap_requests;
create trigger stash_rota_swap_requests_touch_trg
    before update on public.stash_rota_swap_requests
    for each row execute function public.stash_rota_touch();

-- ─── Anon RLS (server-proxied access) ─────────────────────────────────────
alter table public.stash_rota_employees     enable row level security;
alter table public.stash_rota_shifts        enable row level security;
alter table public.stash_rota_time_off      enable row level security;
alter table public.stash_rota_closures      enable row level security;
alter table public.stash_rota_swap_requests enable row level security;

drop policy if exists "stash_rota_employees anon read" on public.stash_rota_employees;
create policy "stash_rota_employees anon read"
    on public.stash_rota_employees for select to anon using (true);
drop policy if exists "stash_rota_employees anon write" on public.stash_rota_employees;
create policy "stash_rota_employees anon write"
    on public.stash_rota_employees for all to anon using (true) with check (true);

drop policy if exists "stash_rota_shifts anon read" on public.stash_rota_shifts;
create policy "stash_rota_shifts anon read"
    on public.stash_rota_shifts for select to anon using (true);
drop policy if exists "stash_rota_shifts anon write" on public.stash_rota_shifts;
create policy "stash_rota_shifts anon write"
    on public.stash_rota_shifts for all to anon using (true) with check (true);

drop policy if exists "stash_rota_time_off anon read" on public.stash_rota_time_off;
create policy "stash_rota_time_off anon read"
    on public.stash_rota_time_off for select to anon using (true);
drop policy if exists "stash_rota_time_off anon write" on public.stash_rota_time_off;
create policy "stash_rota_time_off anon write"
    on public.stash_rota_time_off for all to anon using (true) with check (true);

drop policy if exists "stash_rota_closures anon read" on public.stash_rota_closures;
create policy "stash_rota_closures anon read"
    on public.stash_rota_closures for select to anon using (true);
drop policy if exists "stash_rota_closures anon write" on public.stash_rota_closures;
create policy "stash_rota_closures anon write"
    on public.stash_rota_closures for all to anon using (true) with check (true);

drop policy if exists "stash_rota_swap_requests anon read" on public.stash_rota_swap_requests;
create policy "stash_rota_swap_requests anon read"
    on public.stash_rota_swap_requests for select to anon using (true);
drop policy if exists "stash_rota_swap_requests anon write" on public.stash_rota_swap_requests;
create policy "stash_rota_swap_requests anon write"
    on public.stash_rota_swap_requests for all to anon using (true) with check (true);

-- Realtime publication so manager + staff devices see updates instantly.
do $$
begin
    alter publication supabase_realtime add table public.stash_rota_employees;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$
begin
    alter publication supabase_realtime add table public.stash_rota_shifts;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$
begin
    alter publication supabase_realtime add table public.stash_rota_time_off;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$
begin
    alter publication supabase_realtime add table public.stash_rota_closures;
exception when duplicate_object then null; when undefined_object then null; end $$;
