-- Migration 009: Add sync trigger tracking column
-- This allows the frontend to know when a sync was last requested
-- so it can show a countdown and prevent button spam.

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS last_sync_triggered_at timestamptz;

-- Also confirm end_time exists on tasks (from migration 008)
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS end_time timestamptz;
