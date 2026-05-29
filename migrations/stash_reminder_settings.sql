-- ─── Stash — automated payment-reminder settings (single config row) ────────
-- Stores the on/off state, send mode (preview vs live) and the editable email
-- templates for each reminder rule (due-soon / 7-30-60-90 days overdue /
-- monthly statement). One row, id = 'reminder_config'. The shape of `data`
-- mirrors ReminderConfig in utils/reminderRules.ts.
--
-- Editing happens from the Finance page (Firebase-gated UI) via the anon key,
-- so anon read+write is allowed here, matching stash_priority_notes etc. The
-- nightly cron reads it with the service role key.

create table if not exists public.stash_reminder_settings (
    id          text primary key,
    data        jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now(),
    updated_by  text
);

alter table public.stash_reminder_settings enable row level security;

drop policy if exists "stash_reminder_settings anon read" on public.stash_reminder_settings;
create policy "stash_reminder_settings anon read"
    on public.stash_reminder_settings
    for select
    to anon
    using (true);

drop policy if exists "stash_reminder_settings anon write" on public.stash_reminder_settings;
create policy "stash_reminder_settings anon write"
    on public.stash_reminder_settings
    for all
    to anon
    using (true)
    with check (true);
