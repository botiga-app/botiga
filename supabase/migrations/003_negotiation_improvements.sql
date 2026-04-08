-- Track bot's last offered price for server-side acceptance detection
ALTER TABLE negotiations ADD COLUMN IF NOT EXISTS bot_last_offered_price NUMERIC;

-- Track discount code created for checkout
ALTER TABLE negotiations ADD COLUMN IF NOT EXISTS discount_code TEXT;

-- Human escalation status
-- status can now be: active | won | lost | pending | recovered | human_escalated

-- Shopify credentials on merchants
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS shopify_access_token TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS shopify_domain TEXT;

-- Merchant notification contacts
ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS merchant_notification_email TEXT;
ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS merchant_whatsapp TEXT;
