import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// HELPER: Decode Gmail Base64
function decodeBody(payload: any): string {
  let body = "";
  const mime = payload.mimeType || "";
  if (mime === "text/plain") {
    const data = payload.body?.data || "";
    if (data) body = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  } else if (payload.parts) {
    for (const part of payload.parts) {
      body = decodeBody(part);
      if (body) break;
    }
  }
  return body.trim();
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Missing auth", { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    const { data: settings } = await supabase.from("user_settings").select("*").eq("user_id", user.id).single();
    if (!settings) return new Response("No settings", { status: 404, headers: corsHeaders });

    const CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID") || settings.secrets?.GMAIL_CLIENT_ID;
    const CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET") || settings.secrets?.GMAIL_CLIENT_SECRET;
    const SARVAM_KEY = Deno.env.get("SARVAM_API_KEY") || settings.secrets?.SARVAM_API_KEY;

    // TOKEN REFRESH (Mirrors auto_sync.py)
    async function refreshGmailToken(refreshToken: string) {
      const resp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      if (!resp.ok) throw new Error("Token refresh fail");
      const data = await resp.json();
      return data.access_token;
    }

    let gmailToken = settings.gmail_token.token;
    const refreshToken = settings.gmail_token.refresh_token;

    // FETCH EMAILS (Mirrors auto_sync.py)
    const fetchAllEmails = async (token: string) => {
      const lastSynced = settings.last_synced_at;
      const after = lastSynced
        ? Math.floor(new Date(lastSynced).getTime() / 1000)
        : Math.floor((Date.now() - 48 * 3600 * 1000) / 1000);

      const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=after:${after}&maxResults=25`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!listRes.ok) throw new Error(`Gmail API failure: ${listRes.status}`);
      const { messages } = await listRes.json();
      if (!messages) return [];

      return await Promise.all(messages.map(async (m: any) => {
        try {
          const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const fullMsg = await detailRes.json();
          const headers = fullMsg.payload.headers.reduce((acc: any, h: any) => ({ ...acc, [h.name]: h.value }), {});
          let body = decodeBody(fullMsg.payload);
          body = body.substring(0, 1500).replace(/\n/g, " ").trim();
          return {
            id: m.id,
            subject: headers.Subject || "(no subject)",
            sender: headers.From || "unknown",
            date: headers.Date || "",
            body
          };
        } catch (e) { return null; }
      }));
    };

    let emails = await fetchAllEmails(gmailToken);
    if (!emails.length && refreshToken) {
      // Logic Parity: One retry with refresh if empty (might be expired)
      gmailToken = await refreshGmailToken(refreshToken);
      await supabase.from("user_settings").update({ gmail_token: { ...settings.gmail_token, token: gmailToken } }).eq("id", settings.id);
      emails = await fetchAllEmails(gmailToken);
    }

    const validEmails = emails.filter(e => e !== null);
    if (!validEmails.length) {
      await supabase.from("user_settings").update({ last_synced_at: new Date().toISOString() }).eq("id", settings.id);
      return new Response(JSON.stringify({ success: true, count: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let currentProfile = settings.user_profile;
    let currentCategories = settings.categories;

    // EVOLVE PERSONA (Lines 167-204 Parity)
    if (validEmails.length > 0) {
      const emailBlock = validEmails.slice(0, 10).map(e => `Subject: ${e.subject}\nBody: ${e.body.substring(0, 500)}`).join("\n---\n");
      const personaPrompt = `Update user profile (3-4 sentences) and 5 categories based on:
${emailBlock}
Current Profile: ${currentProfile}
Current Categories: ${currentCategories}
Return ONLY valid JSON: { "user_profile": "...", "categories": [...] }`;

      await sleep(1200); // 1.2s Cooldown
      const personaRes = await fetch("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${SARVAM_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "sarvam-105b", messages: [{ role: "user", content: personaPrompt }] })
      });

      if (personaRes.ok) {
        const pData = await personaRes.json();
        const pContent = pData.choices[0].message.content;
        const pMatch = pContent.match(/\{[\s\S]*\}/);
        if (pMatch) {
          const parsed = JSON.parse(pMatch[0]);
          currentProfile = parsed.user_profile;
          currentCategories = parsed.categories;
          await supabase.from("user_settings").update({ user_profile: currentProfile, categories: currentCategories }).eq("id", settings.id);
        }
      }
    }

    // EXTRACT TASKS (Lines 206-263 Parity)
    const nowIst = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const extractionTasks = validEmails.map(async (email) => {
      const extractionPrompt = `Extract actionable tasks from email. 
CURRENT DATE AND TIME (IST): ${nowIst}
Rule: Do NOT extract tasks whose deadline has already passed before ${nowIst}.
Profile: ${currentProfile}. 
Categories: ${currentCategories}.

Email: ${email.subject} - ${email.body}

Return ONLY a JSON array of objects:
[
  {
    "title": "Short descriptive title",
    "course": "University course name if applicable, else null",
    "deadline": "ISO8601 string (e.g. 2026-03-17T15:00:00). Guess if year is missing.",
    "summary": "1-sentence summary of the task",
    "category": "Pick exactly one from: ${currentCategories}"
  }
]
No markdown. No extra text.`;

      await sleep(1200); // 1.2s Cooldown per email (mirrors Python loop delay)
      try {
        const exRes = await fetch("https://api.sarvam.ai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${SARVAM_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "sarvam-105b", messages: [{ role: "user", content: extractionPrompt }] })
        });
        if (exRes.ok) {
          const exData = await exRes.json();
          const exMatch = exData.choices[0].message.content.match(/\[[\s\S]*\]/);
          if (exMatch) {
            const tasks = JSON.parse(exMatch[0]);
            return tasks.map((t: any) => ({ ...t, user_id: user.id, source_email_id: email.id }));
          }
        }
      } catch (e) { return []; }
      return [];
    });

    const extractionResults = await Promise.all(extractionTasks);
    const finalTasks = extractionResults.flat();

    if (finalTasks.length > 0) {
      await supabase.from("tasks").upsert(finalTasks, { onConflict: "source_email_id" });
    }

    await supabase.from("user_settings").update({ last_synced_at: new Date().toISOString() }).eq("id", settings.id);
    return new Response(JSON.stringify({ success: true, count: finalTasks.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
