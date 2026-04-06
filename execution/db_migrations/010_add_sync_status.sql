-- Phase 1 of Auto-Healing OAuth Pipeline
-- Graceful Revocation Kill-Switch

ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS sync_status varchar(50) DEFAULT 'ACTIVE';

-- Set all existing rows to 'ACTIVE'
UPDATE user_settings SET sync_status = 'ACTIVE' WHERE sync_status IS NULL;
