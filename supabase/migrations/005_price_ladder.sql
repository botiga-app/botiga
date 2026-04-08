ALTER TABLE negotiations ADD COLUMN IF NOT EXISTS price_ladder JSONB DEFAULT '[]';
ALTER TABLE negotiations ADD COLUMN IF NOT EXISTS current_step INT DEFAULT 0;
ALTER TABLE negotiations ADD COLUMN IF NOT EXISTS lowball_hold_messages INT DEFAULT 0;
