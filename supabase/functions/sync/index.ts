import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- LEGACY REGEX PATTERNS (V14 Fallback) ---
const CATEGORY_PATTERNS: Record<string, string> = {
  "Quiz": "\\bquiz\\b",
  "Exam": "\\b(exam|mid.?term|end.?term|final)\\b",
  "Assignment": "\\b(assignment|homework|hw)\\b",
  "Lab": "\\b(lab|practical|experiment)\\b",
  "Submission": "\\b(submit|submission|upload|due)\\b",
  "Project": "\\b(project|capstone|mini.?project)\\b",
  "Deadline": "\\bdeadline\\b",
  "Report": "\\b(report|write.?up|documentation)\\b",
  "Viva": "\\b(viva|oral|defence|defense)\\b",
  "Internals": "\\b(internal|CIA|continuous\\s+assessment)\\b",
};

// ULTRA-SAFE DECODER
function safeDecode(data: string): string {
  try {
    if (!data) return "";
    return atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  } catch (e) {
    return "";
  }
}

function decodeBody(payload: any): string {
  if (!payload) return "";
  let body = "";
  const mime = payload.mimeType || "";
  if (mime === "text/plain") {
    body = safeDecode(payload.body?.data || "");
  } else if (payload.parts) {
    for (const part of payload.parts) {
      const partBody = decodeBody(part);
      if (partBody) {
        body = partBody;
        break;
      }
    }
  }
  return body.trim();
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runLegacyFallback(subject: string, body: string) {
  const text = (subject + " " + body).toLowerCase();
  for (const [cat, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (new RegExp(pattern, "i").test(text)) {
      return {
        title: subject.substring(0, 60),
        category: cat,
        summary: "Extracted via Legacy Regex Fallback (AI was quiet).",
        status: "pending",
        deadline: null // Regex can't reliably guess ISO dates yet
      };
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing Auth" }), { status: 401, headers: corsHeaders });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return new Response(JSON.stringify({ error: "Session Expired" }), { status: 401, headers: corsHeaders });

    const { data: settings } = await supabaseAdmin.from("user_settings").select("*").eq("user_id", user.id).single();
    if (!settings) return new Response(JSON.stringify({ error: "Settings not found" }), { status: 404, headers: corsHeaders });

    // V14 Log Sync Start
    await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "V14_SYNC_START", data: { profile_stage: settings.user_profile } });

    const isNewUser = !settings.last_synced_at || settings.user_profile?.includes("Initial Sync Stage");
    const SARVAM_KEY = Deno.env.get("SARVAM_API_KEY") || settings.secrets?.SARVAM_API_KEY;

    const fetchAllEmails = async (token: string) => {
      const maxResults = isNewUser ? 50 : 10;
      const lastSynced = settings.last_synced_at;
      let query = "";
      // NO PRE-FILTERING (As requested by user)
      if (!isNewUser && lastSynced) {
         const after = Math.floor(new Date(lastSynced).getTime() / 1000);
         query = `&q=after:${after}`;
      }
      const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await listRes.json();
      const messages = data.messages || [];
      
      await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "GMAIL_FETCH", data: { count: messages.length, query } });
      
      return await Promise.all(messages.map(async (m: any) => {
        try {
          const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const fullMsg = await detailRes.json();
          const headers = (fullMsg.payload?.headers || []).reduce((acc: any, h: any) => ({ ...acc, [h.name]: h.value }), {});
          const body = decodeBody(fullMsg.payload).substring(0, 1000).replace(/\n/g, " ").trim();
          return { id: m.id, subject: headers.Subject || "(no subject)", sender: headers.From || "unknown", body };
        } catch (e) { return null; }
      }));
    };

    const gmailToken = settings.gmail_token?.token;
    if (!gmailToken) return new Response(JSON.stringify({ error: "No Gmail Token" }), { status: 400, headers: corsHeaders });

    let emails = (await fetchAllEmails(gmailToken)).filter(e => e !== null);
    let finalTasks = [];

    if (emails.length > 0) {
        // AI EXTRACTION (Attempt 1)
        const extractionResults = await Promise.all(emails.slice(0, 15).map(async (email, idx) => {
          await sleep(500 * (idx % 2));
          try {
            const prompt = `Profile: ${settings.user_profile}. Extract tasks from: [${email.subject}] ${email.body}. JSON ONLY: [{ "title": "...", "deadline": "ISO8601", "summary": "...", "category": "Academic" }]`;
            const exRes = await fetch("https://api.sarvam.ai/v1/chat/completions", {
              method: "POST",
              headers: { "Authorization": `Bearer ${SARVAM_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "sarvam-105b", messages: [{ role: "user", content: prompt }] })
            });
            const exData = await exRes.json();
            const match = (exData.choices?.[0]?.message?.content || "").match(/\[[\s\S]*\]/);
            if (match) {
              return JSON.parse(match[0]).map((t: any) => ({ ...t, user_id: user.id, source_email_id: email.id }));
            }
          } catch (e) { return []; }
          return [];
        }));
        
        finalTasks = extractionResults.flat();

        // REGEX FALLBACK (Attempt 2 - If AI misses anything)
        const seenEmailIds = new Set(finalTasks.map(t => t.source_email_id));
        for (const email of emails) {
          if (!seenEmailIds.has(email.id)) {
            const fallback = runLegacyFallback(email.subject, email.body);
            if (fallback) {
                finalTasks.push({ ...fallback, user_id: user.id, source_email_id: email.id });
                seenEmailIds.add(email.id);
            }
          }
        }
    }

    // MANDATORY ONBOARDING TASK (V14)
    if (isNewUser || finalTasks.length === 0) {
        finalTasks.push({
            title: "🚀 Welcome to Tasker AI (V14)",
            summary: "I've analyzed your recent 50 emails. New tasks appear here as they arrive!",
            category: "Onboarding",
            status: "pending",
            user_id: user.id,
            source_email_id: "onboarding_" + Date.now()
        });
    }

    // Upsert directly with Service Role for maximum reliability
    if (finalTasks.length > 0) {
      await supabaseAdmin.from("tasks").upsert(finalTasks, { onConflict: "source_email_id" });
    }

    await supabaseAdmin.from("user_settings").update({ 
        last_synced_at: new Date().toISOString(),
        user_profile: settings.user_profile.replace(" (Initial Sync Stage)", "") // Graduate from Stage 1
    }).eq("id", settings.id);
    
    return new Response(JSON.stringify({ success: true, count: finalTasks.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
