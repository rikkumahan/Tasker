-- Finding #17 (SUPABASE_LOGIC_BUGS_FINDINGS.md): claim_next_job, reset_stalled_jobs,
-- and reset_stuck_queue_jobs are internal queue-worker primitives (meant to be called
-- only by background_worker/pg_cron) but were EXECUTE-granted to anon/authenticated.
-- claim_next_job() in particular lets an unauthenticated caller steal a real job and
-- read back its user_id — a direct cross-tenant leak, and repeatable DoS on the queue.
--
-- reset_stalled_jobs is additionally untracked/superseded by reset_stuck_queue_jobs
-- (finding #18) but is revoked here too rather than left reachable while dead.

REVOKE EXECUTE ON FUNCTION public.claim_next_job() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_stalled_jobs() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_stuck_queue_jobs() FROM anon, authenticated;
