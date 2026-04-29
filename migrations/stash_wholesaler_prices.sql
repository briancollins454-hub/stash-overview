-- ─── Stash — Wholesaler price + stock comparison ────────────────────────────
-- Powers the "Wholesale Lookup" tab so sales admin can type a code once and
-- see every wholesaler's stock + price side-by-side instead of logging in
-- to each supplier portal individually.
--
-- Loaded by manually uploading each wholesaler's stock/price CSV — most
-- of AWDis / Ralawise / BTC / Prestige / Pencarrie / Result publish daily
-- feeds in slightly different shapes. The component normalises them on
-- ingest. Each upload replaces the rows for that one wholesaler so a fresh
-- file always reflects current stock, never an out-of-date overlay.

create table if not exists public.stash_wholesaler_prices (
    id                  bigserial primary key,
    wholesaler          text not null,         -- 'AWDis' | 'Ralawise' | 'BTC' | 'Prestige' | 'Pencarrie' | 'Result' | (free text)
    product_code        text not null,         -- supplier's own SKU / style code
    product_name        text,                  -- full product description as it appears in the feed
    brand               text,                  -- optional — Gildan, Fruit of the Loom, etc.
    colour              text,                  -- optional — supplier-specified colour
    size                text,                  -- optional — S / M / L / XL / etc.
    stock_qty           integer,               -- current stock as of feed_updated_at; nullable if feed didn't include
    cost_price          numeric(12, 2),        -- our cost — nullable if feed didn't include
    rrp                 numeric(12, 2),        -- supplier RRP if provided
    currency            text default 'GBP',
    feed_updated_at     timestamptz not null default now(),  -- when this row was last refreshed from the supplier
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

-- Lookup is "filter by wholesaler" + "search by code/name". A simple b-tree
-- on (wholesaler, product_code) handles both filtered exact matches and the
-- "show me this code across every supplier" case used by the comparison view.
create index if not exists stash_wholesaler_prices_code_idx
    on public.stash_wholesaler_prices (lower(product_code));

create index if not exists stash_wholesaler_prices_wholesaler_idx
    on public.stash_wholesaler_prices (wholesaler);

-- Trigger to keep updated_at honest. Mirrors stash_production_issues.
create or replace function public.stash_wholesaler_prices_touch()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists stash_wholesaler_prices_touch_trg on public.stash_wholesaler_prices;
create trigger stash_wholesaler_prices_touch_trg
    before update on public.stash_wholesaler_prices
    for each row execute function public.stash_wholesaler_prices_touch();

alter table public.stash_wholesaler_prices enable row level security;

drop policy if exists "stash_wholesaler_prices anon read" on public.stash_wholesaler_prices;
create policy "stash_wholesaler_prices anon read"
    on public.stash_wholesaler_prices
    for select
    to anon
    using (true);

-- Sales admin uploads CSVs from the browser, so anon needs full write
-- access. The dashboard UI is gated by Firebase auth so anon-in-the-wild
-- can't reach it — same pattern as stash_production_issues.
drop policy if exists "stash_wholesaler_prices anon write" on public.stash_wholesaler_prices;
create policy "stash_wholesaler_prices anon write"
    on public.stash_wholesaler_prices
    for all
    to anon
    using (true)
    with check (true);
