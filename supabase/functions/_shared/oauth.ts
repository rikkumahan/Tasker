// ─────────────────────────────────────────────
// AUTO-HEALING OAUTH PIPELINE
// ─────────────────────────────────────────────
export async function refreshGmailToken(userId: string, refreshToken: string, supabaseAdmin: any): Promise<string | null> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.error(`[OAUTH] CRITICAL ERROR: Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in Edge limits!`);
    return null;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }),
  });

  let data: any;
  try { data = await res.json(); } catch {
    console.error("[OAUTH] Google token endpoint returned non-JSON response");
    return null;
  }
  if (!res.ok) {
    console.warn("[OAUTH] Refresh failed:", data);
    if (data.error === "invalid_grant") {
      // Graceful Revocation: They uninstalled or revoked the app
      await supabaseAdmin.from("user_settings").update({ 
        sync_status: 'REVOKED',
        last_sync_error: "⚠️ Gmail connection expired or revoked. Please reconnect your account in settings."
      }).eq("user_id", userId);
      await supabaseAdmin.from("debug_logs").insert({ user_id: userId, event: "GMAIL_AUTH_REVOKED", data: {} });
    }
    return null;
  }

  if (!data.access_token) {
    console.error("[OAUTH] Google response missing access_token:", JSON.stringify(data));
    return null;
  }

  // Atomic Persistence
  const newGmailTokenObj = { token: data.access_token, refresh_token: refreshToken };
  await supabaseAdmin.from("user_settings")
    .update({ gmail_token: newGmailTokenObj, sync_status: 'ACTIVE', last_sync_error: null })
    .eq("user_id", userId);

  await supabaseAdmin.from("debug_logs").insert({ user_id: userId, event: "GMAIL_TOKEN_REFRESHED", data: {} });
  return data.access_token;
}
