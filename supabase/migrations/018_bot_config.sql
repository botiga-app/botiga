ALTER TABLE merchant_settings
  ADD COLUMN IF NOT EXISTS bot_name        text    DEFAULT null,
  ADD COLUMN IF NOT EXISTS bot_greeting    text    DEFAULT null,
  ADD COLUMN IF NOT EXISTS bot_avatar_url  text    DEFAULT null,
  ADD COLUMN IF NOT EXISTS bot_personality text    DEFAULT 'salesy';

COMMENT ON COLUMN merchant_settings.bot_name        IS 'Display name of the chat assistant';
COMMENT ON COLUMN merchant_settings.bot_greeting    IS 'Opening message shown when chat opens';
COMMENT ON COLUMN merchant_settings.bot_avatar_url  IS 'URL to bot avatar image (circular)';
COMMENT ON COLUMN merchant_settings.bot_personality IS 'salesy | friendly | expert | playful';
