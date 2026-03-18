import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Missing Authorization header", { status: 401 });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // 1. Get user from JWT
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response("Unauthorized", { status: 401 });

    // 2. Fetch user settings (and secrets)
    const { data: settings, error: settingsError } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (settingsError || !settings) return new Response("User settings not found", { status: 404 });

    // SECRETS FALLBACK (for automated setup)
    const CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID") || settings.secrets?.GMAIL_CLIENT_ID;
    const CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET") || settings.secrets?.GMAIL_CLIENT_SECRET;
    const SARVAM_KEY = Deno.env.get("SARVAM_API_KEY") || settings.secrets?.SARVAM_API_KEY;

    async function refreshGmailToken(refreshToken: string) {
      if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("Missing Google Client ID/Secret");
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

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Token refresh failed: ${err}`);
      }

      const data = await resp.json();
      return data.access_token;
    }

    // 3. Authenticate & Fetch Emails
    let gmailToken = settings.gmail_token.token;
    const refreshToken = settings.gmail_token.refresh_token;

    const fetchEmails = async (token: string) => {
      const lastSynced = settings.last_synced_at;
      const afterParam = lastSynced 
          ? Math.floor(new Date(lastSynced).getTime() / 1000) 
          : Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
      
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=after:${afterParam}&maxResults=15`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res;
    };

    let gmailRes = await fetchEmails(gmailToken);

    // 4. Token Refresh Handshake
    if (gmailRes.status === 401 && refreshToken) {
      console.log("[INFO] Token expired, attempting refresh...");
      try {
        gmailToken = await refreshGmailToken(refreshToken);
        // Save new token back to DB for next time
        await supabase.from("user_settings").update({
          gmail_token: { ...settings.gmail_token, token: gmailToken }
        }).eq("id", settings.id);
        
        gmailRes = await fetchEmails(gmailToken);
      } catch (e) {
        console.error("[ERROR] Refresh failed:", e);
      }
    }

    if (!gmailRes.ok) throw new Error(`Gmail API fail: ${await gmailRes.text()}`);

    const { messages } = await gmailRes.json();
    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "Clean inbox!" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 5. Build context & Extract
    const emailDetails = await Promise.all(
      messages.map(async (m: any) => {
        try {
          const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
             headers: { Authorization: `Bearer ${gmailToken}` }
          });
          const fullMsg = await detailRes.json();
          const headers = fullMsg.payload.headers;
          const subject = (headers.find((h: any) => h.name === "Subject")?.value || "(no subject)").substring(0, 100);
          
          let body = "";
          const extractBody = (part: any) => {
            if (part.mimeType === "text/plain" && part.body?.data) {
              const safeB64 = part.body.data.replace(/-/g, "+").replace(/_/g, "/");
              body += atob(safeB64);
            } else if (part.parts) {
              part.parts.forEach(extractBody);
            }
          };
          if (fullMsg.payload) extractBody(fullMsg.payload);
          
          return { 
            id: m.id, 
            subject, 
            body: body.substring(0, 700).replace(/\n/g, " ").trim() 
          };
        } catch (e) {
          console.error(`[WARNING] Failed to fetch email ${m.id}:`, e);
          return null;
        }
      })
    );

    const validEmails = emailDetails.filter(e => e !== null);
    if (validEmails.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No readable emails found" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const emailBlock = validEmails.map(e => `ID: ${e.id}\nSub: ${e.subject}\nBody: ${e.body}...`).join("\n---\n");
    
    const extractionPrompt = `Update user_profile and categories based on these NEW emails. Then extract tasks.
Emails:
${emailBlock}

Current Profile: ${settings.user_profile}
Current Categories: ${settings.categories}

Return ONLY this JSON:
{
  "user_profile": "...",
  "categories": ["cat1", "..."],
  "tasks": [
    {
      "source_email_id": "...",
      "title": "...",
      "deadline": "ISO8601 no Z",
      "summary": "...",
      "category": "Pick from updated categories"
    }
  ]
}
Rules: 
- Skip passed deadlines.
- If email is purely info/spam, skip it.
- No markdown.`;

    const sarvamRes = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${SARVAM_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "sarvam-105b", messages: [{ role: "user", content: extractionPrompt }] })
    });

    if (sarvamRes.ok) {
       const sarvamData = await sarvamRes.json();
       const content = sarvamData.choices[0].message.content;
       const parsedMatch = content.match(/\{[\s\S]*\}/);
       if (parsedMatch) {
          const parsed = JSON.parse(parsedMatch[0]);

          // Atomic update of profile and categories
          if (parsed.user_profile && parsed.categories) {
            await supabase.from("user_settings").update({
                user_profile: parsed.user_profile,
                categories: parsed.categories
            }).eq("id", settings.id);
          }

          if (parsed.tasks && Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
            const finalTasks = parsed.tasks.map((t: any) => ({ ...t, user_id: user.id, status: 'pending' }));
            await supabase.from("tasks").upsert(finalTasks, { onConflict: "source_email_id" });
            
            // Simple warning logic: if deadline is tomorrow, add a warning
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];
            
            for (const t of finalTasks) {
               if (t.deadline && t.deadline.startsWith(tomorrowStr)) {
                  await supabase.from("tasks").update({
                     warnings: ["Upcoming tomorrow"]
                  }).eq("source_email_id", t.source_email_id);
               }
            }
          }
       }
    }

    // Update synced timestamp
    await supabase.from("user_settings").update({ 
      last_synced_at: new Date().toISOString(),
      last_sync_error: null 
    }).eq("id", settings.id);

    return new Response(JSON.stringify({ success: true, count: validEmails.length }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("[ERROR]", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
