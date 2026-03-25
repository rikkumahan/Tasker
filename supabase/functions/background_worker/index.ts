import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * background_worker/index.ts
 *
 * LAYER 3: The Background Worker (QStash Consumer)
 *
 * Called by Upstash QStash at a controlled rate.
 * This is NOT user-facing — it runs entirely in the background.
 *
 * For QStash to call this, it must be a public endpoint.
 * We verify the call using the QStash signature header.
 */

Deno.serve(async (req: Request) => {
  // ── QStash Signature Verification (Security Critical) ──
  // In production, verify: https://upstash.com/docs/qstash/features/security
  const qstashSig = req.headers.get("Upstash-Signature");
  const qstashToken = Deno.env.get("QSTASH_TOKEN");
  
  // Allow direct service-role calls for pg_cron fallback
  const authHeader = req.headers.get("Authorization");
  const isServiceCall = authHeader?.replace("Bearer ", "") === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!qstashSig && !isServiceCall) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const { user_id } = payload;
    
    if (!user_id) {
      return new Response(JSON.stringify({ error: "Missing user_id" }), { status: 400 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Delegate to the main sync function with service-role credentials
    // This reuses all intelligence logic (update detection, categories, batching)
    const { data, error } = await supabaseAdmin.functions.invoke("sync", {
      body: { user_id }
    });

    if (error) {
      await supabaseAdmin.from("debug_logs").insert({
        user_id,
        event: "BACKGROUND_WORKER_ERR",
        data: { error: error.message }
      });
      // Return 500 so QStash retries this job
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    await supabaseAdmin.from("debug_logs").insert({
      user_id,
      event: "BACKGROUND_WORKER_DONE",
      data: { tasks_extracted: data?.tasks_extracted, remaining: data?.remaining }
    });

    // If there are remaining emails, re-queue immediately for the next batch
    if (data?.remaining > 0 && qstashToken) {
      const workerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/background_worker`;
      await fetch(`https://qstash.upstash.io/v2/publish/${encodeURIComponent(workerUrl)}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${qstashToken}`,
          "Content-Type": "application/json",
          "Upstash-Delay": "5s", // 5s gap between batches → respects rate limit
        },
        body: JSON.stringify({ user_id })
      });
    }

    // Return 200 so QStash marks message as delivered
    return new Response(JSON.stringify({ success: true, ...data }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("background_worker error:", err.message);
    // Return 500 → QStash will retry with exponential backoff
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
