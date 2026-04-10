-- Deco stitch/decoration cache for cross-device persistence
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)

CREATE TABLE IF NOT EXISTS stash_deco_stitch_cache (
  job_number TEXT PRIMARY KEY,
  decoration_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  enriched_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow full access via anon key (same pattern as other stash_ tables)
ALTER TABLE stash_deco_stitch_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON stash_deco_stitch_cache FOR ALL USING (true) WITH CHECK (true);
