import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * webhook_ingest/index.ts
 * 
 * LAYER 1: Ingestion
 * Receives Gmail Pub/Sub push notifications.
 * Fetches the email, and publishes a lightweight job to Upstash QStash.
 * Acknowledges Google in <200ms so no retries are triggered.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Google Pub/Sub sends a POST with a base64-encoded message
    const body = await req.json();
    const messageData = body?.message?.data;
    if (!messageData) {
      // Not a valid Pub/Sub message — acknowledge and ignore
      return new Response("ok", { status: 200 });
    }

    // Decode the Pub/Sub message
    const decoded = atob(messageData.replace(/-/g, "+").replace(/_/g, "/"));
    const notification = JSON.parse(decoded);
    
    // Gmail Pub/Sub sends: { emailAddress: "user@gmail.com", historyId: "12345" }
    const { emailAddress, historyId } = notification;
    if (!emailAddress) return new Response("ok", { status: 200 });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Look up which user this email belongs to
    const { data: userSettings } = await supabaseAdmin
      .from("user_settings")
      .select("user_id, gmail_token")
      .eq("gmail_email", emailAddress)
      .single();

    if (!userSettings) {
      // Unknown user — acknowledge and ignore safely
      return new Response("ok", { status: 200 });
    }

    // ── LAYER 2: Publish to QStash (Rate Flattener) ──
    const qstashToken = Deno.env.get("QSTASH_TOKEN");
    const workerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/background_worker`;

    if (!qstashToken) {
      // QStash not configured — fall back to direct sync call
      await supabaseAdmin.functions.invoke("sync", {
        body: { user_id: userSettings.user_id }
      });
      return new Response("ok", { status: 200 });
    }

    // Publish job to QStash — QStash will call background_worker at a controlled rate
    await fetch(`https://qstash.upstash.io/v2/publish/${encodeURIComponent(workerUrl)}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${qstashToken}`,
        "Content-Type": "application/json",
        // Deduplication: Same historyId from same user won't be queued twice
        "Upstash-Deduplication-Id": `${userSettings.user_id}_${historyId}`,
        // Delay 2s to allow Gmail to index the new email
        "Upstash-Delay": "2s",
      },
      body: JSON.stringify({ user_id: userSettings.user_id })
    });

    await supabaseAdmin.from("debug_logs").insert({
      user_id: userSettings.user_id,
      event: "WEBHOOK_QUEUED",
      data: { historyId, emailAddress }
    });

    // Critical: Acknowledge Google immediately so it doesn't retry
    return new Response("ok", { status: 200 });

  } catch (err: any) {
    console.error("webhook_ingest error:", err.message);
    // Still return 200 to prevent Google from hammering us with retries
    return new Response("ok", { status: 200 });
  }
});
