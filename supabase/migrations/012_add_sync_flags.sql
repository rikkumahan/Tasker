-- ============================================================
-- Migration: 012_add_sync_flags
-- Description: Adds wizard sync preferences, async onboarding
--              status tracking, and priority queue support for
--              the new thread-first GraphRAG onboarding pipeline.
-- ============================================================

-- ── 1. user_settings: wizard preferences + async status ──
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS sync_flags         JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS onboarding_status  TEXT  DEFAULT NULL,  -- null | 'queued' | 'processing' | 'complete'
  ADD COLUMN IF NOT EXISTS onboarding_progress JSONB DEFAULT '{}'; -- { threads_total, threads_done, eta_seconds, queue_position }

-- ── 2. sync_queue: priority column ──
ALTER TABLE sync_queue
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal'; -- 'normal' | 'onboarding'

-- Index for priority ordering
CREATE INDEX IF NOT EXISTS sync_queue_priority_idx
  ON sync_queue (priority, created_at ASC)
  WHERE status = 'pending';

-- ── 3. Replace claim_next_job: onboarding jobs jump the queue ──
DROP FUNCTION IF EXISTS claim_next_job();

CREATE OR REPLACE FUNCTION claim_next_job()
RETURNS TABLE(id uuid, user_id uuid, retry_count int)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  claimed_job RECORD;
BEGIN
  SELECT sq.id, sq.user_id, sq.retry_count
  INTO claimed_job
  FROM sync_queue sq
  WHERE sq.status = 'pending'
    AND (sq.next_retry_at IS NULL OR sq.next_retry_at <= now())
  ORDER BY
    CASE WHEN sq.priority = 'onboarding' THEN 0 ELSE 1 END ASC,
    sq.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF FOUND THEN
    UPDATE sync_queue sq
    SET status     = 'processing',
        updated_at = now()
    WHERE sq.id = claimed_job.id;

    RETURN QUERY
      SELECT claimed_job.id, claimed_job.user_id, claimed_job.retry_count;
  END IF;
  RETURN;
END;
$$;

-- ── 4. Helper: queue_position for onboarding wait screen ──
-- Returns how many onboarding jobs are ahead of the given user.
CREATE OR REPLACE FUNCTION get_onboarding_queue_position(p_user_id uuid)
RETURNS int
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT COUNT(*)::int
  FROM sync_queue
  WHERE status = 'pending'
    AND priority = 'onboarding'
    AND user_id != p_user_id
    AND created_at < (
      SELECT created_at FROM sync_queue
      WHERE user_id = p_user_id AND priority = 'onboarding'
      ORDER BY created_at DESC
      LIMIT 1
    );
$$;
