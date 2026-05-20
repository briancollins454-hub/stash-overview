-- QuickBooks OAuth tokens (single row id = 'qbo_tokens')
-- Run in Supabase SQL editor if Connect QuickBooks fails to save tokens.

CREATE TABLE IF NOT EXISTS stash_qbo_tokens (
  id text PRIMARY KEY,
  realm_id text NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  token_type text DEFAULT 'bearer',
  expires_in integer DEFAULT 3600,
  x_refresh_token_expires_in integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE stash_qbo_tokens ENABLE ROW LEVEL SECURITY;

-- No public policies — server uses service role key only.
