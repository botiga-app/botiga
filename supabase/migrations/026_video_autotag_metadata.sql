-- 026_video_autotag_metadata.sql
-- Adds AI auto-tag metadata to video_product_tags so the dashboard can
-- distinguish manual / auto / pending-review tags and surface match
-- confidence to the merchant for human verification.
--
-- Threshold policy (enforced in application code, not DB):
--   score >= 0.5      → match_status = 'auto_tagged' (applied, but reviewable)
--   0.3 <= score < 0.5 → match_status = 'pending_review' (suggestion, awaits approval)
--   score < 0.3       → no row inserted at all (skipped)
-- A merchant manually adding a tag uses match_status = 'manual'.

ALTER TABLE video_product_tags
  ADD COLUMN IF NOT EXISTS match_score numeric(3,2),
  ADD COLUMN IF NOT EXISTS match_status text DEFAULT 'manual'
    CHECK (match_status IN ('manual', 'auto_tagged', 'pending_review', 'rejected')),
  ADD COLUMN IF NOT EXISTS matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS match_reasoning text;

CREATE INDEX IF NOT EXISTS idx_video_tags_status
  ON video_product_tags(merchant_id, match_status)
  WHERE match_status IN ('auto_tagged', 'pending_review');

-- Track whether a video has been processed by the analyzer at all,
-- so we can re-run only on un-analyzed videos.
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS analyzed_at timestamptz,
  ADD COLUMN IF NOT EXISTS analysis_payload jsonb;

CREATE INDEX IF NOT EXISTS idx_videos_unanalyzed
  ON videos(merchant_id, analyzed_at)
  WHERE analyzed_at IS NULL;
