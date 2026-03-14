-- Add error logging to user_settings
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS last_sync_error text;

-- Add index to tasks.user_id for faster dashboard loading as we scale
CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);
