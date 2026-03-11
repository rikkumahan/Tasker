-- 1. Add user_id column to user_settings (linked to Supabase auth.users)
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Default existing row (if any) to a specific user if needed, but safer to just let it be null for now or clear it
-- We will enforce NOT NULL after the fact if required, but for now just add it.

-- 2. Add user_id column to tasks
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. Update RLS Policies for user_settings
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Drop the old overly-permissive anon policy
DROP POLICY IF EXISTS "anon read settings" ON user_settings;

-- Create strict policies bound to auth.uid()
CREATE POLICY "Users can view their own settings" 
ON user_settings FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own settings" 
ON user_settings FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own settings" 
ON user_settings FOR UPDATE 
USING (auth.uid() = user_id);

-- 4. Update RLS Policies for tasks
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Drop the old overly-permissive anon policy
DROP POLICY IF EXISTS "anon read" ON tasks;

-- Create strict policies bound to auth.uid()
CREATE POLICY "Users can view their own tasks" 
ON tasks FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tasks" 
ON tasks FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tasks" 
ON tasks FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tasks" 
ON tasks FOR DELETE 
USING (auth.uid() = user_id);
