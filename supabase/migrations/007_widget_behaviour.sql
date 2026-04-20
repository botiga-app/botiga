-- Widget behaviour settings
ALTER TABLE merchant_settings
  ADD COLUMN IF NOT EXISTS widget_type      text    DEFAULT 'bubble',
  ADD COLUMN IF NOT EXISTS show_trigger     text    DEFAULT 'always',
  ADD COLUMN IF NOT EXISTS chat_popup_delay integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cart_trigger     text    DEFAULT 'always';

COMMENT ON COLUMN merchant_settings.widget_type      IS 'bubble | button | banner';
COMMENT ON COLUMN merchant_settings.show_trigger     IS 'always | on_scroll | on_exit | on_click';
COMMENT ON COLUMN merchant_settings.chat_popup_delay IS 'Seconds before chat auto-opens (0 = right away)';
COMMENT ON COLUMN merchant_settings.cart_trigger     IS 'always | on_exit';
