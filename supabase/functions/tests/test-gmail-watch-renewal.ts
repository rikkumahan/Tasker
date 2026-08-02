import "https://deno.land/std@0.168.0/dotenv/load.ts";

// Gmail watch renewal gap (found post-audit, 2026-08-02): registerGmailWatch was
// only ever called on interactive login, never on cron-driven background syncs,
// so a user's push subscription silently expired after 7 days with no error
// surfaced anywhere. renew_gmail_watches (called daily by cron job
// tasker-gmail-watch-renewal) closes this, and — same as background_worker —
// must accept the cron job's exact headerless net.http_post call shape.

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "https://esngoeuhtpdzyfttofyu.supabase.co").trim();

Deno.test("renew_gmail_watches accepts the cron job's exact unauthenticated call shape", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/renew_gmail_watches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }, // matches pg_cron's net.http_post verbatim — no apikey/Authorization
    body: "{}",
  });

  const body = await res.json().catch(() => ({}));

  if (res.status === 401) {
    throw new Error(
      `renew_gmail_watches rejected the cron job's own call shape (${res.status}: ${JSON.stringify(body)}). ` +
      `Fix: verify_jwt=false (it takes zero parameters and only iterates ACTIVE users server-side), ` +
      `matching the background_worker/webhook_ingest pattern.`
    );
  }

  if (res.status !== 200) {
    throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
  }

  if (typeof body.renewed !== "number" || typeof body.failed !== "number") {
    throw new Error(`Response missing renewed/failed counts: ${JSON.stringify(body)}`);
  }
});
