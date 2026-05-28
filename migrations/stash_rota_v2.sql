-- ─── Stash — Rota v2 ───────────────────────────────────────────────────────
-- Run AFTER stash_rota.sql.  Adds the missing RotaCloud-parity features:
--   • draft / publish workflow                       (Bundle A)
--   • open shifts (user_id NULL = unclaimed)         (Bundle B)
--   • shift acknowledgements                         (Bundle C)
--   • iCal subscribe tokens per employee             (Bundle C)
--   • configurable leave-year start                  (Bundle D)
--   • TOIL ledger                                    (Bundle D)
--   • blocked-date windows (holiday embargoes)       (Bundle D)
--   • shift change audit log                         (Bundle D)
--
-- All additive; nothing existing is destroyed. RLS mirrors v1.

-- 1. Shifts — drafts / open shifts / publish history ----------------------
alter table public.stash_rota_shifts
    alter column user_id drop not null;

alter table public.stash_rota_shifts
    add column if not exists published_at   timestamptz,
    add column if not exists published_by   text,
    add column if not exists claimed_by     text,
    add column if not exists claimed_at     timestamptz,
    add column if not exists shift_color    text,
    add column if not exists requires_count integer default 1;
    -- requires_count > 1 lets one row represent N identical open slots
    -- (e.g. "we need 3 people 09-13 Saturday").

create index if not exists stash_rota_shifts_open_idx
    on public.stash_rota_shifts (start_at)
    where user_id is null;

create index if not exists stash_rota_shifts_published_idx
    on public.stash_rota_shifts (published, start_at);

-- 2. Acknowledgements — staff confirm they've seen a published shift ------
create table if not exists public.stash_rota_shift_acks (
    shift_id        bigint not null references public.stash_rota_shifts(id) on delete cascade,
    user_id         text   not null,
    acknowledged_at timestamptz not null default now(),
    primary key (shift_id, user_id)
);

create index if not exists stash_rota_shift_acks_user_idx
    on public.stash_rota_shift_acks (user_id);

alter table public.stash_rota_shift_acks enable row level security;

drop policy if exists "stash_rota_shift_acks anon read" on public.stash_rota_shift_acks;
create policy "stash_rota_shift_acks anon read"
    on public.stash_rota_shift_acks for select to anon using (true);
drop policy if exists "stash_rota_shift_acks anon write" on public.stash_rota_shift_acks;
create policy "stash_rota_shift_acks anon write"
    on public.stash_rota_shift_acks for all to anon using (true) with check (true);

-- 3. iCal subscribe tokens + leave-year + manager email opt-out -----------
alter table public.stash_rota_employees
    add column if not exists ical_token             text,
    add column if not exists leave_year_start_month integer default 1,
    add column if not exists leave_year_start_day   integer default 1,
    add column if not exists notify_email           boolean not null default true,
    add column if not exists default_role           text default '',
    add column if not exists default_color          text default '';

-- Auto-generate a random ical_token for rows missing one.  Staff can rotate
-- it manually if it leaks; new rows get a fresh token on insert below.
update public.stash_rota_employees
   set ical_token = encode(gen_random_bytes(18), 'hex')
 where ical_token is null;

create or replace function public.stash_rota_employees_default_token()
returns trigger as $$
begin
    if new.ical_token is null then
        new.ical_token := encode(gen_random_bytes(18), 'hex');
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists stash_rota_employees_default_token_trg on public.stash_rota_employees;
create trigger stash_rota_employees_default_token_trg
    before insert on public.stash_rota_employees
    for each row execute function public.stash_rota_employees_default_token();

-- 4. Blocked-date windows -------------------------------------------------
-- Manager-defined date ranges where holiday is restricted.  type controls
-- how strict: 'no_holiday' blocks new requests outright; 'reduced_capacity'
-- merely warns (we surface a UI banner instead of blocking).
create table if not exists public.stash_rota_blocked_dates (
    id           bigserial primary key,
    start_date   date not null,
    end_date     date not null,
    type         text not null default 'no_holiday',
    reason       text not null,
    notes        text default '',
    created_by   text,
    created_at   timestamptz not null default now()
);

create index if not exists stash_rota_blocked_dates_range_idx
    on public.stash_rota_blocked_dates (start_date, end_date);

alter table public.stash_rota_blocked_dates enable row level security;

drop policy if exists "stash_rota_blocked_dates anon read" on public.stash_rota_blocked_dates;
create policy "stash_rota_blocked_dates anon read"
    on public.stash_rota_blocked_dates for select to anon using (true);
drop policy if exists "stash_rota_blocked_dates anon write" on public.stash_rota_blocked_dates;
create policy "stash_rota_blocked_dates anon write"
    on public.stash_rota_blocked_dates for all to anon using (true) with check (true);

-- 5. TOIL ledger ----------------------------------------------------------
-- Positive `hours` = earned overtime; negative = banked time used.  Net
-- balance per user_id is the running sum across rows.
create table if not exists public.stash_rota_toil (
    id          bigserial primary key,
    user_id     text not null,
    hours       numeric not null,
    reason      text not null,
    earned_on   date not null default current_date,
    expires_on  date,
    shift_id    bigint references public.stash_rota_shifts(id) on delete set null,
    created_by  text,
    created_at  timestamptz not null default now()
);

create index if not exists stash_rota_toil_user_idx
    on public.stash_rota_toil (user_id, earned_on desc);

alter table public.stash_rota_toil enable row level security;

drop policy if exists "stash_rota_toil anon read" on public.stash_rota_toil;
create policy "stash_rota_toil anon read"
    on public.stash_rota_toil for select to anon using (true);
drop policy if exists "stash_rota_toil anon write" on public.stash_rota_toil;
create policy "stash_rota_toil anon write"
    on public.stash_rota_toil for all to anon using (true) with check (true);

-- 6. Shift change audit log ----------------------------------------------
-- Every shift create / update / delete / publish / claim / swap writes a
-- row here.  Lets us answer "who changed Sarah's Friday shift, and when?".
create table if not exists public.stash_rota_audit (
    id          bigserial primary key,
    entity      text not null,                   -- shift | time_off | swap | open_shift
    entity_id   text not null,
    action      text not null,                   -- create | update | delete | publish | claim | swap | acknowledge
    diff        jsonb not null default '{}'::jsonb,
    actor_id    text,
    actor_name  text,
    note        text default '',
    at          timestamptz not null default now()
);

create index if not exists stash_rota_audit_entity_idx
    on public.stash_rota_audit (entity, entity_id, at desc);
create index if not exists stash_rota_audit_at_idx
    on public.stash_rota_audit (at desc);

alter table public.stash_rota_audit enable row level security;

drop policy if exists "stash_rota_audit anon read" on public.stash_rota_audit;
create policy "stash_rota_audit anon read"
    on public.stash_rota_audit for select to anon using (true);
drop policy if exists "stash_rota_audit anon write" on public.stash_rota_audit;
create policy "stash_rota_audit anon write"
    on public.stash_rota_audit for all to anon using (true) with check (true);

-- 7. Realtime publication for the new tables ------------------------------
do $$
begin
    alter publication supabase_realtime add table public.stash_rota_shift_acks;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$
begin
    alter publication supabase_realtime add table public.stash_rota_swap_requests;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$
begin
    alter publication supabase_realtime add table public.stash_rota_blocked_dates;
exception when duplicate_object then null; when undefined_object then null; end $$;
