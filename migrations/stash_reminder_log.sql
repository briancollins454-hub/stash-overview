-- ─── Stash — automated payment-reminder send log (+ dedupe) ─────────────────
-- One row per reminder the cron sends OR would send (preview mode). The
-- unique `dedupe_key` is what guarantees a customer never gets the same
-- reminder twice. Keys are namespaced by mode so a preview run never blocks
-- the real send once you go live:
--   invoice reminders : <mode>:inv:<invoiceId>:<ruleId>
--   monthly statement : <mode>:stmt:<customerId>:<YYYY-MM>
--   no-email skips     : <mode>:inv:<invoiceId>:<ruleId>:noemail   (does not
--                        block a later real send if an email is added in QB)
--
-- `mode` records whether the row was a real send ('live') or a dry run
-- ('preview'). Preview rows are logged so staff can review exactly what
-- WOULD have gone out before flipping the system live.

create table if not exists public.stash_reminder_log (
    id           bigint generated always as identity primary key,
    dedupe_key   text not null unique,
    rule_id      text not null,
    mode         text not null default 'preview',     -- 'preview' | 'live'
    status       text not null default 'sent',        -- 'sent' | 'failed' | 'skipped'
    customer_id  text,
    customer_name text,
    invoice_id   text,
    invoice_no   text,
    recipient    text,
    amount       numeric,
    subject      text,
    error        text,
    sent_at      timestamptz not null default now()
);

create index if not exists stash_reminder_log_sent_at_idx
    on public.stash_reminder_log (sent_at desc);
create index if not exists stash_reminder_log_rule_idx
    on public.stash_reminder_log (rule_id);

alter table public.stash_reminder_log enable row level security;

-- Read: the Finance page shows a "what was sent / would send" log.
drop policy if exists "stash_reminder_log anon read" on public.stash_reminder_log;
create policy "stash_reminder_log anon read"
    on public.stash_reminder_log
    for select
    to anon
    using (true);

-- Writes come from the cron via the service role key (bypasses RLS), so no
-- anon write policy is granted here on purpose — the log is append-only from
-- the server and must not be mutable from the browser.
