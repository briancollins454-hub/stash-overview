-- ─── Stash — Supplier barcode catalogs (stock take feeds) ─────────────────
-- Upload supplier CSVs here; each supplier can be replaced on re-upload.
-- Scans resolve against this catalog before master reference / stock / Deco.

create table if not exists public.stash_supplier_imports (
    id              text primary key,
    supplier_name   text not null,
    file_name       text,
    row_count       integer not null default 0,
    uploaded_by     text,
    created_at      timestamptz not null default now()
);

create index if not exists stash_supplier_imports_supplier_idx
    on public.stash_supplier_imports (supplier_name, created_at desc);

create table if not exists public.stash_supplier_catalog (
    id              text primary key,
    supplier_name   text not null,
    import_id       text references public.stash_supplier_imports (id) on delete set null,
    ean             text not null,
    vendor          text not null default '',
    product_code    text not null default '',
    description     text not null default '',
    colour          text not null default '',
    size            text not null default '',
    updated_at      timestamptz not null default now()
);

create unique index if not exists stash_supplier_catalog_supplier_ean_idx
    on public.stash_supplier_catalog (supplier_name, ean);

create index if not exists stash_supplier_catalog_ean_idx
    on public.stash_supplier_catalog (ean);

alter table public.stash_supplier_imports enable row level security;
alter table public.stash_supplier_catalog enable row level security;

drop policy if exists "stash_supplier_imports anon read" on public.stash_supplier_imports;
create policy "stash_supplier_imports anon read"
    on public.stash_supplier_imports for select to anon using (true);

drop policy if exists "stash_supplier_imports anon write" on public.stash_supplier_imports;
create policy "stash_supplier_imports anon write"
    on public.stash_supplier_imports for all to anon using (true) with check (true);

drop policy if exists "stash_supplier_catalog anon read" on public.stash_supplier_catalog;
create policy "stash_supplier_catalog anon read"
    on public.stash_supplier_catalog for select to anon using (true);

drop policy if exists "stash_supplier_catalog anon write" on public.stash_supplier_catalog;
create policy "stash_supplier_catalog anon write"
    on public.stash_supplier_catalog for all to anon using (true) with check (true);
