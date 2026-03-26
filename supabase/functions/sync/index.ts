import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────────────────────────────────────────
// LAYER 5: 5-Key Round-Robin LLM Pool (300 RPM)
// ─────────────────────────────────────────────
let keyIndex = 0;

const getNextKey = (): string => {
  const keys = [
    Deno.env.get("SARVAM_API_KEY_A") || Deno.env.get("SARVAM_API_KEY") || "",
    Deno.env.get("SARVAM_API_KEY_B") || Deno.env.get("SARVAM_API_KEY") || "",
    Deno.env.get("SARVAM_API_KEY_C") || Deno.env.get("SARVAM_API_KEY") || "",
    Deno.env.get("SARVAM_API_KEY_D") || Deno.env.get("SARVAM_API_KEY") || "",
    Deno.env.get("SARVAM_API_KEY_E") || Deno.env.get("SARVAM_API_KEY") || "",
  ];
  const key = keys[keyIndex % keys.length];
  keyIndex++;
  return key;
};

// Persona Evolution uses Key C only (isolated, low volume)
const getPersonaKey = (): string =>
  Deno.env.get("SARVAM_API_KEY_C") || Deno.env.get("SARVAM_API_KEY") || "";

// ─────────────────────────────────────────────
// INTELLIGENCE LAYER: Category Normalizer (Fuzzy Match)
// ─────────────────────────────────────────────
const levenshtein = (a: string, b: string): number => {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
};

const normalizeCategory = (raw: string, existingCategories: string[]): string => {
  const normalized = raw.trim().toUpperCase();
  const singular = normalized.endsWith("S") ? normalized.slice(0, -1) : normalized;
  let best = normalized, bestScore = Infinity;
  for (const cat of existingCategories) {
    const catUpper = cat.toUpperCase();
    const dist = Math.min(levenshtein(normalized, catUpper), levenshtein(singular, catUpper));
    if (dist < bestScore && dist <= 3) { bestScore = dist; best = cat; }
  }
  return best;
};

// ─────────────────────────────────────────────
// EMAIL DECODE UTILITIES
// ─────────────────────────────────────────────
const safeDecode = (data: string): string => {
  try { return atob(data.replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; }
};

const decodeBody = (payload: any): string => {
  if (!payload) return "";
  const mime = payload.mimeType || "";
  if (mime === "text/plain") return safeDecode(payload.body?.data || "");
  if (payload.parts) {
    for (const part of payload.parts) {
      const b = decodeBody(part); if (b) return b;
    }
  }
  return "";
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ─────────────────────────────────────────────
// POISON PILL DEFENSE: Lenient JSON Parser
// ─────────────────────────────────────────────
const lenientParseArray = (text: string): any[] | null => {
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (!arrMatch) return null;
  try { return JSON.parse(arrMatch[0]); } catch {
    try {
      const repaired = arrMatch[0].replace(/,\s*]/g, "]").replace(/,\s*}/g, "}");
      return JSON.parse(repaired);
    } catch { return null; }
  }
};

// ─────────────────────────────────────────────
// LEGACY FALLBACK (Keyword Regex)
// ─────────────────────────────────────────────
const CATEGORY_PATTERNS: Record<string, string> = {
  "Quiz": "\\bquiz\\b", "Exam": "\\b(exam|mid.?term|end.?term|final)\\b",
  "Assignment": "\\b(assignment|homework|hw)\\b", "Lab": "\\b(lab|practical|experiment)\\b",
  "Submission": "\\b(submit|submission|upload|due)\\b", "Project": "\\b(project|capstone|mini.?project)\\b",
  "Deadline": "\\bdeadline\\b", "Report": "\\b(report|write.?up|documentation)\\b",
  "Viva": "\\b(viva|oral|defence|defense)\\b", "Internals": "\\b(internal|CIA|continuous\\s+assessment)\\b",
};

const runLegacyFallback = (subject: string, body: string) => {
  const text = (subject + " " + body).toLowerCase();
  for (const [cat, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (new RegExp(pattern, "i").test(text))
      return { title: subject.substring(0, 70), category: cat, summary: "Detected via Keyword Fallback.", status: "pending", deadline: null };
  }
  return null;
};

// ═══════════════════════════════════════════════════════════════
// STAGE 1: UNIVERSAL EXTRACTION (Identity-Blind)
// No user_profile in prompt. Extracts pure facts from all emails.
// ═══════════════════════════════════════════════════════════════
const extractRawTasks = async (
  emailsToProcess: any[],
  pendingTasksContext: string,
  actionContext: string,
  nowIst: string
): Promise<{ rawTasks: any[]; successfullyProcessedIds: string[]; rateLimitHit: boolean }> => {
  if (emailsToProcess.length === 0) return { rawTasks: [], successfullyProcessedIds: [], rateLimitHit: false };

  const batchedText = emailsToProcess
    .map(e => `[EMAIL_ID: ${e.id}]\nSubject: ${e.subject}\nBody: ${e.body}`)
    .join("\n\n---\n\n");

  const pendingContext = pendingTasksContext
    ? `\n\nUSER'S CURRENT PENDING TASKS (for update detection):\n${pendingTasksContext}\n\nIMPORTANT: If an email is an UPDATE to an existing task (e.g.,"deadline extended","event rescheduled"), return { "is_update": true, "existing_task_id": "[TASK_ID]", "deadline": "new ISO date" } instead.`
    : "";

  // STAGE 1 CORE: No user_profile, no categories. Universal extraction only.
  const prompt = `Time: ${nowIst}.
Extract actionable tasks from these emails. Return ONLY a valid JSON array.
Each task MUST include the exact source_email_id from [EMAIL_ID: xxx].
Rules:
- If an email has a required action, deadline, or meeting → extract it. Do NOT judge relevance.
- If an email has zero actionable content (receipt, promotional banner with no deadline) → omit it entirely.
- If an email is informational or low priority but has some relevance → extract it with category "Check_Out_Mail".
${pendingContext}
${actionContext}

Format: New task: { "title": "...", "deadline": "ISO8601 or null", "summary": "...", "source_email_id": "xxx" }
Update only: { "is_update": true, "existing_task_id": "uuid", "deadline": "ISO8601", "summary": "Updated: ...", "source_email_id": "xxx" }
Check_Out_Mail: { "title": "...", "deadline": "ISO8601 or null", "summary": "...", "source_email_id": "xxx", "category": "Check_Out_Mail" }

EMAILS:
${batchedText}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  let exRes: Response | null = null;
  let attemptsLeft = 3;
  while (attemptsLeft > 0 && !exRes) {
    const key = getNextKey();
    try {
      const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "sarvam-105b", messages: [{ role: "user", content: prompt }] }),
        signal: controller.signal
      });
      if (res.status === 429) { attemptsLeft--; await sleep(500); continue; }
      exRes = res;
    } catch { attemptsLeft--; }
  }
  clearTimeout(timeoutId);

  if (!exRes) return { rawTasks: [], successfullyProcessedIds: [], rateLimitHit: true };

  const exData = await exRes.json();
  const rawContent = exData.choices?.[0]?.message?.content || "";
  const parsed = lenientParseArray(rawContent);

  if (parsed) {
    const rawTasks = parsed.filter((t: any) => {
      const cleanId = t.source_email_id || "";
      return emailsToProcess.some(e => cleanId.includes(e.id));
    });
    return { rawTasks, successfullyProcessedIds: emailsToProcess.map(e => e.id), rateLimitHit: false };
  }

  // Legacy fallback
  const fallbacks: any[] = [];
  for (const email of emailsToProcess) {
    const f = runLegacyFallback(email.subject, email.body);
    if (f) fallbacks.push({ ...f, source_email_id: email.id });
  }
  return { rawTasks: fallbacks, successfullyProcessedIds: emailsToProcess.map(e => e.id), rateLimitHit: false };
};

// ═══════════════════════════════════════════════════════════════
// STAGE 2: PERSONA EVOLUTION (Task-Driven, not Email-Driven)
// Feeds pure task titles into Key C. Preserves core identity.
// ═══════════════════════════════════════════════════════════════
const evolvePersonaFromTasks = async (
  rawTasks: any[],
  currentProfile: string,
  currentCategories: string[],
  supabaseAdmin: any,
  settingsId: string,
  userId: string
): Promise<{ updatedProfile: string; updatedCategories: string[] }> => {
  if (rawTasks.length === 0) return { updatedProfile: currentProfile, updatedCategories: currentCategories };

  const taskSample = rawTasks.map(t => `- "${t.title || t.summary || "Untitled"}" (Deadline: ${t.deadline || "none"})`).join("\n");

  const personaPrompt = `Here is the current psychological and scheduling profile of this user:
"${currentProfile}"
Current Categories: [${currentCategories.join(", ")}]

Here are the user's newly extracted tasks (verified real-life actions, zero junk):
${taskSample}

Based on these NEW TASKS, EVOLVE their user profile.
1. Add new habits/patterns you discover from these tasks.
2. Gracefully retire completely outdated context.
3. CRITICAL: NEVER lose or overwrite the core identity/profession of the user. Only add nuance.
4. Output EXACTLY 5 relevant categories adapted to their current life.
JSON ONLY format: { "user_profile": "3 sentences...", "categories": ["Cat1", "Cat2", "Cat3", "Cat4", "Cat5"] }`;

  try {
    const pRes = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${getPersonaKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "sarvam-105b", messages: [{ role: "user", content: personaPrompt }] })
    });
    const pData = await pRes.json();
    const match = (pData.choices?.[0]?.message?.content || "").match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const updatedProfile = parsed.user_profile || currentProfile;
      const updatedCategories = parsed.categories || currentCategories;
      await supabaseAdmin.from("user_settings").update({ user_profile: updatedProfile, categories: updatedCategories }).eq("id", settingsId);
      await supabaseAdmin.from("debug_logs").insert({ user_id: userId, event: "PERSONA_EVOLVED", data: { profile: updatedProfile, categories: updatedCategories } });
      return { updatedProfile, updatedCategories };
    }
  } catch (e: any) {
    await supabaseAdmin.from("debug_logs").insert({ user_id: userId, event: "PERSONA_ERR", data: { error: e.message } });
  }
  return { updatedProfile: currentProfile, updatedCategories: currentCategories };
};

// ═══════════════════════════════════════════════════════════════
// STAGE 3: PERSONA-AWARE CATEGORIZATION (The Lens)
// Applies freshly evolved profile to assign categories.
// ═══════════════════════════════════════════════════════════════
const categorizeTasks = async (
  rawTasks: any[],
  updatedProfile: string,
  updatedCategories: string[],
  recentActions: string[],
  emailsToProcess: any[],
  supabaseAdmin: any,
  userId: string,
  settingsId: string,
  nowIst: string
): Promise<{ finalTasks: any[]; updatedTaskIds: string[]; currentCategories: string[] }> => {
  const finalTasks: any[] = [];
  const updatedTaskIds: string[] = [];
  let currentCategories = [...updatedCategories];

  for (const t of rawTasks) {
    const cleanId = t.source_email_id || "";
    const originalEmail = emailsToProcess.find(e => cleanId.includes(e.id));
    if (!originalEmail) continue;

    // Handle UPDATE detection (carried from Stage 1)
    if (t.is_update && t.existing_task_id) {
      await supabaseAdmin.from("tasks").update({ deadline: t.deadline || null, summary: t.summary || "Updated via email." })
        .eq("id", t.existing_task_id).eq("user_id", userId);
      updatedTaskIds.push(t.existing_task_id);
      await supabaseAdmin.from("debug_logs").insert({ user_id: userId, event: "TASK_UPDATED", data: { task_id: t.existing_task_id, new_deadline: t.deadline } });
      continue;
    }

    // Category pinned at Check_Out_Mail from Stage 1 → keep it
    if (t.category === "Check_Out_Mail") {
      finalTasks.push({ ...t, user_id: userId, source_email_id: originalEmail.id });
      continue;
    }

    // Behavioral Telemetry: route recent deletes to Check_Out_Mail
    const isDeleteMatch = recentActions.some(action =>
      action.startsWith("Deleted") && t.title && action.toLowerCase().includes(t.title.toLowerCase().slice(0, 15))
    );
    if (isDeleteMatch) {
      finalTasks.push({ ...t, category: "Check_Out_Mail", user_id: userId, source_email_id: originalEmail.id });
      continue;
    }

    // Apply the freshly evolved profile's categories (The Lens)
    const normalizedCat = t.category
      ? normalizeCategory(t.category, currentCategories)
      : normalizeCategory(t.title || "", currentCategories) || (currentCategories[0] || "General");

    // Persist truly new categories to user_settings
    if (!currentCategories.find(c => c.toUpperCase() === normalizedCat.toUpperCase())) {
      currentCategories.push(normalizedCat);
      await supabaseAdmin.from("user_settings").update({ categories: currentCategories }).eq("id", settingsId);
    }

    finalTasks.push({ ...t, category: normalizedCat, user_id: userId, source_email_id: originalEmail.id });
  }

  await supabaseAdmin.from("debug_logs").insert({ user_id: userId, event: "TASK_CATEGORIZED", data: { count: finalTasks.length } });
  return { finalTasks, updatedTaskIds, currentCategories };
};

// ═══════════════════════════════════════════════════════════════
// WARNING ENGINE: Computes deadline badges post-upsert
// ═══════════════════════════════════════════════════════════════
const runWarningEngine = async (supabaseAdmin: any, userId: string, finalTasks: any[], updatedTaskIds: string[]) => {
  if (finalTasks.length === 0 && updatedTaskIds.length === 0) return;

  const { data: allActive } = await supabaseAdmin.from("tasks")
    .select("id, deadline, warnings").eq("user_id", userId).eq("status", "pending");
  if (!allActive || allActive.length === 0) return;

  const now = new Date();
  const tomorrowIso = new Date(now.getTime() + 86400000).toISOString().split("T")[0];
  const dateCounts: Record<string, number> = {};
  let weekCount = 0;

  for (const t of allActive) {
    if (!t.deadline) continue;
    const dStr = t.deadline.split("T")[0];
    dateCounts[dStr] = (dateCounts[dStr] || 0) + 1;
    const diff = (new Date(t.deadline).getTime() - now.getTime()) / 86400000;
    if (diff >= 0 && diff <= 7) weekCount++;
  }

  const warningUpdates: { id: string; warnings: string[] }[] = [];
  for (const t of allActive) {
    const w: string[] = [];
    if (t.deadline) {
      const dStr = t.deadline.split("T")[0];
      if (dStr === tomorrowIso) w.push("⚠️ Due tomorrow");
      if (dateCounts[dStr] > 1) w.push("⚠️ Multiple tasks on this day");
      const diff = (new Date(t.deadline).getTime() - now.getTime()) / 86400000;
      if (weekCount >= 3 && diff >= 0 && diff <= 7) w.push("⚠️ 3+ deadlines this week");
    }
    if (JSON.stringify(w) !== JSON.stringify(t.warnings || [])) warningUpdates.push({ id: t.id, warnings: w });
  }

  // Sequential updates — protects free-tier connection pool
  for (const update of warningUpdates)
    await supabaseAdmin.from("tasks").update({ warnings: update.warnings }).eq("id", update.id);
};

// ─────────────────────────────────────────────
// MAIN EDGE FUNCTION HANDLER
// ─────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing Auth" }), { status: 401, headers: corsHeaders });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let user: any = null;
    let reqBody: any = {};
    try { reqBody = await req.json(); } catch {}
    const tokenStr = authHeader.replace("Bearer ", "");

    if (tokenStr === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      if (reqBody.user_id) user = { id: reqBody.user_id };
    } else {
      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(tokenStr);
      if (!authError && authData.user) user = authData.user;
    }

    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    let { data: settings } = await supabaseAdmin.from("user_settings").select("*").eq("user_id", user.id).single();
    
    // ── ONBOARDING BOOTSTRAP ──
    if (!settings) {
      if (!reqBody.providerToken) return new Response(JSON.stringify({ error: "Settings not found and no Gmail token provided" }), { status: 404, headers: corsHeaders });
      
      settings = {
        user_id: user.id,
        gmail_email: user.email,
        gmail_token: { token: reqBody.providerToken, refresh_token: reqBody.providerRefreshToken || null },
        user_profile: "A busy professional seeking to organize their schedule, extract actionable tasks from communications, and manage deadlines efficiently.",
        categories: ["General", "Work", "Personal", "Admin"],
        last_synced_at: null,
        recent_actions: []
      };
      
      const { data: inserted, error: insertError } = await supabaseAdmin.from("user_settings").insert(settings).select().single();
      if (insertError) throw new Error("Failed to bootstrap user settings: " + insertError.message);
      settings = inserted;

      await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "USER_BOOTSTRAPPED", data: {} });

      // Register Gmail Webhook Watch
      try {
        await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
          method: "POST", headers: { Authorization: `Bearer ${reqBody.providerToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ labelIds: ["INBOX"], topicName: `projects/${Deno.env.get("GOOGLE_CLOUD_PROJECT_ID")}/topics/tasker-gmail-push` })
        });
      } catch (e: any) { console.warn("Gmail watch error:", e.message); }
    }

    await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "V16_SYNC_START", data: {} });

    const isNewUser = !settings.last_synced_at || settings.user_profile?.includes("Initial Sync Stage");
    const gmailToken = settings.gmail_token?.token;
    if (!gmailToken) return new Response(JSON.stringify({ error: "No Gmail Token" }), { status: 400, headers: corsHeaders });

    // Gmail fetch
    const maxResults = isNewUser ? 50 : 20;
    const lastSynced = settings.last_synced_at;
    let query = "";
    if (!isNewUser && lastSynced) {
      const after = Math.floor(new Date(lastSynced).getTime() / 1000);
      query = `&q=after:${after}`;
    }

    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${query}`, {
      headers: { Authorization: `Bearer ${gmailToken}` }
    });
    const listData = await listRes.json();
    const messages = listData.messages || [];

    await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "GMAIL_FETCH", data: { count: messages.length } });

    const emails = (await Promise.all(messages.map(async (m: any) => {
      try {
        const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
          headers: { Authorization: `Bearer ${gmailToken}` }
        });
        const fullMsg = await detailRes.json();
        if (!fullMsg.payload) return null;
        const headers = (fullMsg.payload.headers || []).reduce((acc: any, h: any) => ({ ...acc, [h.name]: h.value }), {});
        const body = decodeBody(fullMsg.payload).substring(0, 1500).replace(/\n/g, " ").trim();
        return { id: m.id, subject: headers.Subject || "(no subject)", sender: headers.From || "unknown", date: headers.Date || "", body };
      } catch { return null; }
    }))).filter(Boolean);

    // Dedup: Remove already-processed emails
    const { data: existingTasks } = await supabaseAdmin.from("tasks")
      .select("source_email_id").eq("user_id", user.id).in("source_email_id", emails.map((e: any) => e.id));
    const processedSet = new Set((existingTasks || []).map((t: any) => t.source_email_id));
    const unprocessedEmails = emails.filter((e: any) => !processedSet.has(e.id));

    // Pending tasks context for update detection
    const { data: pendingTasksData } = await supabaseAdmin.from("tasks")
      .select("id, title, deadline, category").eq("user_id", user.id).eq("status", "pending")
      .order("deadline", { ascending: true }).limit(20);
    const pendingTasksContext = (pendingTasksData || [])
      .map((t: any) => `[TASK_ID: ${t.id}] "${t.title}" | Deadline: ${t.deadline || "none"} | Category: ${t.category}`).join("\n");

    // Behavioral telemetry context
    const recentActions: string[] = settings.recent_actions || [];
    const actionContext = recentActions.length > 0
      ? `\nUSER'S RECENT BEHAVIOR:\n${recentActions.join("\n")}\nCRITICAL: If an email matches the type recently DELETED, assign category "Check_Out_Mail".`
      : "";

    // Default persona for brand new users
    let currentProfile = settings.user_profile;
    if (!currentProfile || currentProfile.includes("Initial Sync Stage") || currentProfile.trim() === "") {
      currentProfile = "A busy professional seeking to organize their schedule, extract actionable tasks from communications, and manage deadlines efficiently.";
    }
    let currentCategories: string[] = settings.categories || [];

    const nowIst = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const CHUNK_SIZE = 10;
    const emailsToProcess = unprocessedEmails.slice(0, CHUNK_SIZE);

    // ── STAGE 1: Universal Extraction ──
    const { rawTasks, successfullyProcessedIds, rateLimitHit } = await extractRawTasks(
      emailsToProcess, pendingTasksContext, actionContext, nowIst
    );

    if (rateLimitHit && successfullyProcessedIds.length === 0)
      return new Response(JSON.stringify({ error: "Too Many Requests" }), { status: 429, headers: { ...corsHeaders, "Retry-After": "5" } });

    // ── STAGE 2: Persona Evolution (from pure task list) ──
    const shouldEvolve = (isNewUser || unprocessedEmails.length > 10) && rawTasks.length > 0;
    const { updatedProfile, updatedCategories } = shouldEvolve
      ? await evolvePersonaFromTasks(rawTasks, currentProfile, currentCategories, supabaseAdmin, settings.id, user.id)
      : { updatedProfile: currentProfile, updatedCategories: currentCategories };

    // ── STAGE 3: Persona-Aware Categorization ──
    const { finalTasks, updatedTaskIds } = await categorizeTasks(
      rawTasks, updatedProfile, updatedCategories, recentActions,
      emailsToProcess, supabaseAdmin, user.id, settings.id, nowIst
    );

    // Onboarding welcome task for new users with nothing extracted
    if (isNewUser && finalTasks.length === 0 && unprocessedEmails.length <= CHUNK_SIZE) {
      finalTasks.push({
        title: "🚀 Welcome to Tasker AI!",
        summary: "I've analyzed your emails and built your personalized task categories!",
        category: "Onboarding", status: "pending",
        user_id: user.id, source_email_id: "onboarding_" + Date.now()
      });
    }

    // Persist tasks
    if (finalTasks.length > 0) {
      const { error: upsertError } = await supabaseAdmin.from("tasks").upsert(finalTasks, { onConflict: "source_email_id" });
      if (upsertError) throw new Error("Failed to persist tasks: " + upsertError.message);
    }

    // Warning Engine
    await runWarningEngine(supabaseAdmin, user.id, finalTasks, updatedTaskIds);

    const remainingCount = unprocessedEmails.length - successfullyProcessedIds.length;
    if (remainingCount === 0) {
      await supabaseAdmin.from("user_settings").update({
        last_synced_at: new Date().toISOString(),
        recent_actions: [] // Auto-flush behavioral buffer
      }).eq("id", settings.id);
      
      // If this was their very first sync, hand them off to Catchup Prime!
      // This ensures the Greedy Background Worker quietly processes their thousands of legacy emails at 300 RPM.
      if (isNewUser) {
        try {
          await supabaseAdmin.from("sync_queue").insert({ user_id: user.id, dedup_id: `catchup_${user.id}_${Date.now()}` });
        } catch (e: any) {}
      }
    }

    await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "V16_SYNC_COMPLETE", data: { tasks: finalTasks.length, remaining: remainingCount } });

    return new Response(JSON.stringify({
      success: true,
      processed_ids: successfullyProcessedIds,
      tasks_extracted: finalTasks.length,
      remaining: remainingCount
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("V16 Sync Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
