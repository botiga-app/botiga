-- 029_wipe_test_merchants.sql
--
-- ⚠️  MANUAL SCRIPT — DO NOT AUTO-APPLY ON PRODUCTION DEPLOYS  ⚠️
--
-- One-off cleanup for the demo / test merchants we use to validate the
-- onboarding flow. Run this in the Supabase SQL editor when you want to
-- wipe both accounts and re-test signup from scratch.
--
-- Deletes from every table that references merchants — many older tables
-- don't have ON DELETE CASCADE, so explicit DELETEs are required.
--
-- Edit the email list below if you want to wipe different test accounts.

-- Tables WITHOUT ON DELETE CASCADE (must be deleted explicitly)
DELETE FROM merchant_settings
WHERE merchant_id IN (
  SELECT id FROM merchants
  WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com')
);

DELETE FROM negotiation_rules
WHERE merchant_id IN (
  SELECT id FROM merchants
  WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com')
);

DELETE FROM negotiations
WHERE merchant_id IN (
  SELECT id FROM merchants
  WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com')
);

DELETE FROM admin_alerts
WHERE merchant_id IN (
  SELECT id FROM merchants
  WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com')
);

-- Tables that probably HAVE CASCADE (explicit DELETE is harmless + idempotent)
DELETE FROM video_product_tags
WHERE merchant_id IN (
  SELECT id FROM merchants
  WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com')
);

DELETE FROM video_events
WHERE merchant_id IN (
  SELECT id FROM merchants
  WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com')
);

DELETE FROM video_comments
WHERE video_id IN (
  SELECT id FROM videos
  WHERE merchant_id IN (
    SELECT id FROM merchants
    WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com')
  )
);

DELETE FROM videos
WHERE merchant_id IN (
  SELECT id FROM merchants
  WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com')
);

DELETE FROM clone_jobs
WHERE merchant_id IN (
  SELECT id FROM merchants
  WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com')
);

DELETE FROM store_context_cache
WHERE merchant_id IN (
  SELECT id FROM merchants
  WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com')
);

-- Marketplace tables (skip the line if the table doesn't exist in your schema)
DELETE FROM marketplace_products
WHERE merchant_id IN (
  SELECT id FROM merchants
  WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com')
);

DELETE FROM marketplace_negotiations
WHERE merchant_id IN (
  SELECT id FROM merchants
  WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com')
);

-- Now delete the merchants themselves
DELETE FROM merchants
WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com');

-- Finally, delete auth users so emails are reusable for signup
DELETE FROM auth.users
WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com');

-- ─── Verify the wipe ──────────────────────────────────────────────────────────
-- SELECT email FROM auth.users
-- WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com');
-- SELECT email FROM merchants
-- WHERE email IN ('willowhouse96@gmail.com', 'testerbunny496@gmail.com');
-- Both queries should return zero rows.
