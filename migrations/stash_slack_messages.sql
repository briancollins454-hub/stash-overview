-- ─── Stash Slack message cache ──────────────────────────────────────────────
-- Stores messages from the Slack channels we mirror into the Production page.
-- Populated in two ways:
--   1. Real-time via /api/slack-events when Slack fires `message` events.
--   2. Bulk backfill via /api/slack-backfill on first load (last 3 days).
--
-- `id` uses Slack's natural key "channel_id:ts" so idempotent upserts Just Work
-- regardless of whether a message arrives via events first or backfill first.

create table if not exists public.stash_slack_messages (
    id              text primary key,                -- "{channel_id}:{ts}"
    channel_id      text not null,                   -- e.g. "C08XXXXXXXX"
    channel_name    text not null,                   -- "print-updates" | "embroidery-updates"
    user_id         text,                            -- Slack user id (may be null for bot/system msgs)
    user_name       text,                            -- resolved display name / real name
    user_avatar     text,                            -- resolved avatar URL (image_48)
    text            text not null default '',        -- raw message text (Slack markup OK)
    ts              text not null,                   -- Slack's unique per-channel timestamp
    ts_epoch        double precision not null,       -- ts parsed to seconds since epoch, for ordering
    subtype         text,                            -- null for normal messages; e.g. "bot_message", "channel_join"
    edited          boolean not null default false,
    thread_ts       text,                            -- parent ts if this is a thread reply
    permalink       text,                            -- optional direct Slack link
    created_at      timestamptz not null default now()
);

-- Newest-first reads per channel are the hot path — index on (channel_id, ts_epoch desc).
create index if not exists stash_slack_messages_channel_ts_idx
    on public.stash_slack_messages (channel_id, ts_epoch desc);

-- Bot/system message filtering is common in the UI, so keep an index on subtype.
create index if not exists stash_slack_messages_subtype_idx
    on public.stash_slack_messages (subtype);

-- Allow anon reads (feed is visible to anyone logged in); writes come from the
-- serverless API using the service key, so no anon-write policy needed.
alter table public.stash_slack_messages enable row level security;

drop policy if exists "stash_slack_messages anon read" on public.stash_slack_messages;
create policy "stash_slack_messages anon read"
    on public.stash_slack_messages
    for select
    to anon
    using (true);

-- Optional: automatic 14-day retention so the table stays tiny. Safe to skip
-- if you want unlimited history; comment the block out if so.
-- create extension if not exists pg_cron;
-- select cron.schedule(
--     'stash-slack-messages-prune',
--     '15 3 * * *',
--     $$ delete from public.stash_slack_messages where created_at < now() - interval '14 days' $$
-- );
