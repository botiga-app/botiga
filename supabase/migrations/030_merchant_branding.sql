-- 030_merchant_branding.sql
-- Adds logo_url + theme_color to merchants. Both are auto-detected from
-- the merchant's storefront during onboarding (Step 1: storeDetect parses
-- apple-touch-icon for the logo and the <meta name="theme-color"> for the
-- brand color). Used in the dashboard for visual identity and surfaced
-- in /dashboard/settings → Brand profile.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS theme_color TEXT;
