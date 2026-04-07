-- Merchants
CREATE TABLE merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  website_url TEXT,
  api_key TEXT UNIQUE DEFAULT gen_random_uuid(),
  plan TEXT DEFAULT 'trial', -- trial | paid | white_label
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  trial_ends_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
);

-- Merchant bot settings
CREATE TABLE merchant_settings (
  merchant_id UUID REFERENCES merchants(id) PRIMARY KEY,
  tone TEXT DEFAULT 'friendly',
  button_label TEXT DEFAULT 'Make an offer',
  button_color TEXT,
  button_text_color TEXT,
  button_position TEXT DEFAULT 'below-cart',
  max_discount_pct NUMERIC DEFAULT 20,
  floor_price_pct NUMERIC,
  floor_price_fixed NUMERIC,
  broker_fee_pct NUMERIC DEFAULT 25,
  negotiate_on_product BOOLEAN DEFAULT true,
  negotiate_on_cart BOOLEAN DEFAULT true,
  recovery_enabled BOOLEAN DEFAULT true,
  recovery_channel TEXT DEFAULT 'whatsapp',
  bundle_enabled BOOLEAN DEFAULT false,
  video_enabled BOOLEAN DEFAULT false,
  dwell_time_seconds INTEGER DEFAULT 5,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Negotiations
CREATE TABLE negotiations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id),
  session_id TEXT NOT NULL,
  product_url TEXT,
  product_name TEXT,
  list_price NUMERIC NOT NULL,
  floor_price NUMERIC NOT NULL,
  deal_price NUMERIC,
  spread NUMERIC,
  broker_fee NUMERIC,
  status TEXT DEFAULT 'active',
  tone_used TEXT,
  messages JSONB DEFAULT '[]',
  customer_email TEXT,
  customer_whatsapp TEXT,
  checkout_url TEXT,
  deal_expires_at TIMESTAMPTZ,
  recovery_sent_at TIMESTAMPTZ,
  recovered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- LLM traces
CREATE TABLE llm_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id UUID REFERENCES negotiations(id),
  merchant_id UUID REFERENCES merchants(id),
  provider TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  cost_usd NUMERIC,
  prompt TEXT,
  response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recovery attempts
CREATE TABLE recovery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id UUID REFERENCES negotiations(id),
  step INTEGER,
  channel TEXT,
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ
);

-- Admin alerts
CREATE TABLE admin_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id),
  type TEXT,
  message TEXT,
  severity TEXT DEFAULT 'warning',
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_negotiations_merchant ON negotiations(merchant_id);
CREATE INDEX idx_negotiations_session ON negotiations(session_id);
CREATE INDEX idx_negotiations_status ON negotiations(status);
CREATE INDEX idx_llm_traces_negotiation ON llm_traces(negotiation_id);
CREATE INDEX idx_llm_traces_merchant ON llm_traces(merchant_id);
CREATE INDEX idx_recovery_attempts_negotiation ON recovery_attempts(negotiation_id);
CREATE INDEX idx_admin_alerts_merchant ON admin_alerts(merchant_id);
CREATE INDEX idx_admin_alerts_resolved ON admin_alerts(resolved);

-- RLS Policies
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE negotiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_alerts ENABLE ROW LEVEL SECURITY;

-- Merchants can only see their own data
CREATE POLICY "merchants_own_data" ON merchants FOR ALL USING (auth.uid()::text = id::text);
CREATE POLICY "merchant_settings_own" ON merchant_settings FOR ALL USING (
  merchant_id IN (SELECT id FROM merchants WHERE auth.uid()::text = id::text)
);
CREATE POLICY "negotiations_own" ON negotiations FOR ALL USING (
  merchant_id IN (SELECT id FROM merchants WHERE auth.uid()::text = id::text)
);
CREATE POLICY "llm_traces_own" ON llm_traces FOR ALL USING (
  merchant_id IN (SELECT id FROM merchants WHERE auth.uid()::text = id::text)
);
CREATE POLICY "recovery_attempts_own" ON recovery_attempts FOR ALL USING (
  negotiation_id IN (
    SELECT n.id FROM negotiations n
    JOIN merchants m ON n.merchant_id = m.id
    WHERE auth.uid()::text = m.id::text
  )
);
CREATE POLICY "admin_alerts_own" ON admin_alerts FOR ALL USING (
  merchant_id IN (SELECT id FROM merchants WHERE auth.uid()::text = id::text)
);
