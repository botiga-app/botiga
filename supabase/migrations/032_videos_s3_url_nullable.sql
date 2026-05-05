-- 032_videos_s3_url_nullable.sql
-- Allow videos.s3_url to be NULL so Instagram photo posts can be imported.
-- Migration 014 dropped NOT NULL on s3_key but left it on s3_url, which
-- broke photo imports (photos have a thumbnail_url but no video URL).
-- The widget already falls back to <img src=thumbnail_url> when s3_url
-- is null, so there's no rendering risk in relaxing this constraint.

ALTER TABLE videos ALTER COLUMN s3_url DROP NOT NULL;
