-- ============================================================
-- 035_bot_training_funnel_dwell.sql
-- Bot training, visitor funnel events, session dwell tracking,
-- hold-your-place timestamps on negotiations.
-- ============================================================

-- ── Bot training instructions ───────────────────────────────────────────────
-- Owner-supplied directives that influence both the LLM (injected into the
-- system prompt) and deterministic product surfacing (collection / tag
-- boost or suppress). Free-form text, parsed once at save time into
-- structured directives stored alongside.
CREATE TABLE IF NOT EXISTS bot_instructions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  -- Free-form text the merchant types ("4th of July coming up — push patriot collection")
  instruction_text TEXT NOT NULL,
  -- Parsed structured directives from the text (LLM at save time)
  -- Shape: [{ type: "boost"|"suppress"|"context_phrase", target_kind, target_value, weight, until }]
  directives      JSONB NOT NULL DEFAULT '[]',
  -- Active instructions are injected into prompts + applied to scoring
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  priority        INTEGER NOT NULL DEFAULT 0,
  -- Optional auto-expiry — owner can set "boost summer until Sep 1"
  expires_at      TIMESTAMPTZ,
  created_by      UUID,            -- merchant user id (auth_uid), for audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_instructions_merchant_active
  ON bot_instructions(merchant_id, active, priority DESC, created_at DESC)
  WHERE active = TRUE;

-- ── Visitor funnel events ──────────────────────────────────────────────────
-- Append-only log of stage transitions per session, drives the dashboard
-- funnel chart and per-visitor drilldown. Stages:
--   arrived | engaged | captured | discovered | negotiated | held | won | checked_out | lost
-- A session can hit each stage at most once (ON CONFLICT DO NOTHING via
-- the unique index) — re-firing the same event is safe.
CREATE TABLE IF NOT EXISTS visitor_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  session_id   TEXT NOT NULL,
  stage        TEXT NOT NULL,
  metadata     JSONB,           -- product url, page type, etc.
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (merchant, session, stage). Re-firing arrived/engaged is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_events_unique
  ON visitor_events(merchant_id, session_id, stage);

CREATE INDEX IF NOT EXISTS idx_visitor_events_merchant_time
  ON visitor_events(merchant_id, created_at DESC);

-- ── Visitor dwell ───────────────────────────────────────────────────────────
-- Per-session, per-product time spent. Updated on widget heartbeat (client
-- sends batches every 30s + on pagehide). Used to boost ranking in the
-- universal product filter — products the customer dwells on appear more
-- often in subsequent recommendations.
CREATE TABLE IF NOT EXISTS visitor_dwell (
  merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL,
  product_handle  TEXT NOT NULL,
  dwell_seconds   INTEGER NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merchant_id, session_id, product_handle)
);

CREATE INDEX IF NOT EXISTS idx_visitor_dwell_session
  ON visitor_dwell(session_id, last_updated_at DESC);

-- TTL — expire dwell records after 7 days. Keeping them longer skews the
-- boost on returning visitors. Run via a daily cron or expression policy.
-- (For now, a manual delete is fine — table will stay small.)

-- ── Hold-your-place ─────────────────────────────────────────────────────────
-- Customer can lock in a negotiated price for 24h. We store the hold
-- timestamp + expiry on the existing negotiation row so we don't create
-- a parallel concept. After expiry the daily won-abandoned cron handles
-- it the same way as any other expired won deal.
ALTER TABLE negotiations
  ADD COLUMN IF NOT EXISTS held_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_negotiations_held
  ON negotiations(merchant_id, hold_expires_at DESC)
  WHERE held_at IS NOT NULL;
