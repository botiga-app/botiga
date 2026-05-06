-- ============================================================
-- 034_concierge_threads.sql — Cross-page Willow chat threads
-- ============================================================
--
-- The concierge widget is now a single persistent chat surface that
-- travels with the customer across pages. One thread per (merchant,
-- session). Per-product negotiations still live in `negotiations` —
-- a thread can spawn many negotiations as the customer asks about
-- different products, but the conversation transcript itself lives
-- here so we don't fragment it across many negotiation rows.
--
-- The widget mirrors the messages array to localStorage for instant
-- resume; the server copy is durable across browser-storage clears
-- and supports cross-device resume (post-MVP — we'd need an identity
-- merge to enable that, but the data is already structured for it).

CREATE TABLE IF NOT EXISTS concierge_threads (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id              UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  session_id               TEXT NOT NULL,
  messages                 JSONB NOT NULL DEFAULT '[]',
  customer_email           TEXT,
  customer_whatsapp        TEXT,
  customer_name            TEXT,
  -- The active negotiation, if Willow has transitioned the conversation
  -- into a real product negotiation. NULL during pure browse/discovery.
  active_negotiation_id    UUID REFERENCES negotiations(id) ON DELETE SET NULL,
  -- Recent navigation context — used by the LLM to acknowledge "saw you
  -- looking at X" naturally and by proactive triggers to throttle.
  last_product_url         TEXT,
  last_collection_url      TEXT,
  last_page_type           TEXT,    -- 'product' | 'collection' | 'cart' | 'home' | 'other'
  pages_visited            INTEGER NOT NULL DEFAULT 0,
  proactive_count          INTEGER NOT NULL DEFAULT 0,
  last_proactive_at        TIMESTAMPTZ,
  -- Lead surface — same vocabulary as negotiations.lead_tier so a single
  -- /dashboard/leads query can union both sources.
  lead_tier                TEXT,
  lead_status              TEXT NOT NULL DEFAULT 'new',
  merchant_contacted_at    TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_concierge_threads_merchant
  ON concierge_threads(merchant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_concierge_threads_lead
  ON concierge_threads(merchant_id, lead_tier, updated_at DESC)
  WHERE lead_tier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_concierge_threads_session
  ON concierge_threads(session_id);
