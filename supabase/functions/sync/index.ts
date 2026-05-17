import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { decodeBody, sleep } from "../_shared/utils.ts";
import { refreshGmailToken } from "../_shared/oauth.ts";
import { extractRawTasks, evolvePersonaFromTasks, categorizeTasks, runWarningEngine } from "../_shared/stages.ts";

// ─────────────────────────────────────────────
// Supabase Edge Runtime Background Task Helper
// Safely wraps EdgeRuntime.waitUntil for fire-and-forget work.
// ─────────────────────────────────────────────
function fireAndForget(promise: Promise<any>) {
  try {
    // @ts-ignore: EdgeRuntime is a Supabase-specific global
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(promise);
    }
  } catch {
    // Fallback: let the promise run without tracking
    promise.catch(err => console.error("[BG Task Error]", err));
  }
}

// Non-blocking debug_logs helper — fire-and-forget via EdgeRuntime.waitUntil
function asyncLog(supabaseAdmin: any, userId: string, event: string, data: any) {
  const promise = supabaseAdmin.from("debug_logs").insert({ user_id: userId, event, data })
    .then(() => {})
    .catch((err: any) => console.error(`[ASYNC LOG] ${event} failed:`, err.message));
  fireAndForget(promise);
}

// ─────────────────────────────────────────────
// MAIN EDGE FUNCTION HANDLER
// ─────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Declare at top-level for error handler access
  let settings: any = null;
  let supabaseAdmin: any = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing Auth" }), { status: 401, headers: corsHeaders });

    supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let user: any = null;
    let reqBody: any = {};
    try { reqBody = await req.json(); } catch { }
    let tokenStr = authHeader.replace(/^Bearer\s+/i, "").trim();

    // Check if this is a service role key (used by background_worker)
    // Service keys are JWTs with role="service_role" in the payload
    try {
      const parts = tokenStr.split('.');
      if (parts.length === 3) {
        const base64Url = parts[1];
        let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const pad = base64.length % 4;
        if (pad) base64 += '='.repeat(4 - pad);
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        const payload = JSON.parse(jsonPayload);
        if (payload.role === "service_role" && reqBody.user_id) {
          user = { id: reqBody.user_id };
        } else if (payload.sub) {
          user = { id: payload.sub, email: payload.email || "" };
        }
      }
    } catch (e: any) {
      console.warn("JWT decode failed, trying fallback...", e.message);
    }

    // Fallback for user session tokens that failed manual decode
    if (!user) {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(tokenStr);
      if (authData?.user) {
        user = { id: authData.user.id, email: authData.user.email };
      } else {
        console.error("Fallback getUser failed:", authErr?.message);
      }
    }

    if (!user) return new Response(JSON.stringify({ error: "Unauthorized (JWT Decode Failed)" }), { status: 401, headers: corsHeaders });

    let { data: settingsData } = await supabaseAdmin.from("user_settings").select("*").eq("user_id", user.id).single();
    settings = settingsData;

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

      asyncLog(supabaseAdmin, user.id, "USER_BOOTSTRAPPED", {});

      // Register Gmail Webhook Watch
      try {
        await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
          method: "POST", headers: { Authorization: `Bearer ${reqBody.providerToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ labelIds: ["INBOX"], topicName: `projects/${Deno.env.get("GOOGLE_CLOUD_PROJECT_ID")}/topics/tasker-gmail-push` })
        });
      } catch (e: any) { console.warn("Gmail watch error:", e.message); }
    }

    asyncLog(supabaseAdmin, user.id, "V21_SYNC_START", {});

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
      asyncLog(supabaseAdmin, user.id, "SYNC_LOCKED", { reason: "Another sync already in progress", lock_age_ms: lockAge });
      return new Response(JSON.stringify({ success: true, tasks_extracted: 0, remaining: 0, locked: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── ATOMIC LOCK ACQUISITION ──
    let lockAcquired: any[] = [];
    const isStaleLock = (settings as any).sync_in_progress === true && lockAge >= LOCK_TTL_MS;

    if (isStaleLock) {
      // Force-break stale lock — no conditional needed
      const { data } = await supabaseAdmin
        .from("user_settings")
        .update({ sync_in_progress: true, sync_lock_at: new Date().toISOString() })
        .eq("id", settings.id)
        .select("id");
      lockAcquired = data || [];
      asyncLog(supabaseAdmin, user.id, "SYNC_LOCK_BROKEN", { reason: "Stale lock auto-healed", lock_age_ms: lockAge });
    } else {
      // Normal case: conditional UPDATE prevents concurrent race
      const { data } = await supabaseAdmin
        .from("user_settings")
        .update({ sync_in_progress: true, sync_lock_at: new Date().toISOString() })
        .eq("id", settings.id)
        .eq("sync_in_progress", false)
        .select("id");
      lockAcquired = data || [];
    }

    if (!lockAcquired || lockAcquired.length === 0) {
      asyncLog(supabaseAdmin, user.id, "SYNC_LOCKED", { reason: "Atomic lock acquisition failed — concurrent sync won the race" });
      return new Response(JSON.stringify({ success: true, tasks_extracted: 0, remaining: 0, locked: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── GMAIL FETCH WITH PAGINATION SUPPORT ──
    const maxResults = 25; // Optimal batch size for 120 RPM (4 keys × 30 RPM)
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

    asyncLog(supabaseAdmin, user.id, "GMAIL_FETCH", { count: messages.length, page_token: storedPageToken, next_page_token: nextPageToken });

    // ── SEQUENTIAL DETAIL FETCH WITH SINGLE-REFRESH MUTEX ──
    // BUG FIX: Previously used Promise.all which caused up to 25 concurrent OAuth refresh calls.
    // Now fetches sequentially with a single-refresh guard to prevent token refresh storms.
    let tokenRefreshed = false;
    const emails: any[] = [];
    for (const m of messages) {
      try {
        let detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
          headers: { Authorization: `Bearer ${gmailToken}` }
        });

        // ── OAUTH RETRY INTERCEPTOR (Single-Refresh Guard) ──
        if (detailRes.status === 401 && !tokenRefreshed && settings.gmail_token?.refresh_token) {
          console.log(`[OAUTH] Token expired during detail fetch for user ${user.id}. Refreshing once...`);
          const freshToken = await refreshGmailToken(user.id, settings.gmail_token.refresh_token, supabaseAdmin);
          if (freshToken) {
            gmailToken = freshToken;
            tokenRefreshed = true;
            // Re-fire with fresh token
            detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
              headers: { Authorization: `Bearer ${gmailToken}` }
            });
          } else {
            continue; // Skip this email if refresh failed
          }
        } else if (detailRes.status === 401) {
          continue; // Token already refreshed once and still failing — skip
        }

        const fullMsg = await detailRes.json();
        if (!fullMsg.payload) continue;
        const headers = (fullMsg.payload.headers || []).reduce((acc: any, h: any) => ({ ...acc, [h.name]: h.value }), {});
        const decodedBody = decodeBody(fullMsg.payload);
        const body = (decodedBody !== null && decodedBody !== undefined)
          ? decodedBody.substring(0, 1500).replace(/\n/g, " ").trim()
          : "";
        emails.push({
          id: m.id,
          subject: (headers.Subject !== null && headers.Subject !== undefined) ? headers.Subject : "(no subject)",
          sender: (headers.From !== null && headers.From !== undefined) ? headers.From : "unknown",
          date: (headers.Date !== null && headers.Date !== undefined) ? headers.Date : "",
          body
        });
      } catch { /* skip failed email */ }
    }

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

    // ══════════════════════════════════════════════════════════════
    // CONCURRENT MATRIX ARCHITECTURE
    // ══════════════════════════════════════════════════════════════

    // STAGE 1: Universal Extraction (must complete before categorization)
    const { rawTasks, successfullyProcessedIds: batchIds, rateLimitHit } = await extractRawTasks(
      unprocessedEmails.slice(0, 15), pendingTasksContext, actionContext, nowIst, supabaseAdmin, user.id
    );

    if (rateLimitHit && batchIds.length === 0) {
      // Release lock and bailout on rate limit
      await supabaseAdmin.from("user_settings").update({ 
        sync_in_progress: false, 
        sync_lock_at: null,
        last_sync_error: "⚠️ AI Sync paused due to high demand. Retrying in 60s..."
      }).eq("id", settings.id);
      return new Response(JSON.stringify({ error: "Rate Limit" }), { status: 429, headers: corsHeaders });
    }

    // ── THE CONCURRENT SPLIT ──
    // Stage 2 (Persona Evolution) runs in the BACKGROUND via EdgeRuntime.waitUntil.
    // Stage 3 (Categorization) runs on the CURRENT profile immediately.
    // Result: We remove an entire LLM roundtrip from the critical path!
    const shouldEvolve = (isNewUser || unprocessedEmails.length > 20) && rawTasks.length > 0;
    if (shouldEvolve) {
      fireAndForget(
        evolvePersonaFromTasks(rawTasks, currentProfile, currentCategories, supabaseAdmin, settings.id, user.id)
      );
    }

    // STAGE 3: Persona-Aware Categorization (uses current profile, doesn't wait for evolution)
    const { finalTasks, updatedTaskIds } = await categorizeTasks(
      rawTasks, currentProfile, currentCategories, recentActions,
      unprocessedEmails.slice(0, 15), supabaseAdmin, user.id, settings.id, nowIst
    );

    // Persist ghost tasks for emails that produced no actionable tasks
    const batchEmails = unprocessedEmails.slice(0, 15);
    const processedEmailIds = new Set(finalTasks.map(t => t.source_email_id));
    const ghostTasks = batchEmails
      .filter(e => !processedEmailIds.has(e.id))
      .map(e => ({
        title: "[IGNORED_EMAIL]",
        summary: "Email skipped – no actionable tasks detected",
        category: "System",
        status: "ignored",
        user_id: user.id,
        source_email_id: e.id,
      }));

    // Welcome task for new users — check batch size, not total unprocessed
    if (isNewUser && finalTasks.length === 0 && batchEmails.length <= 15) {
      finalTasks.push({
        title: "🚀 Welcome to Tasker AI!",
        summary: ghostTasks.length > 0 
          ? `I've analyzed your first ${batchEmails.length} emails. Good news: ${ghostTasks.length} promotional/spam emails were cleanly filtered out with zero clutter added to your list! I've also built your personalized task categories.`
          : "I've analyzed your emails and built your personalized task categories!",
        category: "Onboarding", status: "pending",
        user_id: user.id, source_email_id: "onboarding_" + Date.now()
      });
    }

    // Combine ghost tasks with any real tasks before upsert
    const allTasksToUpsert = [...finalTasks, ...ghostTasks].map(t => ({
      ...t,
      status: t.status || "pending"
    }));
    if (allTasksToUpsert.length > 0) {
      console.log(`[UPSERT] Attempting to upsert ${allTasksToUpsert.length} tasks (real: ${finalTasks.length}, ghost: ${ghostTasks.length})`);
      try {
        const { error: upsertError } = await supabaseAdmin.from("tasks").upsert(allTasksToUpsert, { onConflict: "source_email_id" });
        if (upsertError) {
          asyncLog(supabaseAdmin, user.id, "UPsert_ERROR", { error: upsertError.message, count: allTasksToUpsert.length });
          throw new Error("Failed to persist tasks: " + upsertError.message);
        }
        console.log(`[UPSERT] Success`);
      } catch (e: any) {
        asyncLog(supabaseAdmin, user.id, "UPsert_CRASH", { error: e.message });
        throw e;
      }
    }

    // Warning Engine — fire-and-forget via EdgeRuntime.waitUntil (pure DB I/O)
    // BUG FIX #6: Always run the warning engine to keep deadline badges fresh
    fireAndForget(runWarningEngine(supabaseAdmin, user.id, finalTasks, updatedTaskIds));

    const remainingCount = unprocessedEmails.length - batchIds.length;
    const isPageDone = remainingCount === 0;

    // ── HANDOFF TO BACKGROUND WORKER ──
    console.log(`[HANDOFF] isPageDone=${isPageDone}, nextPageToken=${nextPageToken}, remainingCount=${remainingCount}`);
    if (isPageDone && nextPageToken) {
      await supabaseAdmin.from("user_settings").update({
        sync_page_token: nextPageToken,
        last_synced_at: new Date().toISOString(),
        sync_in_progress: false,
        sync_lock_at: null,
        last_sync_error: null
      }).eq("id", settings.id);
      
      // Trigger Background Catchup
      await supabaseAdmin.from("sync_queue").insert({ user_id: user.id, dedup_id: `catchup_${user.id}_${Date.now()}` });
    } else if (isPageDone && !nextPageToken) {
      await supabaseAdmin.from("user_settings").update({
        last_synced_at: new Date().toISOString(),
        sync_page_token: null,
        sync_in_progress: false,
        sync_lock_at: null,
        last_sync_error: null,
        recent_actions: []
      }).eq("id", settings.id);
    } else {
      // More work in current page - release lock for next attempt (Worker or User)
      await supabaseAdmin.from("user_settings").update({
        sync_in_progress: false,
        sync_lock_at: null,
        last_synced_at: new Date().toISOString(),
        last_sync_error: null
      }).eq("id", settings.id);
      
      // If we still have emails in this page, trigger background worker to pick up the slack
      if (remainingCount > 0) {
        await supabaseAdmin.from("sync_queue").upsert({ 
          user_id: user.id, 
          dedup_id: `burst_${user.id}_${storedPageToken || 'init'}`
        });
      }
    }

    asyncLog(supabaseAdmin, user.id, "V21_MODULAR_COMPLETE", { tasks: finalTasks.length, processed: batchIds.length, remaining: remainingCount });

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
          sync_lock_at: null,
          last_sync_error: `❌ Sync error: ${err.message}`
        }).eq("id", settings.id);
      }
    } catch (_) { /* best-effort */ }
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
