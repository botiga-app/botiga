ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS shopify_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS shopify_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shopify_refresh_token_expires_at TIMESTAMPTZ;
