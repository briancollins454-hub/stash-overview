-- ─── Stash — Stock take (barcode count sessions) ───────────────────────────
-- Scan-to-count workflow: session + lines, then commit into stash_stock.

create table if not exists public.stash_stock_take_sessions (
    id              text primary key,
    label           text not null,
    location        text not null default 'church_st',
    status          text not null default 'open',
    created_by      text,
    created_at      timestamptz not null default now(),
    committed_at    timestamptz
);

create index if not exists stash_stock_take_sessions_status_idx
    on public.stash_stock_take_sessions (status, created_at desc);

create table if not exists public.stash_stock_take_lines (
    id              text primary key,
    session_id      text not null references public.stash_stock_take_sessions (id) on delete cascade,
    ean             text not null,
    qty             integer not null default 0,
    vendor          text not null default '',
    product_code    text not null default '',
    description     text not null default '',
    colour          text not null default '',
    size            text not null default '',
    is_embellished  boolean not null default false,
    club_name       text,
    resolved_via    text not null default 'unknown',
    updated_at      timestamptz not null default now()
);

create unique index if not exists stash_stock_take_lines_session_key_idx
    on public.stash_stock_take_lines (
        session_id,
        ean,
        coalesce(size, ''),
        coalesce(colour, ''),
        is_embellished,
        coalesce(club_name, '')
    );

create index if not exists stash_stock_take_lines_session_idx
    on public.stash_stock_take_lines (session_id);

alter table public.stash_stock_take_sessions enable row level security;
alter table public.stash_stock_take_lines enable row level security;

drop policy if exists "stash_stock_take_sessions anon read" on public.stash_stock_take_sessions;
create policy "stash_stock_take_sessions anon read"
    on public.stash_stock_take_sessions for select to anon using (true);

drop policy if exists "stash_stock_take_sessions anon write" on public.stash_stock_take_sessions;
create policy "stash_stock_take_sessions anon write"
    on public.stash_stock_take_sessions for all to anon using (true) with check (true);

drop policy if exists "stash_stock_take_lines anon read" on public.stash_stock_take_lines;
create policy "stash_stock_take_lines anon read"
    on public.stash_stock_take_lines for select to anon using (true);

drop policy if exists "stash_stock_take_lines anon write" on public.stash_stock_take_lines;
create policy "stash_stock_take_lines anon write"
    on public.stash_stock_take_lines for all to anon using (true) with check (true);
