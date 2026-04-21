ALTER TABLE merchant_settings
  ADD COLUMN IF NOT EXISTS cart_max_discount_pct integer DEFAULT 10;

COMMENT ON COLUMN merchant_settings.cart_max_discount_pct IS 'Max discount % on cart negotiations (default 10)';
