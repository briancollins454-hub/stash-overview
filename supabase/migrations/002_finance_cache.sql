-- Finance cache table for cross-device persistence of DecoNetwork financial data
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)

CREATE TABLE IF NOT EXISTS stash_finance_cache (
  id TEXT PRIMARY KEY DEFAULT 'finance_jobs',
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_synced TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE stash_finance_cache ENABLE ROW LEVEL SECURITY;

-- Allow full access via service key (used by the API proxy)
CREATE POLICY "Allow all via service key" ON stash_finance_cache
  FOR ALL USING (true) WITH CHECK (true);
