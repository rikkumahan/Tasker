-- 016_dashboard_schema.sql
-- Adds UI columns to the threads table for the new WorkHub-style dashboard

ALTER TABLE public.threads 
  ADD COLUMN IF NOT EXISTS urgency TEXT DEFAULT 'LOW',
  ADD COLUMN IF NOT EXISTS action_type TEXT DEFAULT 'view',
  ADD COLUMN IF NOT EXISTS ai_summary TEXT,
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS action_items JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suggested_reply TEXT;

-- Indexes to support blazing fast sidebar counts
CREATE INDEX IF NOT EXISTS idx_threads_user_is_read ON public.threads(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_threads_user_urgency ON public.threads(user_id, urgency);
