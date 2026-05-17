import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sleep } from "../_shared/utils.ts";

/**
 * background_worker/index.ts — v3 (Modular + Optimized Pacing)
 *
 * LAYER 3: The Background Worker
 * Triggered reactively by webhook_ingest (or the 10-min fail-safe cron).
 * Drains the sync_queue in a Greedy Loop until empty, then exits.
 *
 * - Processes one user-batch per iteration (respects 120 RPM via natural sync pacing)
 * - Uses claim_next_job() for concurrency-safe multi-worker safety
 * - Re-queues catchup syncs if sync reports remaining emails
 * - Exponential backoff on failure (10s, 20s, 40s → fail after 3 strikes)
 */

const MAX_RUN_MS = 120_000; // 2 min safety limit (Supabase free tier: 150s)
// 4 keys × 30 RPM = 120 RPM pool. Each sync call takes ~8s (natural pacing).
// PACE_MS is a minimum gap between iterations — sync's wall-clock time provides the real throttle.
const PACE_MS = 100;

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
      // Delegate to sync function via direct fetch to avoid supabase-js header quirks
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const syncRes = await fetch(`${supabaseUrl}/functions/v1/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`
        },
        body: JSON.stringify({ user_id: job.user_id })
      });

      if (!syncRes.ok) {
        const errorBody = await syncRes.text();
        throw new Error(`Sync returned ${syncRes.status}: ${errorBody}`);
      }

      const data = await syncRes.json();

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

        await supabaseAdmin.from("user_settings").update({
          last_sync_error: `❌ Background sync failed after 3 attempts: ${err.message}`
        }).eq("user_id", job.user_id);

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

    // Minimum gap between iterations — sync's ~8s wall-clock provides natural throttle
    await sleep(PACE_MS);
  }

  return new Response(JSON.stringify({ success: true, processed }), {
    headers: { "Content-Type": "application/json" }
  });
});
