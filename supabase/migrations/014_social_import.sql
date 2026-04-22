-- Allow s3_key to be null for social-imported videos (they use source_url instead)
ALTER TABLE videos ALTER COLUMN s3_key DROP NOT NULL;
