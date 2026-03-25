import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────────────────────────────────────────
// LAYER 5: 3-Key Round-Robin LLM Pool (180 RPM)
// ─────────────────────────────────────────────
let keyIndex = 0;

function getNextKey(): string {
  const keys = [
    Deno.env.get("SARVAM_API_KEY_A") || Deno.env.get("SARVAM_API_KEY") || "",
    Deno.env.get("SARVAM_API_KEY_B") || Deno.env.get("SARVAM_API_KEY") || "",
    Deno.env.get("SARVAM_API_KEY_C") || Deno.env.get("SARVAM_API_KEY") || "",
  ];
  const key = keys[keyIndex % keys.length];
  keyIndex++;
  return key;
}

// Persona Evolution uses Key C only (isolated, low volume)
function getPersonaKey(): string {
  return Deno.env.get("SARVAM_API_KEY_C") || Deno.env.get("SARVAM_API_KEY") || "";
}

// ─────────────────────────────────────────────
// INTELLIGENCE LAYER: Category Normalizer
// Fuzzy match: maps "Tech Projects" → "Tech Project"
// ─────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function normalizeCategory(raw: string, existingCategories: string[]): string {
  const normalized = raw.trim().toUpperCase();
  // Strip trailing 'S' for basic singular/plural matching
  const singular = normalized.endsWith("S") ? normalized.slice(0, -1) : normalized;

  let best = normalized;
  let bestScore = Infinity;

  for (const cat of existingCategories) {
    const catUpper = cat.toUpperCase();
    const dist = Math.min(
      levenshtein(normalized, catUpper),
      levenshtein(singular, catUpper)
    );
    // Match if within edit distance of 3 (handles plural, abbreviation variants)
    if (dist < bestScore && dist <= 3) {
      bestScore = dist;
      best = cat; // Preserve the canonical casing
    }
  }
  return best;
}

// ─────────────────────────────────────────────
// EMAIL DECODE UTILITIES
// ─────────────────────────────────────────────
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
      if (partBody) { body = partBody; break; }
    }
  }
  return body.trim();
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// FIX 1: Lenient JSON Parser (Poison Pill Defense)
// Repairs trailing commas before parsing so a single
// Sarvam typo doesn't crash the whole chunk.
// ─────────────────────────────────────────────
function lenientParseArray(text: string): any[] | null {
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (!arrMatch) return null;
  try {
    // Fast path — valid JSON
    return JSON.parse(arrMatch[0]);
  } catch {
    try {
      // Repair trailing commas: [1, 2,] → [1, 2]
      const repaired = arrMatch[0]
        .replace(/,\s*]/g, "]")
        .replace(/,\s*}/g, "}");
      return JSON.parse(repaired);
    } catch {
      return null; // Truly malformed — fall through to legacy
    }
  }
}

// ─────────────────────────────────────────────
// LEGACY FALLBACK (V14 Regex)
// ─────────────────────────────────────────────
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

function runLegacyFallback(subject: string, body: string) {
  const text = (subject + " " + body).toLowerCase();
  for (const [cat, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (new RegExp(pattern, "i").test(text)) {
      return {
        title: subject.substring(0, 70),
        category: cat,
        summary: "Detected via Keyword Fallback.",
        status: "pending",
        deadline: null
      };
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// MAIN EDGE FUNCTION
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

    let user = null;
    const tokenStr = authHeader.replace("Bearer ", "");

    if (tokenStr === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      const body = await req.json().catch(() => ({}));
      if (body.user_id) user = { id: body.user_id };
    } else {
      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(tokenStr);
      if (!authError && authData.user) user = authData.user;
    }

    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const { data: settings } = await supabaseAdmin.from("user_settings").select("*").eq("user_id", user.id).single();
    if (!settings) return new Response(JSON.stringify({ error: "Settings not found" }), { status: 404, headers: corsHeaders });

    await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "V15_SYNC_START", data: {} });

    const isNewUser = !settings.last_synced_at || settings.user_profile?.includes("Initial Sync Stage");
    const secrets = settings.secrets || {};

    // — Fetch Gmail Emails —
    const gmailToken = settings.gmail_token?.token;
    if (!gmailToken) return new Response(JSON.stringify({ error: "No Gmail Token" }), { status: 400, headers: corsHeaders });

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

    let emails = (await Promise.all(messages.map(async (m: any) => {
      try {
        const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
          headers: { Authorization: `Bearer ${gmailToken}` }
        });
        const fullMsg = await detailRes.json();
        if (!fullMsg.payload) return null;
        const headers = (fullMsg.payload.headers || []).reduce((acc: any, h: any) => ({ ...acc, [h.name]: h.value }), {});
        const body = decodeBody(fullMsg.payload).substring(0, 1500).replace(/\n/g, " ").trim();
        return { id: m.id, subject: headers.Subject || "(no subject)", sender: headers.From || "unknown", date: headers.Date || "", body };
      } catch (e) { return null; }
    }))).filter(e => e !== null);

    // — Dedup: Filter already-processed emails —
    const { data: existingTasks } = await supabaseAdmin.from("tasks")
      .select("source_email_id")
      .eq("user_id", user.id)
      .in("source_email_id", emails.map(e => e.id));
    const processedSet = new Set((existingTasks || []).map(t => t.source_email_id));
    const unprocessedEmails = emails.filter(e => !processedSet.has(e.id));

    // ─────────────────────────────────────────────
    // INTELLIGENCE LAYER: Fetch PENDING TASKS for Update Detection
    // ─────────────────────────────────────────────
    const { data: pendingTasksData } = await supabaseAdmin.from("tasks")
      .select("id, title, deadline, category, source_email_id")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("deadline", { ascending: true })
      .limit(20);

    const pendingTasksContext = (pendingTasksData || [])
      .map(t => `[TASK_ID: ${t.id}] "${t.title}" | Deadline: ${t.deadline || "none"} | Category: ${t.category}`)
      .join("\n");

    // ─────────────────────────────────────────────
    // INTELLIGENCE LAYER: Persona + Category Setup
    // ─────────────────────────────────────────────
    let currentProfile = settings.user_profile;
    if (!currentProfile || currentProfile.includes("Initial Sync Stage") || currentProfile.trim() === "") {
      currentProfile = "A person in a college who wants to organize their academic and personal responsibilities efficiently.";
    }

    let currentCategories: string[] = settings.categories || [];

    // Persona Evolution: Only on first sync or large batches — uses isolated Key C
    if ((isNewUser || unprocessedEmails.length > 10) && unprocessedEmails.length > 0) {
      const emailSample = unprocessedEmails.map(e => `[${e.subject}]`).slice(0, 30).join(", ");
      const personaPrompt = `Current profile: "${currentProfile}"
Current categories: [${currentCategories.join(", ")}]

Email subjects received recently:
${emailSample}

Evolve the user profile. Add new habits/patterns. Retire outdated context. Keep core identity.
Output EXACTLY 5 relevant categories for this person's current life.

JSON ONLY: { "user_profile": "2-3 sentences describing the person now", "categories": ["Cat1", "Cat2", "Cat3", "Cat4", "Cat5"] }`;

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
          currentProfile = parsed.user_profile || currentProfile;
          currentCategories = parsed.categories || currentCategories;
          await supabaseAdmin.from("user_settings").update({
            user_profile: currentProfile,
            categories: currentCategories
          }).eq("id", settings.id);
          await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "PERSONA_EVOLVED", data: { profile: currentProfile, categories: currentCategories } });
        }
      } catch (e: any) {
        await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "PERSONA_ERR", data: { error: e.message } });
      }
    }

    // ─────────────────────────────────────────────
    // EXTRACTION: 10-in-1 Batching with Intelligence Injection
    // ─────────────────────────────────────────────
    const CHUNK_SIZE = 10;
    const emailsToProcess = unprocessedEmails.slice(0, CHUNK_SIZE);

    let finalTasks: any[] = [];
    let successfullyProcessedIds: string[] = [];
    let updatedTaskIds: string[] = []; // FIX 2: track updated tasks for warning engine
    let rateLimitHit = false;
    const nowIst = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });

    if (emailsToProcess.length > 0) {
      try {
        const batchedText = emailsToProcess
          .map(e => `[EMAIL_ID: ${e.id}]\nSubject: ${e.subject}\nBody: ${e.body}`)
          .join("\n\n---\n\n");

        // ─── INTELLIGENCE INJECTION ───
        const pendingContext = pendingTasksContext
          ? `\n\nUSER'S CURRENT PENDING TASKS (for update detection):\n${pendingTasksContext}\n\nIMPORTANT: If an email is an UPDATE to an existing task above (e.g., "deadline extended", "event rescheduled", "registration reopened"), return { "is_update": true, "existing_task_id": "[TASK_ID from above]", "deadline": "new ISO date" } instead of creating a new task.`
          : "";

        const categoryContext = currentCategories.length > 0
          ? `\nEXISTING CATEGORIES (prefer these before inventing new ones): [${currentCategories.join(", ")}]\nYou MAY invent a new category ONLY if none of the existing ones fit well.`
          : "";

        const prompt = `Time: ${nowIst}. User Profile: ${currentProfile}.
${categoryContext}
Extract actionable tasks from these emails. Return ONLY a valid JSON array.
Each task MUST include the exact source_email_id from [EMAIL_ID: xxx].
If an email has no actionable task, omit it entirely. DO NOT return null entries.
${pendingContext}

Format strictly (one of these two shapes):
New task:    { "title": "...", "deadline": "ISO8601 or null", "summary": "...", "category": "...", "source_email_id": "xxx" }
Update only: { "is_update": true, "existing_task_id": "uuid", "deadline": "ISO8601", "summary": "Updated: ...", "source_email_id": "xxx" }

EMAILS:
${batchedText}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);

        // Round-robin key selection with circuit breaker
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
            if (res.status === 429) {
              // Key is rate-limited — rotate and retry immediately
              attemptsLeft--;
              await sleep(500);
              continue;
            }
            exRes = res;
          } catch (e) {
            attemptsLeft--;
          }
        }
        clearTimeout(timeoutId);

        if (!exRes) {
          rateLimitHit = true;
        } else {
          const exData = await exRes.json();
          // FIX 1: Use lenient parser instead of raw JSON.parse
          const rawContent = exData.choices?.[0]?.message?.content || "";
          const rawTasks = lenientParseArray(rawContent);
          const match = rawTasks ? [rawContent] : null; // Reuse match-check pattern below

          if (match && rawTasks) {
            for (const t of rawTasks) {
              const cleanId = (t.source_email_id || "");
              const originalEmail = emailsToProcess.find(e => cleanId.includes(e.id));
              if (!originalEmail) continue;

              // ─── Handle UPDATE vs NEW ───
              if (t.is_update && t.existing_task_id) {
                // Patch the existing task's deadline and summary
                await supabaseAdmin.from("tasks").update({
                  deadline: t.deadline || null,
                  summary: t.summary || "Updated via email.",
                }).eq("id", t.existing_task_id).eq("user_id", user.id);
                updatedTaskIds.push(t.existing_task_id); // FIX 2: track for warning engine
                await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "TASK_UPDATED", data: { task_id: t.existing_task_id, new_deadline: t.deadline } });
              } else {
                // ─── INTELLIGENCE: Normalize Category before saving ───
                const normalizedCat = t.category
                  ? normalizeCategory(t.category, currentCategories)
                  : (currentCategories[0] || "General");

                // If the normalized category is new, persist it
                if (!currentCategories.find(c => c.toUpperCase() === normalizedCat.toUpperCase())) {
                  currentCategories.push(normalizedCat);
                  await supabaseAdmin.from("user_settings").update({ categories: currentCategories }).eq("id", settings.id);
                }

                finalTasks.push({
                  ...t,
                  category: normalizedCat,
                  user_id: user.id,
                  source_email_id: originalEmail.id
                });
              }
            }
            successfullyProcessedIds = emailsToProcess.map(e => e.id);
          } else {
            // Legacy fallback
            for (const email of emailsToProcess) {
              const fallback = runLegacyFallback(email.subject, email.body);
              if (fallback) finalTasks.push({ ...fallback, user_id: user.id, source_email_id: email.id });
              successfullyProcessedIds.push(email.id);
            }
          }
        }
      } catch (e) {
        console.error("Batch extraction error:", e);
      }
    }

    if (rateLimitHit && successfullyProcessedIds.length === 0) {
      return new Response(JSON.stringify({ error: "Too Many Requests", message: "All LLM keys rate limited" }), {
        status: 429,
        headers: { ...corsHeaders, "Retry-After": "5" }
      });
    }

    // Onboarding task for new users with nothing extracted
    if (isNewUser && finalTasks.length === 0 && unprocessedEmails.length <= CHUNK_SIZE) {
      finalTasks.push({
        title: "🚀 Welcome to Tasker AI!",
        summary: "I've analyzed your emails and built your personalized task categories!",
        category: "Onboarding",
        status: "pending",
        user_id: user.id,
        source_email_id: "onboarding_" + Date.now()
      });
    }

    // Persist new tasks
    if (finalTasks.length > 0) {
      const { error: upsertError } = await supabaseAdmin.from("tasks").upsert(finalTasks, { onConflict: "source_email_id" });
      if (upsertError) throw new Error("Failed to persist tasks: " + upsertError.message);
    }

    // FIX 2: Warning engine always runs if any task was touched (new OR updated)
    if (finalTasks.length > 0 || updatedTaskIds.length > 0) {
      const { data: allActive } = await supabaseAdmin.from("tasks")
        .select("id, deadline, warnings")
        .eq("user_id", user.id)
        .eq("status", "pending");

      if (allActive && allActive.length > 0) {
        const now = new Date();
        const tomorrowIso = new Date(now.getTime() + 86400000).toISOString().split("T")[0];
        let dateCounts: Record<string, number> = {};
        let weekCount = 0;
        allActive.forEach((t: any) => {
          if (t.deadline) {
            const dStr = t.deadline.split("T")[0];
            dateCounts[dStr] = (dateCounts[dStr] || 0) + 1;
            const diff = (new Date(t.deadline).getTime() - now.getTime()) / 86400000;
            if (diff >= 0 && diff <= 7) weekCount++;
          }
        });

        // FIX 3: Compute all warnings in-memory, then do ONE batched RPC update
        // instead of N parallel connections (prevents free-tier pool exhaustion)
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
          if (JSON.stringify(w) !== JSON.stringify(t.warnings || [])) {
            warningUpdates.push({ id: t.id, warnings: w });
          }
        }

        // Single batched update per changed task — sequential, not parallel
        // Max ~20 tasks so this is fast and connection-safe
        for (const update of warningUpdates) {
          await supabaseAdmin.from("tasks").update({ warnings: update.warnings }).eq("id", update.id);
        }
      }
    }

    const remainingCount = unprocessedEmails.length - successfullyProcessedIds.length;
    if (remainingCount === 0) {
      await supabaseAdmin.from("user_settings").update({ last_synced_at: new Date().toISOString() }).eq("id", settings.id);
    }

    await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "V15_SYNC_COMPLETE", data: { tasks: finalTasks.length, remaining: remainingCount } });

    return new Response(JSON.stringify({
      success: true,
      processed_ids: successfullyProcessedIds,
      tasks_extracted: finalTasks.length,
      remaining: remainingCount
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("V15 Sync Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
