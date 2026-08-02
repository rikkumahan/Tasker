import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { refreshGmailToken, registerGmailWatch } from "../_shared/oauth.ts";

/**
 * renew_gmail_watches/index.ts
 *
 * Gmail's push-notification watch (registered in sync/index.ts's
 * registerGmailWatch) expires after 7 days regardless of activity, and was
 * previously only ever (re-)registered when a client sent a fresh
 * providerToken — i.e. on interactive login. Users who don't re-login
 * within the window stop receiving push notifications, sync_queue never
 * gets new jobs for them, and task ingestion silently stops.
 *
 * Triggered daily by pg_cron (tasker-gmail-watch-renewal), well inside the
 * 7-day window, so no per-user expiry tracking is needed — just renew
 * every ACTIVE user's watch every day.
 */

Deno.serve(async (_req: Request) => {
  const supabaseAdmin = createClient(
    (Deno.env.get("SUPABASE_URL") ?? "").trim(),
    ((Deno.env.get("MY_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "").trim()
  );

  const { data: users, error } = await supabaseAdmin
    .from("user_settings_decrypted")
    .select("user_id, gmail_token")
    .eq("sync_status", "ACTIVE");

  if (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
  }

  let renewed = 0;
  let failed = 0;

  for (const u of users ?? []) {
    try {
      const refreshToken = u.gmail_token?.refresh_token;
      if (!refreshToken) { failed++; continue; }

      const accessToken = await refreshGmailToken(u.user_id, refreshToken, supabaseAdmin);
      if (!accessToken) { failed++; continue; } // refreshGmailToken already logs/marks REVOKED on invalid_grant

      await registerGmailWatch(accessToken, supabaseAdmin, u.user_id);
      renewed++;
    } catch (e: any) {
      // One user's network blip shouldn't skip every remaining user in the batch —
      // it self-heals next day either way, but no reason to lose the rest of today's run.
      failed++;
      console.error(`[renew_gmail_watches] user ${u.user_id} failed:`, e.message);
    }
  }

  return new Response(JSON.stringify({ success: true, renewed, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
