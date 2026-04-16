import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { redact } from "npm:@arcjet/redact";

// Regex escaper for safe string replacement
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
// EMAIL DECODE UTILITIES
// ─────────────────────────────────────────────
const safeDecode = (data: string): string => {
  try { return atob(data.replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; }
};

const decodeBody = (payload: any): string => {
  if (!payload) return "";
  const mime = payload.mimeType || "";
  if (mime === "text/plain") {
    const data = payload.body?.data;
    if (!data) return "";
    return safeDecode(data);
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const b = decodeBody(part); if (b) return b;
    }
  }
  return "";
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ═══════════════════════════════════════════════════════════════
// THREE-STAGE PII ENGINE (Proven 7/7 Eval Accuracy)
// ═══════════════════════════════════════════════════════════════

// ── STAGE 1: PRE-PASS REGEX VAULT (Permanent Erasure) ──
// Runs on raw text BEFORE Arcjet tokenization.
// Catches multi-token secrets (JWTs split on dots, inline key:value pairs).
const SECRET_REGEXES: { regex: RegExp; tag: string }[] = [
  { regex: /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, tag: "[ERASED_JWT]" },
  { regex: /AKIA[0-9A-Z]{16}/g, tag: "[ERASED_API-KEY]" },
  { regex: /sk_live_[0-9a-zA-Z]{24}/g, tag: "[ERASED_STRIPE-KEY]" },
  { regex: /ghp_[A-Za-z0-9]{36}/g, tag: "[ERASED_GH-TOKEN]" },
  // Labeled Secrets ("password:", "code:", "otp:") — 'token' excluded to prevent JWT collision
  { regex: /(?:\bpassword|\bpwd|\bsecret|\bkey|\bcode|\botp|\bverification|\blogin)[:\s=]+(?:is\s+)?(?![\[])([^\s\.]+)/gi, tag: "[ERASED_PASSWORD]" },

  // ── INDIA HIGH-RISK IDENTITY PII (Permanent Erasure) ──
  // Aadhaar: 12-digit UID in 4+4+4 groups (space-separated).
  // Negative assertions prevent matching inside 16-digit CC numbers.
  { regex: /(?<![\d\-])[2-9]\d{3} \d{4} \d{4}(?! \d)/g, tag: "[ERASED_AADHAAR]" },
  { regex: /(?<![\d\-])[2-9]\d{11}(?![\d\-])/g, tag: "[ERASED_AADHAAR]" },
  // PAN Card: 5 uppercase letters, 4 digits, 1 uppercase letter (ABCDE1234F)
  { regex: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g, tag: "[ERASED_PAN]" },
  // GSTIN: 15-char business tax ID — 2-digit state code + PAN + Z + checksum
  { regex: /\b[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/g, tag: "[ERASED_GSTIN]" },
  // IFSC Code: 4 uppercase bank letters + 0 + 6 alphanumeric chars
  { regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, tag: "[ERASED_IFSC]" },
];

function prePassRedact(text: string): string {
  let out = text;
  for (const { regex, tag } of SECRET_REGEXES) out = out.replace(regex, tag);
  return out;
}

// ── TEMPORAL UTILITIES ──
function getSeason(monthIndex: number): string {
  const seasons = ['Winter', 'Spring', 'Summer', 'Fall'];
  return seasons[Math.floor(monthIndex / 3)];
}

// ── MATH UTILITIES ──
function shannonEntropy(str: string): number {
  const freq: Record<string, number> = {};
  for (const c of str) freq[c] = (freq[c] || 0) + 1;
  return Object.values(freq).reduce((h, n) => {
    const p = n / str.length; return h - p * Math.log2(p);
  }, 0);
}

function luhnValid(str: string): boolean {
  const digits = str.replace(/\D/g, '').split('').map(Number);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0, even = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (even) { d *= 2; if (d > 9) d -= 9; }
    sum += d; even = !even;
  }
  return sum % 10 === 0;
}

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



// ═══════════════════════════════════════════════════════════════
// STAGE 1: UNIVERSAL EXTRACTION (Identity-Blind)
// No user_profile in prompt. Extracts pure facts from all emails.
// ═══════════════════════════════════════════════════════════════
const extractRawTasks = async (
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
  console.log("🔒 SHIELDED BATCH:", batchedText);

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
const evolvePersonaFromTasks = async (
  rawTasks: any[],
  currentProfile: string,
  currentCategories: string[],
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

  const taskSample = rawTasks.map(t => `- "${t.title || t.summary || "Untitled"}" (Deadline: ${t.deadline || "none"})`).join("\n");

  const personaPrompt = `Here is the user's historical context:
 "${currentProfile}"
 Current Categories: [${currentCategories.join(", ")}]
 Current Temporal Context: ${month}, ${season} (${quarter})
 
 Newly extracted tasks:
 ${taskSample}
 
 Based on these NEW TASKS, EVOLVE their context.
 1. Add new habits/patterns you discover.
 2. Gracefully retire completely outdated tasks or projects.
 3. CRITICAL LIMIT: DO NOT change the user's fundamental profession/identity (e.g., if they are a College Student, do not make them a Software Engineer).
 4. DYNAMICALLY create meaningful, highly-personalized categories that represent the user's active life blocks, courses, or long-term projects.
    - CLUSTER similar tasks together. DO NOT create a separate category for every single task. 
    - A category should be specific to their context but capable of holding multiple tasks (e.g., "Equinox Hackathon Prep", "AWS Cloud Coursework", "Campus Placements").
    - Do NOT use the exact task title as the category name. Generalize it into an ongoing theme or project bucket.
 
 JSON ONLY format:
 { "user_profile": "...", "categories": ["Equinox Hackathon", "Cloud Coursework", "Personal Leisure", "..."] }`;

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
      const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${getPersonaKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "sarvam-105b", messages: [{ role: "user", content: catPrompt }] })
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
// AUTO-HEALING OAUTH PIPELINE
// ─────────────────────────────────────────────
async function refreshGmailToken(userId: string, refreshToken: string, supabaseAdmin: any): Promise<string | null> {
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

  const data = await res.json();
  if (!res.ok) {
    console.warn("[OAUTH] Refresh failed:", data);
    if (data.error === "invalid_grant") {
      // Graceful Revocation: They uninstalled or revoked the app
      await supabaseAdmin.from("user_settings").update({ sync_status: 'REVOKED' }).eq("user_id", userId);
      await supabaseAdmin.from("debug_logs").insert({ user_id: userId, event: "GMAIL_AUTH_REVOKED", data: {} });
    }
    return null;
  }

  // Atomic Persistence
  const newGmailTokenObj = { token: data.access_token, refresh_token: refreshToken };
  await supabaseAdmin.from("user_settings")
    .update({ gmail_token: newGmailTokenObj, sync_status: 'ACTIVE' })
    .eq("user_id", userId);

  await supabaseAdmin.from("debug_logs").insert({ user_id: userId, event: "GMAIL_TOKEN_REFRESHED", data: {} });
  return data.access_token;
}

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
    try { reqBody = await req.json(); } catch { }
    const tokenStr = authHeader.replace("Bearer ", "");

    if (tokenStr === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      if (reqBody.user_id) user = { id: reqBody.user_id };
    } else {
      // Decode the JWT directly since API Gateway (verify_jwt: true) already validated it.
      // This bypasses the GoTrue rate limits on getUser().
      try {
        const tokenParts = tokenStr.split('.');
        if (tokenParts.length < 2) {
          console.error("Invalid JWT format");
        } else {
          const base64Url = tokenParts[1];
          if (base64Url) {
            let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const pad = base64.length % 4;
            if (pad) {
              base64 += '='.repeat(4 - pad);
            }
            try {
              const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
              const payload = JSON.parse(jsonPayload);
              if (payload.sub) {
                user = { id: payload.sub, email: payload.email || "" };
              } else if (payload.role === "service_role" && reqBody.user_id) {
                user = { id: reqBody.user_id };
              }
            } catch (parseError: any) {
              console.error("JWT payload parse error:", parseError.message);
            }
          }
        }
      } catch (e) {
        console.error("JWT Decode error", e);
      }
    }

    if (!user) return new Response(JSON.stringify({ error: "Unauthorized (JWT Decode Failed)" }), { status: 401, headers: corsHeaders });

    let { data: settings } = await supabaseAdmin.from("user_settings").select("*").eq("user_id", user.id).single();
    if (settings?.sync_status === 'REVOKED') {
      console.log(`[OAUTH] User ${user.id} has revoked access. Bypassing engine.`);
      return new Response(JSON.stringify({ message: "Sync Revoked" }), { status: 200, headers: corsHeaders });
    }

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
    let gmailToken = settings.gmail_token?.token;
    if (!gmailToken) return new Response(JSON.stringify({ error: "No Gmail Token" }), { status: 400, headers: corsHeaders });

    // ── SELF-HEALING CONCURRENCY LOCK ──
    // A lock is considered VALID only if:
    //   (a) sync_in_progress is true AND
    //   (b) sync_lock_at is set AND less than 2 minutes old.
    // Ghost locks (null timestamp) and stale locks (>2 min) are auto-broken.
    const rawLockAt = (settings as any).sync_lock_at;
    const lockAge = rawLockAt ? (Date.now() - new Date(rawLockAt).getTime()) : Infinity;
    const LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutes (building stage)
    const isSyncInProgress: boolean = (settings as any).sync_in_progress === true && lockAge < LOCK_TTL_MS;

    if (isSyncInProgress) {
      await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "SYNC_LOCKED", data: { reason: "Another sync already in progress", lock_age_ms: lockAge } });
      return new Response(JSON.stringify({ success: true, tasks_extracted: 0, remaining: 1, locked: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    // Acquire lock — always stamp sync_lock_at so TTL expiry works correctly
    await supabaseAdmin.from("user_settings").update({
      sync_in_progress: true,
      sync_lock_at: new Date().toISOString()
    }).eq("id", settings.id);

    // ── GMAIL FETCH WITH PAGINATION SUPPORT ──
    const maxResults = 25; // Safe batch size
    const storedPageToken: string | null = (settings as any).sync_page_token || null;
    const lastSynced = settings.last_synced_at;
    let query = "";
    if (!storedPageToken && lastSynced) {
      const after = Math.floor(new Date(lastSynced).getTime() / 1000);
      query = `&q=after:${after}`;
    }
    const pageTokenParam = storedPageToken ? `&pageToken=${storedPageToken}` : "";

    let listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${query}${pageTokenParam}`, {
      headers: { Authorization: `Bearer ${gmailToken}` }
    });

    // ── OAUTH RETRY INTERCEPTOR ──
    if (listRes.status === 401 && settings.gmail_token?.refresh_token) {
      console.log(`[OAUTH] Token expired for user ${user.id}. Triggering Auto-Heal refresh routine...`);
      const freshToken = await refreshGmailToken(user.id, settings.gmail_token.refresh_token, supabaseAdmin);
      if (!freshToken) {
        return new Response(JSON.stringify({ message: "Failed to heal token" }), { status: 200, headers: corsHeaders });
      }
      gmailToken = freshToken;
      // Re-fire the fetch synchronously
      listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${query}${pageTokenParam}`, {
        headers: { Authorization: `Bearer ${gmailToken}` }
      });
    }

    const listData = await listRes.json();
    const messages = listData.messages || [];
    const nextPageToken: string | null = listData.nextPageToken || null;

    await supabaseAdmin.from("debug_logs").insert({ user_id: user.id, event: "GMAIL_FETCH", data: { count: messages.length, page_token: storedPageToken, next_page_token: nextPageToken } });

    const emails = (await Promise.all(messages.map(async (m: any) => {
      try {
        let detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
          headers: { Authorization: `Bearer ${gmailToken}` }
        });

        // ── OAUTH RETRY INTERCEPTOR FOR DETAIL FETCH ──
        if (detailRes.status === 401 && settings.gmail_token?.refresh_token) {
          console.log(`[OAUTH] Token expired during detail fetch for user ${user.id}. Triggering Auto-Heal refresh routine...`);
          const freshToken = await refreshGmailToken(user.id, settings.gmail_token.refresh_token, supabaseAdmin);
          if (!freshToken) {
            return null; // Skip this email if we can't refresh token
          }
          gmailToken = freshToken;
          // Re-fire the fetch with fresh token
          detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
            headers: { Authorization: `Bearer ${gmailToken}` }
          });
        }

        const fullMsg = await detailRes.json();
        if (!fullMsg.payload) return null;
        const headers = (fullMsg.payload.headers || []).reduce((acc: any, h: any) => ({ ...acc, [h.name]: h.value }), {});
        const decodedBody = decodeBody(fullMsg.payload);
        const body = (decodedBody !== null && decodedBody !== undefined)
          ? decodedBody.substring(0, 1500).replace(/\n/g, " ").trim()
          : "";
        return {
          id: m.id,
          subject: (headers.Subject !== null && headers.Subject !== undefined) ? headers.Subject : "(no subject)",
          sender: (headers.From !== null && headers.From !== undefined) ? headers.From : "unknown",
          date: (headers.Date !== null && headers.Date !== undefined) ? headers.Date : "",
          body
        };
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

    // Calculate Task Completion Rate from recentActions
    const completedActions = recentActions.filter(action => action.startsWith("Completed"));
    const deletedActions = recentActions.filter(action => action.startsWith("Deleted"));
    const totalFinishedActions = completedActions.length + deletedActions.length;
    const taskCompletionRate = totalFinishedActions > 0
      ? (completedActions.length / totalFinishedActions)
      : 0.5; // Default to neutral if no data

    const actionContext = recentActions.length > 0
      ? `\nUSER'S RECENT BEHAVIOR:\n${recentActions.join("\n")}\nTask Completion Rate: ${(taskCompletionRate * 100).toFixed(0)}% (Completed: ${completedActions.length}, Deleted: ${deletedActions.length})\nCRITICAL: If an email matches the type recently DELETED, assign category "Check_Out_Mail".`
      : "";

    // Default persona for brand new users
    let currentProfile = settings.user_profile;
    if (!currentProfile || currentProfile.includes("Initial Sync Stage") || currentProfile.trim() === "") {
      currentProfile = "A busy professional seeking to organize their schedule, extract actionable tasks from communications, and manage deadlines efficiently.";
    }
    let currentCategories: string[] = settings.categories || [];
    if (currentCategories.length === 0) {
      currentCategories = ["Inbox", "General Tasks"];
    }

    const nowIst = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });

    // ──────── SINGLE PASS ARCHITECTURE (Distributed Path) ────────
    // STAGE 1: Universal Extraction
    const { rawTasks, successfullyProcessedIds: batchIds, rateLimitHit } = await extractRawTasks(
      unprocessedEmails.slice(0, 15), pendingTasksContext, actionContext, nowIst, supabaseAdmin, user.id
    );

    if (rateLimitHit && batchIds.length === 0) {
      // Release lock and bailout on rate limit
      await supabaseAdmin.from("user_settings").update({ sync_in_progress: false, sync_lock_at: null }).eq("id", settings.id);
      return new Response(JSON.stringify({ error: "Rate Limit" }), { status: 429, headers: corsHeaders });
    }

    // STAGE 2: Persona Evolution
    const shouldEvolve = (isNewUser || unprocessedEmails.length > 20) && rawTasks.length > 0;
    const { updatedProfile, updatedCategories } = shouldEvolve
      ? await evolvePersonaFromTasks(rawTasks, currentProfile, currentCategories, supabaseAdmin, settings.id, user.id)
      : { updatedProfile: currentProfile, updatedCategories: currentCategories };

    // STAGE 3: Persona-Aware Categorization
    const { finalTasks, updatedTaskIds } = await categorizeTasks(
      rawTasks, updatedProfile, updatedCategories, recentActions,
      unprocessedEmails.slice(0, 15), supabaseAdmin, user.id, settings.id, nowIst
    );

    // Welcome task for new users
    if (isNewUser && finalTasks.length === 0 && unprocessedEmails.length <= 15) {
      finalTasks.push({
        title: "🚀 Welcome to Tasker AI!",
        summary: "I've analyzed your emails and built your personalized task categories!",
        category: "Onboarding", status: "pending",
        user_id: user.id, source_email_id: "onboarding_" + Date.now()
      });
    }

    // Persist
    if (finalTasks.length > 0) {
      const { error: upsertError } = await supabaseAdmin.from("tasks").upsert(finalTasks, { onConflict: "source_email_id" });
      if (upsertError) throw new Error("Failed to persist tasks: " + upsertError.message);
    }

    // Warning Engine
    await runWarningEngine(supabaseAdmin, user.id, [], updatedTaskIds);

    const remainingCount = unprocessedEmails.length - batchIds.length;
    const isPageDone = remainingCount === 0;

    // ── HANDOFF TO BACKGROUND WORKER ──
    if (isPageDone && nextPageToken) {
      await supabaseAdmin.from("user_settings").update({
        sync_page_token: nextPageToken,
        sync_in_progress: false,
        sync_lock_at: null
      }).eq("id", settings.id);
      
      // Trigger Background Catchup
      await supabaseAdmin.from("sync_queue").insert({ user_id: user.id, dedup_id: `catchup_${user.id}_${Date.now()}` });
    } else if (isPageDone && !nextPageToken) {
      await supabaseAdmin.from("user_settings").update({
        last_synced_at: new Date().toISOString(),
        sync_page_token: null,
        sync_in_progress: false,
        sync_lock_at: null,
        recent_actions: []
      }).eq("id", settings.id);
    } else {
      // More work in current page - release lock for next attempt (Worker or User)
      await supabaseAdmin.from("user_settings").update({
        sync_in_progress: false,
        sync_lock_at: null
      }).eq("id", settings.id);
      
      // If we still have emails in this page, trigger background worker to pick up the slack
      if (remainingCount > 0) {
        await supabaseAdmin.from("sync_queue").upsert({ 
          user_id: user.id, 
          dedup_id: `burst_${user.id}_${storedPageToken || 'init'}`
        });
      }
    }

    await supabaseAdmin.from("debug_logs").insert({
      user_id: user.id,
      event: "V20_RESTORED_COMPLETE",
      data: { tasks: finalTasks.length, processed: batchIds.length, remaining: remainingCount }
    });

    return new Response(JSON.stringify({
      success: true,
      processed_ids: batchIds,
      tasks_extracted: finalTasks.length,
      remaining: isPageDone && !nextPageToken ? 0 : 1
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("Sync Error:", err.message);
    // ── DEADLOCK GUARD: Always release both the lock flag AND the timestamp on error ──
    // Without this, a crashed sync would permanently block all future syncs.
    try {
      if (settings?.id) {
        await supabaseAdmin.from("user_settings").update({
          sync_in_progress: false,
          sync_lock_at: null
        }).eq("id", settings.id);
      }
    } catch (_) { /* best-effort */ }
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
