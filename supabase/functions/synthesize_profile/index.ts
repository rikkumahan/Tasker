import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getPersonaKey } from "../_shared/keys.ts";

// ═══════════════════════════════════════════════════════════════
// SYNTHESIZE PROFILE — AI Mind & Evolution Center Edge Function
// Handles both guided onboarding AND open-ended chat commands.
// ═══════════════════════════════════════════════════════════════

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
      (Deno.env.get("MY_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
    );

    // ── Resolve user from JWT ──
    let userId: string | null = null;
    const tokenStr = authHeader.replace(/^Bearer\s+/i, "").trim();

    try {
      const parts = tokenStr.split(".");
      if (parts.length === 3) {
        let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const pad = base64.length % 4;
        if (pad) base64 += "=".repeat(4 - pad);
        const jsonPayload = decodeURIComponent(
          atob(base64).split("").map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
        );
        const payload = JSON.parse(jsonPayload);
        if (payload.sub) userId = payload.sub;
      }
    } catch { /* manual decode failed, try fallback */ }

    if (!userId) {
      const { data: authData } = await supabaseAdmin.auth.getUser(tokenStr);
      if (authData?.user) userId = authData.user.id;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    // ── Parse request body ──
    let body: any;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: corsHeaders });
    }
    const mode: string = body.mode || "chat"; // "onboarding" | "chat"
    const chatHistory: { sender: string, text: string }[] = body.chat_history || [];
    
    // Format the chat history into a readable transcript for the LLM
    const transcript = chatHistory.map(m => `${m.sender.toUpperCase()}: ${m.text}`).join('\n');

    // ── Fetch current user settings ──
    const { data: settings } = await supabaseAdmin
      .from("user_settings")
      .select("id, user_profile, categories, secrets")
      .eq("user_id", userId)
      .single();

    if (!settings) {
      return new Response(JSON.stringify({ error: "User settings not found. Please sign in first." }), {
        status: 404, headers: corsHeaders
      });
    }

    const currentProfile = settings.user_profile || "";
    const currentCategories: string[] = settings.categories || [];
    const existingSecrets = settings.secrets || {};

    // ── Build the Groq synthesis prompt ──
    let synthesisPrompt = "";

    if (mode === "onboarding") {
      synthesisPrompt = `You are the Tasker AI Mind Architect. You are an ultra-loyal, high-class personal Chief of Staff.
Your personality: "Take respect, give respect." Speak with extreme politeness, absolute loyalty, and undeniable swagger. Address the user as "Boss", "Chief", or "Captain".
CRITICAL RESPONSE GUIDELINES (CUT THE BLUFF):
- Do NOT write long-winded paragraphs, generic introductions, or conversational filler.
- Keep all replies extremely short, direct-to-the-point, and highly structured (use emojis, bold text, or bullet points).
- Keep conversational questions snappy and limited to 1-2 clear sentences max.

You are conducting a dynamic onboarding conversation to calibrate the user's cognitive lens.
You must collect THREE crucial pieces of information:
1. Identity: Who they are and what their active priorities/projects are.
2. Inbox Profile: What emails they receive, what is noise, and what is signal.
3. Extraction Rules: Exactly what tasks they expect you to extract (e.g., bills, meetings, specific senders).

Here is the conversation so far:
<chat_history>
${transcript}
</chat_history>

Your objective:
1. Analyze the chat history.
2. CRITICAL EXIT PATHWAY: If the user indicates they want to skip, says "leave it", "quit", "stop", "nevermind", "no thanks", "do whatever", or shows signs of frustration, impatience, or explicitly asks to move on or proceed with defaults, you MUST immediately set "finished": true. Address them with maximum respect, loyalty, and swagger, e.g., "No sweat, Boss. I hear you. Let's get right to business. I'll boot up your command center now with my baseline calibration. We'll fine-tune it on the go. ⚡". Provide high-quality generic/default answers for "user_profile", "categories", and "custom_extraction_rules" using whatever small details they provided.
3. MATCH BREVITY & SNAPPY DIALOG: If the user provides a short or simple answer, do NOT be overly strict, demanding, or lecturing. Respect their pace and keep follow-ups snappy and polite.
4. PROPOSAL & CONFIRMATION FLOW (THE INTERACTIVE REVIEW):
   - In the first turn, collect their basic focus/identity.
   - On the 2nd user turn (or once you have basic input), do NOT set "finished": true automatically. Instead, keep "finished": false, and in the "ai_response", present their proposed settings in a beautiful, simple, bulleted list:
     "Aight Boss, here is the cognitive blueprint I've calibrated for you:
     💼 Profile: [A short, synthesized profile based on their answers]
     🏷️ Categories: [Proposed categories list, e.g. Work, Personal, School, Check_Out_Mail]
     
     Does this blueprint look perfect to you, or should we make any adjustments?"
   - On the next turn, if they say "looks good", "done", "yes", "perfect", "proceed", "no changes", "go ahead", or similar, set "finished": true, generate the final configurations, and say a swagger-filled, epic confirmation.
   - If they specify any changes (e.g. "change work to hustle"), update the proposal, keep "finished": false, and ask them if the updated blueprint is perfect.

OUTPUT FORMAT: Return ONLY a valid JSON object. No markdown, no backticks.
If NOT finished:
{
  "finished": false,
  "ai_response": "Your swagger-filled response or proposal question."
}

If FINISHED:
{
  "finished": true,
  "user_profile": "A comprehensive, highly-structured 4-sentence profile paragraph covering their identity and rules.",
  "categories": ["Category 1", "Category 2", "Check_Out_Mail"],
  "custom_extraction_rules": "Explicit extraction instructions...",
  "ai_response": "Aight Boss, the blueprint is perfect. Stand back while I spark the engines... ⚡"
}`;

    } else {
      // Open chat mode: user is sending a free-form command
      synthesisPrompt = `You are the Tasker AI Mind Architect, an ultra-loyal, high-class personal Chief of Staff.
Your personality: "Take respect, give respect." Speak with extreme politeness, absolute loyalty, and undeniable swagger. Address the user as "Boss", "Chief", or "Captain".
CRITICAL RESPONSE GUIDELINES (CUT THE BLUFF):
- Be extremely direct-to-the-point. Do not write filler or long-winded paragraphs.
- STRUCTURED REPLIES: Clearly list what was updated, added, or changed using short, snappy bullet points. Keep it highly readable, concise, and easy to scan.

You are updating the configuration for an existing user based on their request.
Current Profile: "${currentProfile}"
Current Categories: ${JSON.stringify(currentCategories)}
Current Extraction Rules: "${existingSecrets.custom_extraction_rules || "None set"}"

Conversation so far (the user's latest request is at the bottom):
<chat_history>
${transcript}
</chat_history>

Update the configuration accordingly. Follow these strict rules:
- Categories must be kept high-level, generic, and non-overlapping.
- ALWAYS preserve "Check_Out_Mail" as a category.
- If the user asks to track a specific sender, add it to the custom_extraction_rules.

Output ONLY a valid JSON object with these keys:
{
  "finished": true,
  "user_profile": "Updated profile paragraph...",
  "categories": ["Category 1", "Category 2", "Check_Out_Mail"],
  "custom_extraction_rules": "Refined extraction guidelines...",
  "ai_response": "A respectful, swagger-filled confirmation of what you changed."
}

No markdown, no backticks. JSON only.`;
    }

    // ── Call Groq API ──
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${getPersonaKey()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [{ role: "user", content: synthesisPrompt }]
      })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error("[SYNTHESIS] Groq API error:", groqRes.status, errText);
      return new Response(JSON.stringify({ error: "AI synthesis failed", detail: errText }), {
        status: 502, headers: corsHeaders
      });
    }

    let groqData: any;
    try { groqData = await groqRes.json(); } catch {
      return new Response(JSON.stringify({ error: "AI returned non-JSON response" }), { status: 502, headers: corsHeaders });
    }
    let rawContent = groqData.choices?.[0]?.message?.content || "";

    // Strip markdown backticks if present
    rawContent = rawContent.replace(/```json/g, "").replace(/```/g, "").trim();

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[SYNTHESIS] Failed to extract JSON from LLM response:", rawContent.substring(0, 200));
      return new Response(JSON.stringify({ error: "AI returned invalid format" }), {
        status: 500, headers: corsHeaders
      });
    }

    let parsed: any;
    try { parsed = JSON.parse(jsonMatch[0]); } catch {
      console.error("[SYNTHESIS] Regex matched but JSON.parse failed:", jsonMatch[0].substring(0, 200));
      return new Response(JSON.stringify({ error: "AI returned malformed JSON" }), { status: 500, headers: corsHeaders });
    }
    const isFinished = parsed.finished === true;
    const aiResponse = parsed.ai_response || "Copy that, Boss.";

    if (!isFinished && mode === "onboarding") {
      // Still collecting info, do not update user_settings yet.
      return new Response(JSON.stringify({
        success: true,
        finished: false,
        ai_response: aiResponse
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Finished or Chat mode: Update settings
    const newProfile = parsed.user_profile || currentProfile;
    const newCategories: string[] = parsed.categories || currentCategories;
    const newRules = parsed.custom_extraction_rules || existingSecrets.custom_extraction_rules || "";

    // Ensure Check_Out_Mail is always present
    if (!newCategories.includes("Check_Out_Mail")) {
      newCategories.push("Check_Out_Mail");
    }

    // ── Safely patch user_settings (merge secrets, don't overwrite) ──
    const updatedSecrets = { ...existingSecrets, custom_extraction_rules: newRules };

    await supabaseAdmin.from("user_settings").update({
      user_profile: newProfile,
      categories: newCategories,
      secrets: updatedSecrets
    }).eq("id", settings.id);

    // ── Audit log ──
    await supabaseAdmin.from("debug_logs").insert({
      user_id: userId,
      event: "PERSONA_SYNTHESIZED",
      data: {
        mode,
        profile_length: newProfile.length,
        categories: newCategories,
        has_custom_rules: !!newRules
      }
    });

    return new Response(JSON.stringify({
      success: true,
      finished: true,
      user_profile: newProfile,
      categories: newCategories,
      ai_response: aiResponse
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[SYNTHESIS] Fatal error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
