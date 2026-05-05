-- Add "reviewed" stage to daily tasks workflow:
-- Daily tasks -> To be completed -> Completed

alter table if exists public.stash_daily_tasks
  add column if not exists reviewed boolean not null default false;

alter table if exists public.stash_daily_tasks
  add column if not exists reviewed_at timestamptz;
