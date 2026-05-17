import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getPersonaKey } from "../_shared/keys.ts";

// ═══════════════════════════════════════════════════════════════
// SYNTHESIZE PROFILE — AI Mind & Evolution Center Edge Function
// Handles both guided onboarding AND open-ended chat commands.
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
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
    const body = await req.json();
    const mode: string = body.mode || "chat"; // "onboarding" | "chat"
    const messages: string[] = body.messages || [];
    const chatMessage: string = body.message || "";

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
      // Guided onboarding: messages = [answer1, answer2, answer3]
      synthesisPrompt = `You are the Tasker Core Mind Architect. A brand new user has just introduced themselves via a 3-step onboarding conversation.

Step 1 — Who they are and what they focus on:
"${messages[0] || "Not provided"}"

Step 2 — What kinds of emails they receive and what's noise:
"${messages[1] || "Not provided"}"

Step 3 — What tasks they actually expect to see extracted:
"${messages[2] || "Not provided"}"

Your goal is to output a single JSON payload containing:
1. "user_profile": A comprehensive, highly-structured 4-sentence profile paragraph. Include their role, key priorities, productivity pace, and crucial guidelines on what should and shouldn't be extracted.
2. "categories": A dynamic starting "seed" of 4 to 6 high-level categories (Life Bubbles) matching their active responsibilities.
   * STRICT RULES: These must be broad and generic (e.g., "Work", "Academics", "Side Projects", "Personal Finance", "Check_Out_Mail").
   * Do NOT create narrow, hyper-segmented categories.
   * Do NOT duplicate or overlap semantically (e.g., do not output both "Development" and "Coding").
   * ALWAYS include "Check_Out_Mail" as the final category.
3. "custom_extraction_rules": Explicit instructions that an email extraction AI will read to decide whether an email is actionable for this user.

Output ONLY a valid JSON object. No markdown, no backticks.`;

    } else {
      // Open chat mode: user is sending a free-form command
      synthesisPrompt = `You are the Tasker Core Mind Architect.
You are updating the configuration for an existing user based on their request.

Current Profile: "${currentProfile}"
Current Categories: ${JSON.stringify(currentCategories)}
Current Extraction Rules: "${existingSecrets.custom_extraction_rules || "None set"}"

The user has just prompted you:
"${chatMessage}"

Update the configuration accordingly. Follow these strict rules:
- Categories must be kept high-level, generic, and non-overlapping.
- Do NOT duplicate semantically similar categories.
- ALWAYS preserve "Check_Out_Mail" as a category.
- If the user asks to track a specific sender, add it to the custom_extraction_rules.
- If the user asks to merge or rename categories, do so cleanly.
- If the user asks to change their identity/role, update the profile accordingly.

Output ONLY a valid JSON object with these keys:
{
  "user_profile": "Updated profile paragraph...",
  "categories": ["Category 1", "Category 2", ...],
  "custom_extraction_rules": "Refined extraction guidelines...",
  "ai_response": "A friendly, conversational response to the user confirming what you changed."
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

    const groqData = await groqRes.json();
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

    const parsed = JSON.parse(jsonMatch[0]);

    const newProfile = parsed.user_profile || currentProfile;
    const newCategories: string[] = parsed.categories || currentCategories;
    const newRules = parsed.custom_extraction_rules || existingSecrets.custom_extraction_rules || "";
    const aiResponse = parsed.ai_response || "Your AI Mind has been updated successfully!";

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
      user_profile: newProfile,
      categories: newCategories,
      ai_response: aiResponse
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[SYNTHESIS] Fatal error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
