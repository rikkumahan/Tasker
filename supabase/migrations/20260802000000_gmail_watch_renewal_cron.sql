-- Gmail push-notification watches expire after 7 days regardless of activity.
-- registerGmailWatch was previously only called on interactive login (onboarding
-- or a fresh providerToken), never on cron-driven background syncs — so any user
-- who didn't re-login within 7 days silently stopped receiving push notifications,
-- sync_queue stopped getting new jobs for them, and task ingestion stalled with no
-- error surfaced anywhere. 6 accounts were found stale 5-43 days on 2026-08-02.
--
-- Fix: daily cron re-registers every ACTIVE user's watch via renew_gmail_watches,
-- well inside the 7-day expiry window. No per-user expiry tracking needed.

SELECT cron.schedule(
  'tasker-gmail-watch-renewal',
  '0 3 * * *', -- daily at 03:00 UTC, off-peak
  $$
  SELECT net.http_post(
    url     := 'https://esngoeuhtpdzyfttofyu.supabase.co/functions/v1/renew_gmail_watches',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);
