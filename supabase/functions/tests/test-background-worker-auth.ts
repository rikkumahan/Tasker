import "https://deno.land/std@0.168.0/dotenv/load.ts";

// ISSUE-5 (TaskerAI/e2e/ISSUES.md) / SUPABASE_LOGIC_BUGS_FINDINGS.md
//
// The `tasker-queue-pulse` cron job (jobid 3, */10 * * * *) calls
// background_worker via net.http_post with only a Content-Type header —
// no apikey/Authorization. This test reproduces that exact call shape
// against the live function to prove the gateway's default JWT
// requirement blocks the one self-healing path for a stuck sync_queue.

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "https://esngoeuhtpdzyfttofyu.supabase.co").trim();

Deno.test("background_worker accepts the cron job's exact unauthenticated call shape", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/background_worker`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }, // matches cron.job jobid 3 verbatim — no apikey/Authorization
    body: "{}",
  });

  const body = await res.json().catch(() => ({}));

  if (res.status === 401) {
    throw new Error(
      `background_worker rejected the cron job's own call shape (${res.status}: ${JSON.stringify(body)}). ` +
      `This is the root cause of ISSUE-4 (stuck onboarding loader) — the 10-min failsafe that's ` +
      `supposed to rescue a stuck sync_queue can never fire. Fix: verify_jwt=false for background_worker ` +
      `(it takes zero parameters and only drains already-enqueued, already-scoped rows), matching the ` +
      `existing webhook_ingest/delete-account pattern.`
    );
  }

  if (res.status !== 200) {
    throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(body)}`);
  }
});
