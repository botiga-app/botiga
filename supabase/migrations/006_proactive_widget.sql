-- Proactive widget engagement settings
ALTER TABLE merchant_settings
  ADD COLUMN IF NOT EXISTS proactive_delay    integer DEFAULT 7,
  ADD COLUMN IF NOT EXISTS proactive_message  text,
  ADD COLUMN IF NOT EXISTS auto_open_delay    integer DEFAULT 0;

COMMENT ON COLUMN merchant_settings.proactive_delay   IS 'Seconds before proactive message bubble appears above floating button (default 7)';
COMMENT ON COLUMN merchant_settings.proactive_message IS 'Custom message shown in the proactive bubble. NULL = use default copy.';
COMMENT ON COLUMN merchant_settings.auto_open_delay   IS 'Seconds before chat auto-opens. 0 = disabled.';
