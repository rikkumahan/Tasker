-- Migration 021_queue_debounce.sql
-- Optimizes the queue trigger logic to debounce concurrent executions for the same user.

CREATE OR REPLACE FUNCTION public.ingest_gmail_webhook(
  p_email text,
  p_history_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_dedup_id text;
  v_new_job_id uuid;
  v_should_debounce boolean;
END;
$$;

-- Note: Body of ingest_gmail_webhook is fully written below in the actual file.
CREATE OR REPLACE FUNCTION public.ingest_gmail_webhook(
  p_email text,
  p_history_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_dedup_id text;
  v_new_job_id uuid;
  v_should_debounce boolean;
BEGIN
  -- 1. Find user by email
  SELECT user_id INTO v_user_id
  FROM user_settings
  WHERE gmail_email = p_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- 2. Insert into sync_queue with unique constraint check
  v_dedup_id := v_user_id || '_' || p_history_id;
  
  INSERT INTO sync_queue (user_id, dedup_id, status, updated_at)
  VALUES (v_user_id, v_dedup_id, 'pending', now())
  ON CONFLICT (dedup_id) DO NOTHING
  RETURNING id INTO v_new_job_id;

  -- If it was a duplicate, return false (we don't trigger a new worker)
  IF v_new_job_id IS NULL THEN
    RETURN false;
  END IF;

  -- 3. Log the queuing event
  INSERT INTO debug_logs (user_id, event, data)
  VALUES (
    v_user_id,
    'WEBHOOK_QUEUED',
    jsonb_build_object('historyId', p_history_id, 'emailAddress', p_email, 'dedupId', v_dedup_id)
  );

  -- 4. Check if we should debounce triggering the background_worker
  -- A worker is active or was recently triggered if there is another job for this user
  -- in status 'processing' or 'pending' that was updated within the last 30 seconds.
  SELECT EXISTS (
    SELECT 1 FROM sync_queue
    WHERE user_id = v_user_id
      AND status IN ('processing', 'pending')
      AND updated_at > now() - interval '30 seconds'
      AND id != v_new_job_id
  ) INTO v_should_debounce;

  IF v_should_debounce THEN
    -- Log the debounce event for visibility
    INSERT INTO debug_logs (user_id, event, data)
    VALUES (
      v_user_id,
      'WEBHOOK_DEBOUNCED',
      jsonb_build_object('historyId', p_history_id, 'emailAddress', p_email)
    );
    RETURN false;
  END IF;

  RETURN true;
END;
$$;
