-- 028_onboarding.sql
-- Tracks merchant onboarding state so /onboarding can resume mid-flow
-- and the dashboard can show a "Finish setup" nudge banner.
--
-- Also backfills any missing merchant_settings rows (some signups during
-- the 2026-05-02 API outage created merchant rows without the companion
-- settings row, which made /dashboard/settings stuck on "Loading...").

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_step TEXT
    CHECK (onboarding_step IS NULL OR onboarding_step IN
      ('store_url', 'install', 'live', 'completed'));

-- Backfill merchant_settings for any merchants missing one
INSERT INTO merchant_settings (merchant_id)
SELECT m.id
FROM merchants m
LEFT JOIN merchant_settings ms ON ms.merchant_id = m.id
WHERE ms.merchant_id IS NULL;
