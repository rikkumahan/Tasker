-- 1. Add tracking for when the user's inbox was last synced to support delta/incremental parsing.
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

-- Note: We allow this to be NULL initially. 
-- The Python/Node engine should fall back to '24 hours ago' if this is null.
