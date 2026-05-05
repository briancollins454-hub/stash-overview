-- ─── Stash — Priority board row notes ─────────────────────────────────────
-- Shared notes and "exclude from PDF" flags keyed by Deco job number.
-- Lets staff record why a row is still open and keep resolved/internal
-- follow-ups out of handoff PDFs across all devices.

create table if not exists public.stash_priority_notes (
    job_number        text primary key,
    note_text         text,
    exclude_from_pdf  boolean not null default false,
    updated_at        timestamptz not null default now()
);

create or replace function public.stash_priority_notes_touch()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists stash_priority_notes_touch_trg on public.stash_priority_notes;
create trigger stash_priority_notes_touch_trg
    before update on public.stash_priority_notes
    for each row execute function public.stash_priority_notes_touch();

alter table public.stash_priority_notes enable row level security;

drop policy if exists "stash_priority_notes anon read" on public.stash_priority_notes;
create policy "stash_priority_notes anon read"
    on public.stash_priority_notes
    for select
    to anon
    using (true);

drop policy if exists "stash_priority_notes anon write" on public.stash_priority_notes;
create policy "stash_priority_notes anon write"
    on public.stash_priority_notes
    for all
    to anon
    using (true)
    with check (true);
