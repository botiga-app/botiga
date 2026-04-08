-- Brand value statements for merchants
ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS brand_value_statements JSONB DEFAULT '[]';

-- Customer insights captured during negotiation
ALTER TABLE negotiations ADD COLUMN IF NOT EXISTS customer_insights JSONB DEFAULT '[]';

-- Training data table — every message pair logged for future model training
CREATE TABLE IF NOT EXISTS negotiations_training (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id UUID REFERENCES negotiations(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  message_index INT NOT NULL,
  customer_message TEXT,
  customer_offer NUMERIC,
  bot_message TEXT,
  bot_price NUMERIC,
  pricing_action TEXT, -- anchor | concede | hold | deal
  customer_price_movement NUMERIC, -- positive = customer moved toward bot
  brand_statement_used TEXT,
  outcome TEXT DEFAULT 'active', -- active | won | lost | human_escalated
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_merchant ON negotiations_training(merchant_id);
CREATE INDEX IF NOT EXISTS idx_training_negotiation ON negotiations_training(negotiation_id);
CREATE INDEX IF NOT EXISTS idx_training_outcome ON negotiations_training(outcome);
