-- 024_store_context_cache.sql
-- Caches public storefront data fetched from merchant.source_url so the
-- negotiation engine can reference real-world context (collections,
-- active promos, brand voice) without re-crawling the source on every
-- negotiation. TTLs are enforced in application code via fetched_at.

CREATE TABLE IF NOT EXISTS store_context_cache (
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  cache_key text NOT NULL CHECK (cache_key IN ('collections', 'promos', 'about', 'product_collections')),
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_store_context_cache_fetched
  ON store_context_cache(fetched_at);
