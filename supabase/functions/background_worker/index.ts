import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * background_worker/index.ts — v2 (Greedy Native Queue Drain)
 *
 * LAYER 3: The Background Worker
 * Triggered reactively by webhook_ingest (or the 10-min fail-safe cron).
 * Drains the sync_queue in a Greedy Loop until empty, then exits.
 *
 * - Processes one user-batch per iteration (respects 180 RPM via 333ms sleep)
 * - Uses claim_next_job() for concurrency-safe multi-worker safety
 * - Re-queues catchup syncs if sync reports remaining emails
 * - Exponential backoff on failure (10s, 20s, 40s → fail after 3 strikes)
 */

const MAX_RUN_MS = 120_000; // 2 min safety limit (Supabase free tier: 150s)
const PACE_MS = 200;        // 300 RPM = 1 request per 200ms (5 keys)

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.serve(async (req: Request) => {
  // Draining the queue is completely safe to trigger externally since it requires zero parameters and only executes authenticated queue rows natively.

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // ── Fail-safe: reset any jobs stuck in 'processing' >5 mins ──
  await supabaseAdmin.rpc("reset_stuck_queue_jobs");

  const startTime = Date.now();
  let processed = 0;

  // ── THE GREEDY DRAIN LOOP ──
  while (Date.now() - startTime < MAX_RUN_MS) {
    // Atomically claim the next pending job
    const { data: jobs } = await supabaseAdmin.rpc("claim_next_job");
    const job = jobs?.[0];

    if (!job) break; // Queue is empty — exit cleanly (Zero Waste)

    try {
      // Delegate to sync function (all intelligence stays there)
      const { data, error } = await supabaseAdmin.functions.invoke("sync", {
        body: { user_id: job.user_id }
      });

      if (error) throw new Error(error.message);

      // Success: mark job done
      await supabaseAdmin.from("sync_queue")
        .update({ status: "done" })
        .eq("id", job.id);

      await supabaseAdmin.from("debug_logs").insert({
        user_id: job.user_id,
        event: "WORKER_DONE",
        data: { tasks_extracted: data?.tasks_extracted, remaining: data?.remaining }
      });

      // Catchup Prime: if sync reports more emails to process, re-enqueue
      // This drains a new user's historical inbox without blocking other users
      if (data?.remaining > 0) {
        const catchupDedupId = `${job.user_id}_catchup_${Date.now()}`;
        await supabaseAdmin.from("sync_queue")
          .insert({ user_id: job.user_id, dedup_id: catchupDedupId })
          .select(); // suppress error if dedup collision
      }

      processed++;

    } catch (err: any) {
      const retries = (job.retry_count ?? 0) + 1;
      const backoffSecs = Math.min(Math.pow(2, retries) * 10, 3600); // max 1hr

      if (retries >= 3) {
        // Dead Letter: log and abandon after 3 strikes
        await supabaseAdmin.from("sync_queue").update({
          status: "failed",
          error_message: err.message
        }).eq("id", job.id);

        await supabaseAdmin.from("debug_logs").insert({
          user_id: job.user_id,
          event: "WORKER_FAILED",
          data: { error: err.message, retries }
        });
      } else {
        // Exponential backoff: retry after 10s, 20s, 40s
        await supabaseAdmin.from("sync_queue").update({
          status: "pending",
          retry_count: retries,
          next_retry_at: new Date(Date.now() + backoffSecs * 1000).toISOString(),
          error_message: err.message
        }).eq("id", job.id);
      }
    }

    // Pace to 180 RPM (3 keys × 60 RPM = 1 call per 333ms)
    await sleep(PACE_MS);
  }

  return new Response(JSON.stringify({ success: true, processed }), {
    headers: { "Content-Type": "application/json" }
  });
});
