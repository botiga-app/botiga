-- 027_merchant_ig_handle.sql
-- Add ig_handle to merchants so the dashboard's Instagram import flow can
-- default the handle from the merchant profile rather than asking each time.
-- Captured at signup; editable later in /dashboard/settings.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS ig_handle TEXT;
