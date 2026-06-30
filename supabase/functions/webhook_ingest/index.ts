import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * webhook_ingest/index.ts — v2 (Native Queue)
 *
 * LAYER 1: Ingestion
 * Receives Gmail Pub/Sub push notifications.
 * Inserts a job into the native sync_queue table (replaces QStash).
 * Then reactively fires background_worker (fire-and-forget).
 * Always acknowledges Google in <200ms.
 */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" }
    });
  }

  try {
    // Google Pub/Sub sends a POST with a base64-encoded message
    const body = await req.json();
    const messageData = body?.message?.data;
    if (!messageData) return new Response("ok", { status: 200 });

    // Decode Pub/Sub payload (with required base64 padding for atob)
    let base64 = messageData.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    if (pad) {
      base64 += "=".repeat(4 - pad);
    }
    const decoded = atob(base64);
    const notification = JSON.parse(decoded);

    // Gmail sends: { emailAddress: "user@gmail.com", historyId: "12345" }
    const { emailAddress, historyId } = notification;
    const normalizedEmail = String(emailAddress || "").trim().toLowerCase();
    if (!normalizedEmail) return new Response("ok", { status: 200 });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("MY_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
    );

    // Call the database function to handle user lookup, queue insert, logging, and debounce check
    const { data: shouldTrigger, error: rpcError } = await supabaseAdmin
      .rpc("ingest_gmail_webhook", {
        p_email: normalizedEmail,
        p_history_id: String(historyId)
      });

    if (rpcError) {
      console.error("ingest_gmail_webhook RPC failed:", rpcError.message);
      // Fallback: trigger worker just in case so tasks don't get stuck
      supabaseAdmin.functions.invoke("background_worker", { body: {} })
        .catch((e: any) => console.warn("Worker trigger fallback failed:", e.message));
    } else if (shouldTrigger) {
      // ── REACTIVE TRIGGER: Wake background_worker immediately ──
      // Fire-and-forget: we do NOT await this — Google's 10s deadline must be met
      supabaseAdmin.functions.invoke("background_worker", { body: {} })
        .catch((e: any) => console.warn("Worker trigger failed:", e.message));
    } else {
      console.log(`[webhook_ingest] Webhook for ${normalizedEmail} debounced or duplicate.`);
    }

    // Critical: Always return 200 so Google doesn't retry
    return new Response("ok", { status: 200 });

  } catch (err: any) {
    console.error("webhook_ingest error:", err.message);
    // Still 200 — never let Google know we failed
    return new Response("ok", { status: 200 });
  }
});
