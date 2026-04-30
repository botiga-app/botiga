-- 020_video_pipeline.sql
-- Foundation for the WhatsApp/SMS/upload → vision-tag → product-create-or-tag pipeline.
-- Adds the columns and tables the new flows need; no behavior changes to existing code.

-- ─── 1. merchants: shop slug + messaging channels ────────────────────────────

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS shop_handle text UNIQUE,
  ADD COLUMN IF NOT EXISTS whatsapp_phone text UNIQUE,
  ADD COLUMN IF NOT EXISTS sms_phone text UNIQUE,
  ADD COLUMN IF NOT EXISTS preferred_channel text DEFAULT 'either'
    CHECK (preferred_channel IN ('whatsapp', 'sms', 'dashboard', 'either')),
  ADD COLUMN IF NOT EXISTS phone_verify_code text,
  ADD COLUMN IF NOT EXISTS phone_verify_expires timestamptz;

-- Backfill shop_handle for existing merchants from shopify_domain
-- (e.g. "botiga-6380.myshopify.com" → "botiga-6380").
-- A clean base handle is only used when (a) it's the first row needing it AND
-- (b) no other merchant already has that handle set. Any conflict — within
-- the unset group OR with a pre-existing handle — falls back to a 4-char id
-- suffix so the result is always unique.
WITH base_data AS (
  SELECT
    id,
    created_at,
    lower(regexp_replace(split_part(shopify_domain, '.', 1), '[^a-z0-9-]', '-', 'g')) AS base_handle
  FROM merchants
  WHERE shop_handle IS NULL AND shopify_domain IS NOT NULL
),
ranked AS (
  SELECT
    bd.*,
    row_number() OVER (PARTITION BY bd.base_handle ORDER BY bd.created_at NULLS LAST, bd.id) AS rn,
    EXISTS (
      SELECT 1 FROM merchants m2
      WHERE m2.shop_handle = bd.base_handle
    ) AS conflict_with_existing
  FROM base_data bd
)
UPDATE merchants m
SET shop_handle = CASE
  WHEN r.rn = 1 AND NOT r.conflict_with_existing THEN r.base_handle
  ELSE r.base_handle || '-' || substring(m.id::text, 1, 4)
END
FROM ranked r
WHERE m.id = r.id;

-- Where shop_handle is still null (no domain at all), use a uuid suffix.
UPDATE merchants
SET shop_handle = 'shop-' || substring(id::text, 1, 8)
WHERE shop_handle IS NULL;

CREATE INDEX IF NOT EXISTS idx_merchants_shop_handle ON merchants(shop_handle);
CREATE INDEX IF NOT EXISTS idx_merchants_whatsapp_phone ON merchants(whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_merchants_sms_phone ON merchants(sms_phone) WHERE sms_phone IS NOT NULL;

-- ─── 2. pending_video_products: drafts mid-creation, awaiting merchant ───────

CREATE TABLE IF NOT EXISTS pending_video_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  video_id uuid REFERENCES videos(id) ON DELETE CASCADE,

  -- AI extraction snapshot
  vision_summary jsonb,           -- raw vision model output
  audio_transcript text,          -- whisper output (full text)
  caption text,                   -- merchant-supplied caption (WhatsApp body, upload form)

  -- Proposed product fields (built up as merchant answers questions)
  proposed_fields jsonb DEFAULT '{}'::jsonb,
    -- shape: { title, description, price, compare_at_price, sizes, color,
    --          quantity, tags, image_s3_key, sku }

  missing_fields text[] DEFAULT ARRAY[]::text[],

  -- Resolved Shopify product (once published)
  shopify_product_id text,
  shopify_variant_ids text[],

  status text NOT NULL DEFAULT 'awaiting_merchant'
    CHECK (status IN ('awaiting_merchant', 'ready', 'created', 'abandoned', 'discarded')),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pvp_merchant_status ON pending_video_products(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_pvp_video ON pending_video_products(video_id);

-- ─── 3. merchant_messages: bot ↔ merchant conversation log ──────────────────

CREATE TABLE IF NOT EXISTS merchant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  pending_video_product_id uuid REFERENCES pending_video_products(id) ON DELETE CASCADE,

  channel text NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'dashboard')),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),

  body text,
  media_urls text[],

  -- Twilio-specific tracking when applicable
  twilio_message_sid text,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msg_merchant_created ON merchant_messages(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_pvp ON merchant_messages(pending_video_product_id, created_at);

-- ─── 4. negotiations: customer attachments (screenshots in chat) ─────────────

ALTER TABLE negotiations
  ADD COLUMN IF NOT EXISTS customer_attachments jsonb DEFAULT '[]'::jsonb;
  -- shape: [{ s3_key, vision_summary, competitor_price, ts }]

-- ─── 5. updated_at trigger for pending_video_products ───────────────────────

CREATE OR REPLACE FUNCTION fn_pvp_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pvp_updated_at ON pending_video_products;
CREATE TRIGGER trg_pvp_updated_at
  BEFORE UPDATE ON pending_video_products
  FOR EACH ROW
  EXECUTE FUNCTION fn_pvp_updated_at();
