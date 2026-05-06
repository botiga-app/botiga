-- ============================================================
-- 033_leads_and_plans.sql — Lead surfacing + plan tier gating
-- ============================================================
--
-- Why:
--   Merchants need a dashboard view of negotiations the bot couldn't
--   close ("hot leads") so they can reach out personally. The bot
--   never closes the conversation itself — instead, the system
--   silently flips status when (a) the customer goes idle at floor,
--   or (b) a deal is won but the customer never checks out. Both
--   surface to /dashboard/leads.
--
--   Plan tiers gate how many leads each merchant sees:
--     free:    5 hot / 10 warm / 20 cold
--     starter: 25 / 50 / unlimited
--     pro:     unlimited
--     trial:   behaves as pro until trial_ends_at
--
-- New negotiation status values (status remains TEXT, no enum):
--   - 'human_escalated' — customer reached floor, went idle 5–10min
--                         without accepting; merchant should reach out
--   - 'won_abandoned'   — deal struck but customer never checked out
--                         (verified by absence of Shopify order at T+48h)
--   - 'cold_lead'       — concierge captured contact on site arrival
--                         before any product engagement

-- ── Negotiation columns ──────────────────────────────────────────────────────
ALTER TABLE negotiations
  ADD COLUMN IF NOT EXISTS lead_tier                 TEXT,
  ADD COLUMN IF NOT EXISTS lead_status               TEXT DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS last_customer_message_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_bot_message_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS abandoned_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merchant_contacted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_name             TEXT;

-- lead_tier: 'hot' | 'warm' | 'cold' | NULL (not a lead surface)
-- lead_status: 'new' | 'contacted' | 'converted' | 'dismissed'

-- Earnable revenue is computed live, not stored — but we index the components
CREATE INDEX IF NOT EXISTS idx_negotiations_lead_tier
  ON negotiations(merchant_id, lead_tier, updated_at DESC)
  WHERE lead_tier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_negotiations_status_floor_idle
  ON negotiations(status, current_step, updated_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_negotiations_won_for_abandon
  ON negotiations(status, deal_expires_at)
  WHERE status = 'won';

-- ── Plan tier helper view ────────────────────────────────────────────────────
-- merchants.plan stays TEXT; valid values are 'trial' | 'free' | 'starter' | 'pro'
-- (existing 'paid' rows are migrated to 'starter' below). 'white_label' kept as-is.
UPDATE merchants SET plan = 'starter' WHERE plan = 'paid';

-- ── Lead capture log ─────────────────────────────────────────────────────────
-- Tracks every contact moment so we can build a "lead journey" view later.
-- Separate table (not a column on negotiations) because the same session
-- can capture contact via concierge BEFORE a negotiation row exists.
CREATE TABLE IF NOT EXISTS lead_captures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL,
  negotiation_id  UUID REFERENCES negotiations(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,   -- 'concierge_arrival' | 'price_gate' | 'exit_intent' | 'negotiation'
  capture_step    TEXT NOT NULL,   -- 'contact' | 'name'
  email           TEXT,
  phone           TEXT,
  name            TEXT,
  product_url     TEXT,
  product_name    TEXT,
  list_price      NUMERIC,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_captures_merchant
  ON lead_captures(merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_captures_session
  ON lead_captures(session_id);

-- ── Backfill last_*_message_at on existing rows ──────────────────────────────
-- Best-effort: pull from messages JSONB where possible. Failures are silent.
DO $$
BEGIN
  UPDATE negotiations
  SET last_customer_message_at = COALESCE(last_customer_message_at, updated_at),
      last_bot_message_at      = COALESCE(last_bot_message_at, updated_at)
  WHERE last_customer_message_at IS NULL OR last_bot_message_at IS NULL;
END $$;
