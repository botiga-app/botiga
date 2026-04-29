-- Draft Order support for multi-item negotiation
-- Each negotiation row tracks the Shopify Draft Order it belongs to
-- and the specific line item ID within that order

ALTER TABLE negotiations
  ADD COLUMN IF NOT EXISTS draft_order_id        TEXT,
  ADD COLUMN IF NOT EXISTS draft_order_line_item_id BIGINT,
  ADD COLUMN IF NOT EXISTS draft_order_invoice_url  TEXT,
  ADD COLUMN IF NOT EXISTS session_token         TEXT;

-- session_token persists across page loads (stored in widget localStorage)
-- Used to find the existing draft order for a session when adding more items
CREATE INDEX IF NOT EXISTS idx_negotiations_session_token ON negotiations(session_token);
CREATE INDEX IF NOT EXISTS idx_negotiations_draft_order_id ON negotiations(draft_order_id);
