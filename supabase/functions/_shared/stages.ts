import { redact } from "npm:@arcjet/redact";
import { getNextKey, getPersonaKey } from "./keys.ts";
import { prePassRedact, shannonEntropy, luhnValid } from "./pii.ts";
import { sleep, getSeason, lenientParseArray } from "./utils.ts";

// ═══════════════════════════════════════════════════════════════
// STAGE 1: PERSONA-AWARE EXTRACTION
// Reads user_profile + custom_extraction_rules from user_settings
// to personalize which emails become tasks.
// ═══════════════════════════════════════════════════════════════
export const extractRawTasks = async (
  emailsToProcess: any[],
  pendingTasksContext: string,
  actionContext: string,
  nowIst: string,
  supabaseAdmin: any,
  userId: string
): Promise<{ rawTasks: any[]; successfullyProcessedIds: string[]; rateLimitHit: boolean }> => {
  if (emailsToProcess.length === 0) return { rawTasks: [], successfullyProcessedIds: [], rateLimitHit: false };

  // ── THE PRIVACY SCALPEL (Three-Stage Zero-Trust Pipeline) ──
  const unredactFunctions: Function[] = [];
  const safeEmails: string[] = [];

  for (const e of emailsToProcess) {
    let safeBody = e.body || "";
    let safeSubject = e.subject || "";

    try {
      const fullText = `Subject: ${safeSubject}\nBody: ${safeBody}`;

      // STAGE 1: Pre-Pass Regex Vault — permanent erasure before tokenization
      const stage1 = prePassRedact(fullText);

      // STAGE 2: Arcjet WASM + Heuristics — permanent erasure of mathematical SECRETS
      // Closure array: collect suspicious tokens synchronously in detect(), flush to DB after redact() completes.
      // This bypasses the 24-hour Edge Function log expiry limitation.
      const suspiciousTokens: { token: string; entropy: number; email_id: string }[] = [];

      const arcjetConfig = {
        entities: ["credit-card-number"], // Move CC here as it's a fixed secret, not rehydratable PII
        contextWindowSize: 5,
        detect: (tokens: string[]) => {
          return tokens.map((token: string, i: number) => {
            // Shannon Entropy & Audit Log
            if (token.length > 10) {
              const h = shannonEntropy(token);
              // High Entropy = Definite Password/Key (Permanent Erasure)
              if (h > 4.5 && /[0-9]/.test(token) && /[A-Z]/.test(token)) {
                return "password";
              }
              // Medium Entropy = Suspicion Zone
              // console.warn is ephemeral (expires 24h on Supabase) — collect for persistent DB write below.
              else if (h > 3.5 && h <= 4.5) {
                console.warn(`🟡 REVIEW QUEUE (Suspicious Token h=${h.toFixed(2)}): ${token}`);
                suspiciousTokens.push({ token, entropy: parseFloat(h.toFixed(2)), email_id: e.id });
              }
            }
            // Luhn-validated credit cards only
            if (/^[0-9\-]{13,19}$/.test(token) && luhnValid(token)) return "credit-card";
            return undefined;
          });
        },
        replace: (entity: string) => {
          const normalized = entity
            .replace("credit-card-number", "CREDIT-CARD")
            .replace("credit-card", "CREDIT-CARD")
            .toUpperCase();
          return "[ERASED_" + normalized + "]";
        }
      };

      let stage2 = stage1;
      try {
        const arcjetRes: any = await redact(stage1, arcjetConfig);
        stage2 = Array.isArray(arcjetRes) ? arcjetRes[0] : (arcjetRes.redacted || stage1);
      } catch (err) {
        console.error("Arcjet Redact Err", err);
      }

      // ── PERSISTENT REVIEW QUEUE FLUSH (fire-and-forget) ──
      // NOT awaited — debug_logs is observational only. No reason to block the critical path.
      // Writes suspicious tokens to DB so they survive past the 24-hour Edge Function log window.
      if (suspiciousTokens.length > 0) {
        supabaseAdmin.from("debug_logs").insert(
          suspiciousTokens.map(t => ({
            user_id: userId,
            event: "REVIEW_QUEUE_TOKEN",
            data: { token: t.token, entropy: t.entropy, email_id: t.email_id }
          }))
        ).catch((err: any) => console.error("[REVIEW QUEUE] Persist failed:", err));

      }

      // STAGE 3: Rehydration Layer — temporary PII masking for LLM round-trip
      const piiConfig = {
        entities: ["email", "phone-number", "ip-address"],
        replace: (entity: string) => `__PII_${entity.replace(/-/g, '')}_${Math.random().toString(36).substring(2, 9)}__`
      };

      let piiRedacted = stage2;
      let unredactFn: any = null;
      try {
        const piiRes: any = await redact(stage2, piiConfig);
        piiRedacted = Array.isArray(piiRes) ? piiRes[0] : (piiRes.redacted || stage2);
        unredactFn = Array.isArray(piiRes) ? piiRes[1] : piiRes.unredact;
      } catch (err) {
        console.error("PII Rehydration Err", err);
      }

      safeEmails.push(`[EMAIL_ID: ${e.id}]\n${piiRedacted}`);
      if (typeof unredactFn === 'function') {
        unredactFunctions.push(unredactFn);
      }

    } catch (err) {
      console.error("PII Filter failed for email:", e.id, err);
      safeEmails.push(`[EMAIL_ID: ${e.id}]\n[EMAIL REDACTED DUE TO PRIVACY SHIELD FAILURE]`);
    }
  }

  const batchedText = safeEmails.join("\n\n---\n\n");
  console.log(`🔒 SHIELDED BATCH: ${safeEmails.length} emails processed through PII pipeline`);

  const pendingContext = pendingTasksContext
    ? `\n\nUSER'S CURRENT PENDING TASKS (for update detection):\n${pendingTasksContext}\n\nIMPORTANT: If an email is an UPDATE to an existing task (e.g.,"deadline extended","event rescheduled"), return { "is_update": true, "existing_task_id": "[TASK_ID]", "deadline": "new ISO date" } instead.`
    : "";

  // ── Load user's AI Mind configuration for personalized extraction ──
  let userProfileContext = "";
  let customRulesContext = "";
  try {
    const { data: userCfg } = await supabaseAdmin
      .from("user_settings")
      .select("user_profile, secrets")
      .eq("user_id", userId)
      .single();
    if (userCfg?.user_profile && !userCfg.user_profile.includes("Initial Sync Stage")) {
      userProfileContext = `\nUSER PROFILE (use this to understand what matters to them):\n"${userCfg.user_profile}"\n`;
    }
    if (userCfg?.secrets?.custom_extraction_rules) {
      customRulesContext = `\nUSER-SPECIFIC EXTRACTION OVERRIDES (HIGHEST PRIORITY — follow these precisely):\n"${userCfg.secrets.custom_extraction_rules}"\n`;
    }
  } catch { /* user_settings not found — proceed with generic extraction */ }

  // STAGE 1 CORE: Persona-aware extraction.
  const prompt = `Time: ${nowIst}.
Extract actionable tasks and useful information from these emails. Return ONLY a valid JSON array.
Each task MUST include the exact source_email_id from [EMAIL_ID: xxx].
${userProfileContext}${customRulesContext}
Rules:
- Extract ANY email that contains personal importance, meetings, subscriptions, bills, useful news, or updates. Do NOT judge relevance.
- 🚫 OMIT ENTIRELY: OTPs, verification codes, 2FA, pure promotional junk, and useless spam. Do NOT create tasks for these.
- If it has a specific action, deadline, or meeting -> extract it normally.
- If an email is informational or news (but NOT spam) -> extract it normally. Do NOT force it into Check_Out_Mail. The categorizer will create a dynamic category for it (e.g., "Newsletters", "Updates").
- If the user's extraction overrides specify tracking a specific sender or topic, ALWAYS extract those.
- CRITICAL: You MUST include the exact "source_email_id" field for every single item you extract.
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
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "meta-llama/llama-4-scout-17b-16e-instruct", messages: [{ role: "user", content: prompt }] }),
        signal: controller.signal
      });
      if (res.status === 429) { attemptsLeft--; await sleep(500); continue; }
      exRes = res;
    } catch { attemptsLeft--; }
  }
  clearTimeout(timeoutId);

  if (!exRes) return { rawTasks: [], successfullyProcessedIds: [], rateLimitHit: true };

  if (!exRes.ok) {
    console.error(`[LLM API Error] Status: ${exRes.status}`);
    return { rawTasks: [], successfullyProcessedIds: [], rateLimitHit: exRes.status === 429 };
  }

  const exData = await exRes.json();
  let rawContent = exData.choices?.[0]?.message?.content || "";

  // ── RE-HYDRATION MODULE ──
  for (const unredactFn of unredactFunctions) {
    try {
      rawContent = unredactFn(rawContent);
    } catch (e) { /* ignore unredact failures if a token was mangled by LLM */ }
  }

  const parsed = lenientParseArray(rawContent);

  if (parsed) {
    const rawTasks = parsed.filter((t: any) => {
      const sourceId = t.source_email_id;
      // Validate source_email_id is a non-empty string and not "None" or similar invalid values
      if (!sourceId || typeof sourceId !== 'string' || sourceId.trim() === '' || sourceId.toLowerCase() === 'none') {
        return false;
      }
      const cleanId = sourceId.trim();
      return emailsToProcess.some(e => cleanId === e.id);
    });
    return { rawTasks, successfullyProcessedIds: emailsToProcess.map(e => e.id), rateLimitHit: false };
  }

  // If the LLM returned absolutely nothing valid, we assume no tasks were found.
  return { rawTasks: [], successfullyProcessedIds: emailsToProcess.map(e => e.id), rateLimitHit: false };
};

// ═══════════════════════════════════════════════════════════════
// STAGE 2: PERSONA EVOLUTION (Task-Driven, not Email-Driven)
// Feeds pure task titles into Key C. Preserves core identity.
// ═══════════════════════════════════════════════════════════════
export const evolvePersonaFromTasks = async (
  rawTasks: any[],
  currentProfile: string,
  currentCategories: string[],
  pendingTasksContext: string,
  recentActions: string[],
  supabaseAdmin: any,
  settingsId: string,
  userId: string
): Promise<{ updatedProfile: string; updatedCategories: string[] }> => {
  if (rawTasks.length === 0) return { updatedProfile: currentProfile, updatedCategories: currentCategories };

  // Calculate temporal context
  const now = new Date();
  const month = now.toLocaleString('default', { month: 'long' });
  const season = getSeason(now.getMonth());
  const quarter = `Q${Math.floor(now.getMonth() / 3) + 1}`;

  // Behavioral Analytics
  const completed = recentActions.filter(a => a.startsWith("Completed")).length;
  const deleted = recentActions.filter(a => a.startsWith("Deleted")).length;
  const total = completed + deleted || 1; // avoid div/0
  const completionRate = Math.round((completed / total) * 100);
  
  const behavioralContext = recentActions.length > 0 
    ? `Behavioral Telemetry (Last ${total} actions):\n- Task Completion Rate: ${completionRate}%\n- Recent Actions:\n${recentActions.map(a => `  * ${a}`).join("\n")}`
    : `Behavioral Telemetry: No recent actions yet.`;

  const taskSample = rawTasks.map(t => `- "${t.title || t.summary || "Untitled"}" (Deadline: ${t.deadline || "none"})`).join("\n");

  const personaPrompt = `Here is the user's FULL context:

HISTORICAL PROFILE:
"${currentProfile}"

ACTIVE LIFE BUBBLES (Current Categories):
[${currentCategories.join(", ")}]

TEMPORAL CONTEXT:
${month}, ${season} (${quarter})

${behavioralContext}

EXISTING PENDING TASKS (What they are already working on):
${pendingTasksContext || "None."}

NEWLY ARRIVED TASKS:
${taskSample}

YOUR MISSION: EVOLVE THEIR PERSONA AND CATEGORIES.
Act as a world-class executive assistant. Analyze the user's workload, behavior, and temporal context, then update their profile and categories.

STRICT GUARDRAILS & RULES:
1. DEEP BEHAVIORAL ANALYSIS: Look at their recent actions. Are they deleting specific types of tasks? If so, note their lack of interest in that area. Are they highly disciplined? Note their execution style.
2. TEMPORAL LIFECYCLES: Has the season or quarter changed? Cleanly sunset outdated projects (e.g., don't keep "Spring Finals" if it's Summer).
3. IDENTITY PRESERVATION: **DO NOT** radically change their fundamental identity based on 1 or 2 new tasks. Require overwhelming evidence to shift from "Student" to "Software Engineer". Evolve, do not hallucinate.
4. ANTI-SPRAWL CATEGORY CONSOLIDATION (GARBAGE COLLECTION):
   - You MUST act as a semantic garbage collector.
   - MERGE redundant categories (e.g., collapse "AWS Cloud", "AWS Course", and "Cloud Architecture" into just "Cloud Engineering").
   - CLUSTER tasks into distinct "Life Bubbles" (Professional, Academic, Personal, Projects).
   - DO NOT create a new category for every single task. 
   - A healthy profile has 3 to 8 high-level, cohesive categories.

JSON ONLY format (DO NOT WRAP IN BACKTICKS):
{
  "user_profile": "Updated highly-descriptive behavioral profile...",
  "categories": ["Merged Category 1", "Evolved Project 2", "Personal Core", "..."]
}`;

  try {
    const pRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${getPersonaKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "meta-llama/llama-4-scout-17b-16e-instruct", messages: [{ role: "user", content: personaPrompt }] })
    });
    const pData = await pRes.json();
    // BUG FIX #3: Strip markdown backticks before regex extraction (matches categorizeTasks behavior)
    let rawContent = pData.choices?.[0]?.message?.content || "";
    rawContent = rawContent.replace(/```json/g, "").replace(/```/g, "").trim();
    const match = rawContent.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const updatedProfile = parsed.user_profile || currentProfile;
      const evolvedCategories = parsed.categories || currentCategories;

      // BUG FIX #4b: Merge intelligently to allow category retirement.
      // We keep what the LLM returned (evolvedCategories), PLUS anything new that 
      // Stage 3 added to the DB while we were running (recentlyAdded).
      const { data: freshSettings } = await supabaseAdmin.from("user_settings").select("categories").eq("id", settingsId).single();
      const existingDbCategories: string[] = freshSettings?.categories || [];
      const recentlyAdded = existingDbCategories.filter(c => !currentCategories.includes(c));
      const mergedCategories = Array.from(new Set([...evolvedCategories, ...recentlyAdded]));

      await supabaseAdmin.from("user_settings").update({ user_profile: updatedProfile, categories: mergedCategories }).eq("id", settingsId);
      await supabaseAdmin.from("debug_logs").insert({ user_id: userId, event: "PERSONA_EVOLVED", data: { profile: updatedProfile, categories: mergedCategories } });
      return { updatedProfile, updatedCategories: mergedCategories };
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
export const categorizeTasks = async (
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

  const tasksToCategorize = rawTasks.filter(t => !t.is_update && t.category !== "Check_Out_Mail");
  let categoryMapping: Record<string, string> = {};

  if (tasksToCategorize.length > 0) {
    const catPrompt = `User Profile: "${updatedProfile}"
 Existing Dynamic Categories: [${currentCategories.join(", ")}]
 
 Tasks to classify:
 ${tasksToCategorize.map(t => `- "${t.title}"`).join("\n")}
 
 Rules:
 - Map every task to the single most fitting existing category from the list above.
 - If a task genuinely does not belong in any existing category, you MUST introduce a new, meaningful semantic cluster for it.
 - A new category must be an ongoing project, theme, or context (e.g., "React Native Workshop", "Job Hunting", "Final Exams").
 - DO NOT use the exact task title as the category name. Generalize it slightly so future related tasks can share the bubble.
 - Provide a confidence score (0.0 to 1.0) for each mapping indicating your certainty.
 
     JSON ONLY format: [ { "task": "Task Title", "category": "ExactCategoryName", "confidence": 0.95 } ]`;
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${getPersonaKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "meta-llama/llama-4-scout-17b-16e-instruct", messages: [{ role: "user", content: catPrompt }] })
      });
      if (res.ok) {
        const data = await res.json();
        let content = data.choices?.[0]?.message?.content || "";

        // Strip markdown JSON backticks safely to prevent parse failures
        content = content.replace(/```json/g, "").replace(/```/g, "").trim();

        const match = content.match(/\[[\s\S]*\]/);
        if (match) {
          const categoryArray = JSON.parse(match[0]);
          // Convert array format to mapping for backward compatibility
          categoryArray.forEach((item: any) => {
            if (item.task && item.category && item.confidence !== undefined) {
              // Apply confidence threshold: only accept mappings with confidence >= 0.6
              if (item.confidence >= 0.6) {
                categoryMapping[item.task] = item.category;
              } else {
                // Low confidence mappings are rejected and will fall back to default
                console.log(`[STAGE 3] Low confidence rejection: "${item.task}" -> "${item.category}" (confidence: ${item.confidence})`);
              }
            }
          });
        }
      }
    } catch (e) {
      console.error("Stage 3 API err", e);
    }
  }

  for (const t of rawTasks) {
    const sourceId = t.source_email_id;
    // Validate source_email_id is a non-empty string and not "None" or similar invalid values
    if (!sourceId || typeof sourceId !== 'string' || sourceId.trim() === '' || sourceId.toLowerCase() === 'none') {
      continue; // Skip invalid source_email_id
    }
    const cleanId = sourceId.trim();
    const originalEmail = emailsToProcess.find(e => cleanId === e.id);
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

    // Apply strict AI mapping — allow new dynamic functional categories from the LLM
    let normalizedCat = categoryMapping[t.title];
    if (!normalizedCat) {
      // Task had no mapping or was filtered out due to low confidence (< 0.6)
      // Route to Check_Out_Mail to prevent hallucinations
      normalizedCat = "Check_Out_Mail";
    } else if (!currentCategories.includes(normalizedCat)) {
      // A new category was proposed by Stage 3
      // We accept it, but do a quick sanity check to make sure it's not a hallucination or an entire block of text
      const isMeaningful = normalizedCat.length > 2 && normalizedCat.length < 50 && normalizedCat === normalizedCat.trim();
      if (isMeaningful) {
        currentCategories.push(normalizedCat);
        await supabaseAdmin.from("user_settings").update({ categories: currentCategories }).eq("id", settingsId);
        console.log(`[STAGE 3] New semantic cluster added: "${normalizedCat}"`);
      } else {
        // Invalid category proposal, fall back to Check_Out_Mail for safety
        normalizedCat = "Check_Out_Mail";
      }
    }

    finalTasks.push({ ...t, category: normalizedCat, user_id: userId, source_email_id: originalEmail.id });
  }

  await supabaseAdmin.from("debug_logs").insert({ user_id: userId, event: "TASK_CATEGORIZED", data: { count: finalTasks.length } });
  return { finalTasks, updatedTaskIds, currentCategories };
};

// ═══════════════════════════════════════════════════════════════
// WARNING ENGINE: Computes deadline badges post-upsert
// ═══════════════════════════════════════════════════════════════
export const runWarningEngine = async (supabaseAdmin: any, userId: string, finalTasks: any[], updatedTaskIds: string[]) => {
  // BUG FIX #6: Removed early-return guard. Always recalculate so deadline badges stay fresh.

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

  // Parallel updates via Promise.all — safe because each update targets a unique task ID
  await Promise.all(
    warningUpdates.map(update =>
      supabaseAdmin.from("tasks").update({ warnings: update.warnings }).eq("id", update.id)
    )
  );
};
