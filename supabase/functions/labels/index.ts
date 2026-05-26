import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { refreshGmailToken } from "../_shared/oauth.ts";

/**
 * labels/index.ts
 *
 * Thin proxy: fetches the authenticated user's Gmail labels
 * and returns only user-created labels (type = 'user').
 * System labels (INBOX, SENT, etc.) are excluded since they
 * are handled separately in the wizard UI as predefined options.
 *
 * GET /labels
 * Returns: { labels: [{ id, name }] }
 */
Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Auth" }), { status: 401, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Decode user from JWT
    const tokenStr = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: authData } = await supabaseAdmin.auth.getUser(tokenStr);
    if (!authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = authData.user.id;

    // Fetch stored Gmail token
    const { data: settings } = await supabaseAdmin
      .from("user_settings")
      .select("gmail_token")
      .eq("user_id", userId)
      .single();

    if (!settings?.gmail_token?.token) {
      return new Response(JSON.stringify({ error: "No Gmail token" }), { status: 400, headers: corsHeaders });
    }

    let gmailToken = settings.gmail_token.token;

    // Call Gmail Labels API
    let res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
      headers: { Authorization: `Bearer ${gmailToken}` }
    });

    // Auto-heal expired token
    if (res.status === 401 && settings.gmail_token?.refresh_token) {
      const fresh = await refreshGmailToken(userId, settings.gmail_token.refresh_token, supabaseAdmin);
      if (!fresh) {
        return new Response(JSON.stringify({ error: "Token refresh failed" }), { status: 401, headers: corsHeaders });
      }
      gmailToken = fresh;
      res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
        headers: { Authorization: `Bearer ${gmailToken}` }
      });
    }

    if (!res.ok) {
      const body = await res.text();
      console.error("[LABELS] Gmail API error:", res.status, body);
      return new Response(JSON.stringify({ error: "Gmail API error", status: res.status }), {
        status: 502, headers: corsHeaders
      });
    }

    const data = await res.json();
    const allLabels: any[] = data.labels || [];

    // Return only user-created labels (not system labels like INBOX, SENT, etc.)
    const userLabels = allLabels
      .filter((l: any) => l.type === "user")
      .map((l: any) => ({ id: l.id, name: l.name }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    return new Response(JSON.stringify({ labels: userLabels }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("[LABELS] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: getCorsHeaders(req)
    });
  }
});
