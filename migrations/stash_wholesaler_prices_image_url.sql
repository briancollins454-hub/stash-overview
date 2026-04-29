-- ─── Wholesale Lookup — image thumbnail support ────────────────────────────
-- Adds an image_url column to stash_wholesaler_prices. Most supplier feeds
-- expose a URL alongside the SKU and a thumbnail next to each style turns
-- "is this the right hoodie?" from a 5-second decision into a glance.
--
-- Idempotent — uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS so re-running
-- the migration on a database that already has the column is a no-op.

alter table public.stash_wholesaler_prices
    add column if not exists image_url text;
