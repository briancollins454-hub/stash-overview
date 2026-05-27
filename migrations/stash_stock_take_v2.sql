-- ─── Stash — Stock take V2 (audit trail, session totals, atomic increment) ──
-- Run AFTER stash_stock_take.sql.  Adds:
--   • totals + variance columns on sessions  (point 10)
--   • atomic line increment RPC              (point 4)
--   • per-commit audit snapshot table        (point 5)

alter table public.stash_stock_take_sessions
    add column if not exists total_skus       integer,
    add column if not exists total_units      integer,
    add column if not exists net_variance     integer,
    add column if not exists committed_by     text,
    add column if not exists reopened_count   integer not null default 0;

-- ─── Audit snapshot (one row per scanned line, captured at commit) ──────────
create table if not exists public.stash_stock_take_audit (
    id              text primary key,
    session_id      text not null references public.stash_stock_take_sessions (id) on delete cascade,
    committed_at    timestamptz not null default now(),
    committed_by    text,
    location        text,
    ean             text not null,
    description     text not null default '',
    vendor          text not null default '',
    product_code    text not null default '',
    colour          text not null default '',
    size            text not null default '',
    is_embellished  boolean not null default false,
    club_name       text,
    book_qty        integer not null default 0,
    counted_qty     integer not null default 0,
    variance        integer not null default 0
);

create index if not exists stash_stock_take_audit_session_idx
    on public.stash_stock_take_audit (session_id);
create index if not exists stash_stock_take_audit_committed_idx
    on public.stash_stock_take_audit (committed_at desc);

alter table public.stash_stock_take_audit enable row level security;

drop policy if exists "stash_stock_take_audit anon read" on public.stash_stock_take_audit;
create policy "stash_stock_take_audit anon read"
    on public.stash_stock_take_audit for select to anon using (true);

drop policy if exists "stash_stock_take_audit anon write" on public.stash_stock_take_audit;
create policy "stash_stock_take_audit anon write"
    on public.stash_stock_take_audit for all to anon using (true) with check (true);

-- ─── Atomic add — used so two scanners on the same SKU never lose a count ───
-- Returns the resulting row so the client can sync state without a second
-- round-trip.  All other fields are taken from the most recent scan.
create or replace function public.stash_stock_take_add_line_qty(
    p_id            text,
    p_session_id    text,
    p_ean           text,
    p_qty           integer,
    p_vendor        text default '',
    p_product_code  text default '',
    p_description   text default '',
    p_colour        text default '',
    p_size          text default '',
    p_is_embellished boolean default false,
    p_club_name     text default null,
    p_resolved_via  text default 'unknown'
)
returns public.stash_stock_take_lines
language plpgsql
as $$
declare
    existing public.stash_stock_take_lines%rowtype;
    result   public.stash_stock_take_lines%rowtype;
begin
    select * into existing
    from public.stash_stock_take_lines
    where session_id = p_session_id
      and ean = p_ean
      and coalesce(size, '') = coalesce(p_size, '')
      and coalesce(colour, '') = coalesce(p_colour, '')
      and is_embellished = p_is_embellished
      and coalesce(club_name, '') = coalesce(p_club_name, '')
    limit 1
    for update;

    if found then
        update public.stash_stock_take_lines
           set qty           = existing.qty + p_qty,
               vendor        = coalesce(nullif(p_vendor, ''), existing.vendor),
               product_code  = coalesce(nullif(p_product_code, ''), existing.product_code),
               description   = coalesce(nullif(p_description, ''), existing.description),
               resolved_via  = p_resolved_via,
               updated_at    = now()
         where id = existing.id
         returning * into result;
        return result;
    end if;

    insert into public.stash_stock_take_lines (
        id, session_id, ean, qty, vendor, product_code, description, colour, size,
        is_embellished, club_name, resolved_via, updated_at
    ) values (
        p_id, p_session_id, p_ean, p_qty, p_vendor, p_product_code, p_description,
        p_colour, p_size, p_is_embellished, p_club_name, p_resolved_via, now()
    )
    returning * into result;
    return result;
end;
$$;

grant execute on function public.stash_stock_take_add_line_qty(
    text, text, text, integer, text, text, text, text, text, boolean, text, text
) to anon;
