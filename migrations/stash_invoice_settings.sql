-- Invoice tools: EUR conversion toggle + FX rate (single config row).
-- Used by Finance / Unpaid Orders invoice download UI.

create table if not exists public.stash_invoice_settings (
    id          text primary key,
    data        jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now(),
    updated_by  text
);

alter table public.stash_invoice_settings enable row level security;

drop policy if exists "stash_invoice_settings anon read" on public.stash_invoice_settings;
create policy "stash_invoice_settings anon read"
    on public.stash_invoice_settings
    for select
    to anon
    using (true);

drop policy if exists "stash_invoice_settings anon write" on public.stash_invoice_settings;
create policy "stash_invoice_settings anon write"
    on public.stash_invoice_settings
    for all
    to anon
    using (true)
    with check (true);
