-- Enable Supabase Realtime on key sync tables for live cross-device sync.
-- This allows the app to receive instant WebSocket notifications when any
-- device writes to these tables (mappings, job links, orders, deco jobs).

-- Add tables to the supabase_realtime publication
-- (safe to run multiple times — Postgres ignores duplicates)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'stash_mappings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE stash_mappings;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'stash_job_links'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE stash_job_links;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'stash_product_patterns'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE stash_product_patterns;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'stash_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE stash_orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'stash_deco_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE stash_deco_jobs;
  END IF;
END $$;
