-- 022_clone_jobs.sql
-- Adds the clone-from-public-storefront flow:
--   - merchants.kind / source_url / cloned_at  (mark which merchants are clones)
--   - clone_jobs                                (chunked, resumable clone runs)
--
-- A clone job pulls the public catalog + policy/about/FAQ pages from a real
-- Shopify storefront URL into one of our dev stores so we can run the eval
-- suite against a real-shaped catalog without touching the real merchant.

-- ─── 1. merchants: clone metadata ────────────────────────────────────────────

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'production'
    CHECK (kind IN ('production', 'clone', 'test')),
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS cloned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_merchants_kind ON merchants(kind);

-- ─── 2. clone_jobs: chunked, resumable clone runs ────────────────────────────

CREATE TABLE IF NOT EXISTS clone_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  source_url text NOT NULL,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'error')),

  -- Phase cursor — each tick advances within a phase, then moves to the next.
  current_phase text NOT NULL DEFAULT 'products'
    CHECK (current_phase IN ('products', 'policies', 'pages', 'done')),

  -- Products phase cursor (paginated /products.json)
  products_page int NOT NULL DEFAULT 1,
  products_offset int NOT NULL DEFAULT 0,
  products_imported int NOT NULL DEFAULT 0,

  -- Policies phase: one-shot, just track count
  policies_imported int NOT NULL DEFAULT 0,

  -- Pages phase: walks a list of URLs from sitemap_pages_*.xml
  pages_queue text[] NOT NULL DEFAULT ARRAY[]::text[],
  pages_offset int NOT NULL DEFAULT 0,
  pages_imported int NOT NULL DEFAULT 0,

  last_error text,

  -- Append-only event log: [{ ts, level, msg }]
  log jsonb NOT NULL DEFAULT '[]'::jsonb,

  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clone_jobs_merchant ON clone_jobs(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clone_jobs_status ON clone_jobs(status) WHERE status IN ('pending', 'running');

-- updated_at trigger
CREATE OR REPLACE FUNCTION fn_clone_jobs_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clone_jobs_updated_at ON clone_jobs;
CREATE TRIGGER trg_clone_jobs_updated_at
  BEFORE UPDATE ON clone_jobs
  FOR EACH ROW
  EXECUTE FUNCTION fn_clone_jobs_updated_at();
