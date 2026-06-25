-- Repair webhook queue support used by background_worker.
-- The deployed worker calls reset_stuck_queue_jobs() before claiming jobs; keep
-- that RPC in the migration history so webhook-triggered queues can drain.

CREATE OR REPLACE FUNCTION reset_stuck_queue_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reset_count integer;
BEGIN
  UPDATE sync_queue
  SET status = 'pending',
      error_message = 'Reset after worker timeout',
      updated_at = now(),
      next_retry_at = now()
  WHERE status = 'processing'
    AND updated_at < now() - interval '5 minutes';

  GET DIAGNOSTICS v_reset_count = ROW_COUNT;
  RETURN v_reset_count;
END;
$$;

CREATE INDEX IF NOT EXISTS sync_queue_status_retry_idx
  ON sync_queue (status, next_retry_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS sync_queue_dedup_id_key
  ON sync_queue (dedup_id);

CREATE OR REPLACE FUNCTION claim_next_job()
RETURNS TABLE(id uuid, user_id uuid, retry_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    SET status = 'processing',
        updated_at = now()
    WHERE sq.id = claimed_job.id;

    RETURN QUERY
      SELECT claimed_job.id, claimed_job.user_id, COALESCE(claimed_job.retry_count, 0);
  END IF;

  RETURN;
END;
$$;

