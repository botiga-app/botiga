-- Stripe subscription state on merchants. The base columns
-- (stripe_customer_id, stripe_subscription_id, plan, trial_ends_at)
-- have been on this table since 001 — we just need lifecycle fields
-- so the dashboard can show subscription status and renewal date.

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS subscription_status TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS plan_period_end TIMESTAMPTZ;

-- Note: subscription_status values mirror Stripe's:
--   active, trialing, past_due, canceled, unpaid, incomplete,
--   incomplete_expired, paused
