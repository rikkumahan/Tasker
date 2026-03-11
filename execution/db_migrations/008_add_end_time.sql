-- 1. Add end_time to track the duration of events explicitly.
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS end_time timestamptz;

-- The 'deadline' column will now internally be treated as the 'start_time' or 'date', 
-- but we keep the name for backwards compatibility.
