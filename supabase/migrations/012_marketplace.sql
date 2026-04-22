-- ============================================================
-- 012_marketplace.sql — Botiga.ai reverse marketplace tables
-- ============================================================

-- Marketplace customer accounts
CREATE TABLE IF NOT EXISTS marketplace_customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  phone           TEXT,
  password_hash   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS marketplace_customers_email_idx ON marketplace_customers(email);

-- Merchant extensions for marketplace participation
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS marketplace_active           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketplace_max_discount_pct INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS marketplace_commission_pct   NUMERIC(4,2) NOT NULL DEFAULT 8.0,
  ADD COLUMN IF NOT EXISTS marketplace_store_name       TEXT,
  ADD COLUMN IF NOT EXISTS marketplace_store_domain     TEXT;

-- Indexed product catalog (populated by indexer job)
CREATE TABLE IF NOT EXISTS marketplace_products (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id        UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  shopify_product_id TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  price              NUMERIC(10,2) NOT NULL,
  compare_at_price   NUMERIC(10,2),
  images             JSONB NOT NULL DEFAULT '[]',
  tags               TEXT[] NOT NULL DEFAULT '{}',
  handle             TEXT NOT NULL,
  product_type       TEXT,
  vendor             TEXT,
  variants           JSONB NOT NULL DEFAULT '[]',
  store_domain       TEXT NOT NULL,
  store_name         TEXT,
  max_discount_pct   INTEGER NOT NULL DEFAULT 20,
  is_sponsored       BOOLEAN NOT NULL DEFAULT FALSE,
  search_vector      TSVECTOR,
  indexed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(merchant_id, shopify_product_id)
);

CREATE INDEX IF NOT EXISTS marketplace_products_merchant_idx    ON marketplace_products(merchant_id);
CREATE INDEX IF NOT EXISTS marketplace_products_search_idx      ON marketplace_products USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS marketplace_products_sponsored_idx   ON marketplace_products(is_sponsored) WHERE is_sponsored = TRUE;
CREATE INDEX IF NOT EXISTS marketplace_products_price_idx       ON marketplace_products(price);

-- Auto-update search_vector from title + description + tags + vendor
CREATE OR REPLACE FUNCTION marketplace_products_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.vendor, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.product_type, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS marketplace_products_search_trigger ON marketplace_products;
CREATE TRIGGER marketplace_products_search_trigger
  BEFORE INSERT OR UPDATE ON marketplace_products
  FOR EACH ROW EXECUTE FUNCTION marketplace_products_search_update();

-- Marketplace negotiations (wraps existing negotiation engine)
CREATE TABLE IF NOT EXISTS marketplace_negotiations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id       UUID REFERENCES negotiations(id) ON DELETE SET NULL,
  customer_id          UUID REFERENCES marketplace_customers(id) ON DELETE SET NULL,
  merchant_id          UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  product_id           UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  list_price           NUMERIC(10,2) NOT NULL,
  deal_price           NUMERIC(10,2),
  commission_pct       NUMERIC(4,2) NOT NULL DEFAULT 8.0,
  commission_amount    NUMERIC(10,2),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','won','lost','expired')),
  merchant_notified_at TIMESTAMPTZ,
  customer_email       TEXT,
  customer_name        TEXT,
  customer_phone       TEXT,
  discount_code        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS marketplace_neg_customer_idx  ON marketplace_negotiations(customer_id);
CREATE INDEX IF NOT EXISTS marketplace_neg_merchant_idx  ON marketplace_negotiations(merchant_id);
CREATE INDEX IF NOT EXISTS marketplace_neg_status_idx    ON marketplace_negotiations(status);

-- Per-negotiation message log
CREATE TABLE IF NOT EXISTS marketplace_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id   UUID NOT NULL REFERENCES marketplace_negotiations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content          TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS marketplace_messages_neg_idx ON marketplace_messages(negotiation_id, created_at);

-- Sponsored placement budget / bidding
CREATE TABLE IF NOT EXISTS marketplace_sponsored (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  keywords      TEXT[] NOT NULL DEFAULT '{}',
  budget_daily  NUMERIC(8,2) NOT NULL DEFAULT 10.00,
  cpc           NUMERIC(6,2) NOT NULL DEFAULT 0.50,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS marketplace_sponsored_merchant_idx ON marketplace_sponsored(merchant_id);
CREATE INDEX IF NOT EXISTS marketplace_sponsored_active_idx   ON marketplace_sponsored(active) WHERE active = TRUE;
