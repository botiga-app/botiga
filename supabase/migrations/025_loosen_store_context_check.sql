-- Loosen the cache_key CHECK constraint on store_context_cache so we can add
-- new cache categories (products, sitemap, etc.) without a migration each time.
-- Application code is now the single source of truth for valid keys.

ALTER TABLE store_context_cache
  DROP CONSTRAINT IF EXISTS store_context_cache_cache_key_check;
