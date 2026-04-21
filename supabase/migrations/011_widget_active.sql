-- Add visibility toggle to video widgets
ALTER TABLE video_widgets ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
