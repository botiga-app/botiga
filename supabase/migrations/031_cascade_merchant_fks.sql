-- 031_cascade_merchant_fks.sql
--
-- Adds ON DELETE CASCADE to every FK that references merchants(id) but
-- doesn't already cascade. Discovered via the test-merchant wipe script
-- in 029 — each missing cascade required adding another explicit DELETE
-- to the wipe chain. This migration fixes the schema so future deletes
-- are just `DELETE FROM merchants WHERE …` and everything below cleans
-- up automatically.
--
-- Tables fixed here (each one drops the existing FK and re-adds with
-- ON DELETE CASCADE):
--   - merchant_settings
--   - negotiation_rules
--   - negotiations
--   - admin_alerts
--
-- If new tables come up (paste of "violates foreign key constraint
-- xxx_merchant_id_fkey on table Y"), append a similar block here.

-- merchant_settings
ALTER TABLE merchant_settings
  DROP CONSTRAINT IF EXISTS merchant_settings_merchant_id_fkey;

ALTER TABLE merchant_settings
  ADD CONSTRAINT merchant_settings_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;

-- negotiation_rules
ALTER TABLE negotiation_rules
  DROP CONSTRAINT IF EXISTS negotiation_rules_merchant_id_fkey;

ALTER TABLE negotiation_rules
  ADD CONSTRAINT negotiation_rules_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;

-- negotiations
ALTER TABLE negotiations
  DROP CONSTRAINT IF EXISTS negotiations_merchant_id_fkey;

ALTER TABLE negotiations
  ADD CONSTRAINT negotiations_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;

-- admin_alerts
ALTER TABLE admin_alerts
  DROP CONSTRAINT IF EXISTS admin_alerts_merchant_id_fkey;

ALTER TABLE admin_alerts
  ADD CONSTRAINT admin_alerts_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;

-- After this migration, future test wipes are just:
--   DELETE FROM merchants WHERE email IN (...);
--   DELETE FROM auth.users WHERE email IN (...);
