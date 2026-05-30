import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { decodeBody, sleep, cleanEmailBody, isSpamOrAd, isWorthProcessing, processInBatches } from "../_shared/utils.ts";
import { refreshGmailToken } from "../_shared/oauth.ts";
import { GraphRAGStore, getEmbedding, ContextualTaskExtractor } from "../_shared/graph.ts";

// ─────────────────────────────────────────────
// Constants — Groq free-tier aware
// ─────────────────────────────────────────────
const CALLS_PER_THREAD = 1;        // 1 Groq LLM extraction per thread (embedding is local via gte-small, not a Groq call)
const GROQ_RPM_AGGREGATE = 120;    // 4 keys × 30 RPM
const RATE_LIMIT_SECS_PER_THREAD = 60 / (GROQ_RPM_AGGREGATE / CALLS_PER_THREAD); // ~0.5s
const SAFETY_FACTOR = 1.3;
const SECS_PER_QUEUED_USER = 60;

const THREAD_BATCH = 20;           // threads per sync call
const DEDUP_THRESHOLD = 0.97;      // cosine similarity for near-duplicate skip
const MAX_CONSECUTIVE_SKIPS = 3;   // guardrail: never skip more than 3 in a row

// ─────────────────────────────────────────────
// Supabase Edge Runtime fire-and-forget helper
// ─────────────────────────────────────────────
function fireAndForget(promise: Promise<any>) {
  // Always attach .catch() first — prevents unhandled rejection in all environments
  // (including local/test where EdgeRuntime is undefined)
  const safePromise = promise.catch((err: any) => console.error("[BG Task Error]", err));
  try {
    // @ts-ignore: EdgeRuntime is Supabase-specific
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(safePromise);
    }
  } catch (e: any) {
    console.warn("[fireAndForget] EdgeRuntime.waitUntil unavailable:", e.message);
  }
}

function asyncLog(supabaseAdmin: any, userId: string, event: string, data: any) {
  const p = supabaseAdmin.from("debug_logs").insert({ user_id: userId, event, data })
    .then(() => {}).catch((e: any) => console.error(`[ASYNC LOG] ${event} failed:`, e.message));
  fireAndForget(p);
}

// ─────────────────────────────────────────────
// Build Gmail query from sync_flags
// ─────────────────────────────────────────────
function buildGmailQuery(syncFlags: any, lastSyncedAt: string | null): string {
  const parts: string[] = [];

  // Base noise filter
  parts.push("NOT category:promotions AND NOT category:social AND NOT category:updates");

  // Source filters from wizard selection
  const sources: string[] = [];
  // Guard against empty array — `[] || default` does NOT trigger because [] is truthy.
  // Explicitly check length so an empty selection falls back to safe defaults.
  const rawLabels: string[] = syncFlags?.gmail_labels;
  const labels: string[] = (Array.isArray(rawLabels) && rawLabels.length > 0)
    ? rawLabels
    : ["IMPORTANT", "INBOX"];
  if (labels.includes("IMPORTANT")) sources.push("is:important");
  if (labels.includes("INBOX"))     sources.push("in:inbox");
  if (labels.includes("SENT"))      sources.push("in:sent");
  for (const id of (syncFlags?.custom_label_ids || [])) {
    sources.push(`label:${id}`);
  }
  // Defense-in-depth: if sources is still empty after processing all flags,
  // force-scope to INBOX to prevent an unbounded full-archive Gmail query.
  if (sources.length === 0) sources.push("in:inbox");
  parts.push(`(${sources.join(" OR ")})`);

  // Tracking preference keyword enrichment
  const prefs: string[] = syncFlags?.tracking_preferences || [];
  const keywordMap: Record<string, string> = {
    tasks:     "(action OR task OR \"to do\" OR \"follow up\" OR deadline OR \"please confirm\")",
    deadlines: "(deadline OR due OR \"by end of\" OR commit OR \"please complete\" OR \"by tomorrow\")",
    people:    "(introduction OR \"following up\" OR meeting OR contact OR schedule OR \"let's connect\")",
    projects:  "(project OR milestone OR sprint OR update OR launch OR release OR \"next steps\")",
  };
  const kwParts = prefs.filter(p => keywordMap[p]).map(p => keywordMap[p]);
  if (kwParts.length > 0) parts.push(`(${kwParts.join(" OR ")})`);

  // Time filter — use last_synced_at for returning users, lookback_days for new users
  if (lastSyncedAt) {
    const after = Math.floor(new Date(lastSyncedAt).getTime() / 1000);
    parts.push(`after:${after}`);
  } else {
    const days = syncFlags?.lookback_days || 30;
    const after = Math.floor((Date.now() - days * 24 * 3600 * 1000) / 1000);
    parts.push(`after:${after}`);
  }

  return parts.join(" ");
}

// ─────────────────────────────────────────────
// MAIN EDGE FUNCTION HANDLER
// ─────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let settings: any = null;
  let supabaseAdmin: any = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing Auth" }), { status: 401, headers: corsHeaders });

    supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("MY_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
    );

    let user: any = null;
    let reqBody: any = {};
    try { reqBody = await req.json(); } catch { }
    let tokenStr = authHeader.replace(/^Bearer\s+/i, "").trim();

    // Service-role call from background_worker
    const serviceKey = (Deno.env.get("MY_SERVICE_ROLE_KEY") ?? (Deno.env.get("MY_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "").trim();
    if (tokenStr === serviceKey && reqBody.user_id) {
      user = { id: reqBody.user_id };
    } else {
      try {
        const parts = tokenStr.split(".");
        if (parts.length === 3) {
          const base64Url = parts[1];
          let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
          const pad = base64.length % 4;
          if (pad) base64 += "=".repeat(4 - pad);
          const jsonPayload = decodeURIComponent(
            atob(base64).split("").map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
          );
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
    }

    if (!user) {
      const { data: authData } = await supabaseAdmin.auth.getUser(tokenStr);
      if (authData?.user) {
        user = { id: authData.user.id, email: authData.user.email };
      }
    }

    if (!user) return new Response(JSON.stringify({ error: "Unauthorized (JWT Decode Failed)" }), { status: 401, headers: corsHeaders });

    // ── Fetch settings ──
    const { data: settingsData } = await supabaseAdmin.from("user_settings").select("*").eq("user_id", user.id).single();
    settings = settingsData;

    if (settings?.sync_status === "REVOKED") {
      return new Response(JSON.stringify({ message: "Sync Revoked" }), { status: 200, headers: corsHeaders });
    }

    // ── ONBOARDING BOOTSTRAP (first-ever call) ──
    if (!settings) {
      if (!reqBody.providerToken) {
        return new Response(JSON.stringify({ error: "Settings not found and no Gmail token provided" }), { status: 404, headers: corsHeaders });
      }

      const syncFlags = reqBody.sync_flags || {};
      settings = {
        user_id: user.id,
        gmail_email: user.email,
        gmail_token: { token: reqBody.providerToken, refresh_token: reqBody.providerRefreshToken || null },
        last_synced_at: null,
        sync_flags: syncFlags,
        onboarding_status: "queued",
        onboarding_progress: {},
      };

      const { data: inserted, error: insertError } = await supabaseAdmin.from("user_settings").insert(settings).select().single();
      if (insertError) throw new Error("Failed to bootstrap user settings: " + insertError.message);
      settings = inserted;
      asyncLog(supabaseAdmin, user.id, "USER_BOOTSTRAPPED", { sync_flags: syncFlags });

      // Register Gmail Watch
      try {
        await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
          method: "POST",
          headers: { Authorization: `Bearer ${reqBody.providerToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ labelIds: ["INBOX"], topicName: `projects/${Deno.env.get("GOOGLE_CLOUD_PROJECT_ID")}/topics/tasker-gmail-push` })
        });
      } catch (e: any) { console.warn("Gmail watch error:", e.message); }
    } else if (reqBody.providerToken) {
      // Returning user — refresh stored OAuth tokens with freshly issued ones from the sign-in
      await supabaseAdmin.from("user_settings").update({
        gmail_token: { token: reqBody.providerToken, refresh_token: reqBody.providerRefreshToken || settings.gmail_token?.refresh_token || null }
      }).eq("user_id", user.id);
      settings.gmail_token = { token: reqBody.providerToken, refresh_token: reqBody.providerRefreshToken || settings.gmail_token?.refresh_token || null };
      asyncLog(supabaseAdmin, user.id, "GMAIL_TOKEN_REFRESHED", { source: "providerToken_in_request" });
    }

    // ── Update sync_flags if passed (wizard completion) ──
    if (reqBody.sync_flags && settings) {
      await supabaseAdmin.from("user_settings").update({
        sync_flags: reqBody.sync_flags,
        onboarding_status: "queued"
      }).eq("user_id", user.id);
      settings.sync_flags = reqBody.sync_flags;
    }

    // ── bootstrap_only: save settings + enqueue job, return immediately ──
    if (reqBody.bootstrap_only) {
      // Upsert onboarding job — if it already exists, reset it back to 'pending'
      // so re-tries from the wizard always work (dedup_id has a UNIQUE constraint)
      await supabaseAdmin.from("sync_queue").upsert({
        user_id: user.id,
        dedup_id: `onboarding_${user.id}`,
        priority: "onboarding",
        status: "pending",
        retry_count: 0,
        next_retry_at: null,
      }, { onConflict: "dedup_id" });

      // Mark onboarding as queued in user_settings
      await supabaseAdmin.from("user_settings").update({ onboarding_status: "queued" }).eq("user_id", user.id);

      // Compute queue position for estimate
      const { data: queuePos } = await supabaseAdmin.rpc("get_onboarding_queue_position", { p_user_id: user.id });

      // ── REACTIVE TRIGGER: Wake background_worker immediately ──
      // Fire-and-forget to start draining the queue immediately so onboarding isn't stuck
      const trigger = supabaseAdmin.functions.invoke("background_worker", { body: {} })
        .catch((e: any) => console.warn("[Sync] Worker trigger failed:", e.message));
      fireAndForget(trigger);

      return new Response(JSON.stringify({
        success: true,
        message: "Onboarding queued",
        queue_position: queuePos ?? 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    asyncLog(supabaseAdmin, user.id, "GRAPHRAG_SYNC_START", {});

    const isOnboarding = settings.onboarding_status === 'queued' || settings.onboarding_status === 'processing';
    let gmailToken = settings.gmail_token?.token;
    if (!gmailToken) return new Response(JSON.stringify({ error: "No Gmail Token" }), { status: 400, headers: corsHeaders });

    // ── SELF-HEALING CONCURRENCY LOCK ──
    const rawLockAt = settings.sync_lock_at;
    const lockAge = rawLockAt ? (Date.now() - new Date(rawLockAt).getTime()) : Infinity;
    const LOCK_TTL_MS = 2 * 60 * 1000;
    const isSyncInProgress = settings.sync_in_progress === true && lockAge < LOCK_TTL_MS;

    if (isSyncInProgress) {
      asyncLog(supabaseAdmin, user.id, "SYNC_LOCKED", { reason: "Another sync in progress", lock_age_ms: lockAge });
      return new Response(JSON.stringify({ success: true, threads_processed: 0, locked: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── ATOMIC LOCK ACQUISITION ──
    let lockAcquired: any[] = [];
    const isStaleLock = settings.sync_in_progress === true && lockAge >= LOCK_TTL_MS;

    if (isStaleLock) {
      const { data } = await supabaseAdmin.from("user_settings")
        .update({ sync_in_progress: true, sync_lock_at: new Date().toISOString() })
        .eq("id", settings.id).eq("sync_lock_at", rawLockAt).select("id");
      lockAcquired = data || [];
      asyncLog(supabaseAdmin, user.id, "SYNC_LOCK_BROKEN", { lock_age_ms: lockAge });
    } else {
      const { data } = await supabaseAdmin.from("user_settings")
        .update({ sync_in_progress: true, sync_lock_at: new Date().toISOString() })
        .eq("id", settings.id).eq("sync_in_progress", false).select("id");
      lockAcquired = data || [];
    }

    if (!lockAcquired || lockAcquired.length === 0) {
      asyncLog(supabaseAdmin, user.id, "SYNC_LOCKED", { reason: "Atomic lock failed — concurrent sync won the race" });
      return new Response(JSON.stringify({ success: true, threads_processed: 0, locked: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── GMAIL THREAD FETCH — Thread-First with Progressive Fallback ──
    const syncFlags = settings.sync_flags || {};
    const fullQuery = buildGmailQuery(syncFlags, settings.last_synced_at);

    // Get queue position for ETA calculation
    const { data: queuePosition } = await supabaseAdmin.rpc("get_onboarding_queue_position", { p_user_id: user.id });
    const queuePos = queuePosition ?? 0;

    let threadIds: string[] = [];
    let passUsed = 1;

    let tokenRefreshedOnList = false;
    const fetchThreadList = async (query: string, maxThreads: number = 5): Promise<any[]> => {
      let pageToken = settings.sync_page_token || "";
      let fetched: any[] = [];
      
      while (fetched.length < maxThreads) {
        const ptParam = pageToken ? `&pageToken=${pageToken}` : "";
        let res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=${THREAD_BATCH}&q=${encodeURIComponent(query)}${ptParam}`,
          { headers: { Authorization: `Bearer ${gmailToken}` } }
        );
        if (res.status === 401 && !tokenRefreshedOnList && settings.gmail_token?.refresh_token) {
          const fresh = await refreshGmailToken(user.id, settings.gmail_token.refresh_token, supabaseAdmin);
          if (fresh) { gmailToken = fresh; tokenRefreshedOnList = true; }
          res = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=${THREAD_BATCH}&q=${encodeURIComponent(query)}${ptParam}`,
            { headers: { Authorization: `Bearer ${gmailToken}` } }
          );
        }
        if (!res.ok) break;
        const d = await res.json();
        const batch = d.threads || [];
        fetched.push(...batch);
        
        if (d.nextPageToken) {
          pageToken = d.nextPageToken;
        } else {
          pageToken = "";
          break; // no more pages
        }
      }
      
      // Save the page token for the next sync run
      if (pageToken !== settings.sync_page_token) {
        await supabaseAdmin.from("user_settings").update({ sync_page_token: pageToken }).eq("user_id", user.id);
        settings.sync_page_token = pageToken;
      }
      
      return fetched;
    };

    // Pass 1: Full query (category filter + source + keywords + time)
    let threads = await fetchThreadList(fullQuery);
    asyncLog(supabaseAdmin, user.id, "THREAD_FETCH_P1", { count: threads.length, query: fullQuery });

    // Pass 2: Relax keyword terms (keep source + category filter + time limits exactly as configured)
    if (threads.length < 5) {
      passUsed = 2;
      const relaxedQuery = buildGmailQuery({ ...syncFlags, tracking_preferences: [] }, settings.last_synced_at);
      threads = await fetchThreadList(relaxedQuery);
      asyncLog(supabaseAdmin, user.id, "THREAD_FETCH_P2", { count: threads.length });
    }
    
    // (Pass 3 & 4 removed to respect user lookback_days privacy constraint)

    // Sort: threads where user replied (SENT label) go first
    // We'll check label membership after fetching full thread data below
    threadIds = [...new Set(threads.map((t: any) => t.id as string))];

    // ── PROCESS EACH THREAD ──
    let threadsProcessed = 0;
    let threadsSkippedSpam = 0;
    let threadsSkippedTrivial = 0;
    let threadsSkippedDedup = 0;
    let consecutiveSkips = 0;
    let tokenRefreshed = false;

    const graphStore = new GraphRAGStore(supabaseAdmin);

    // Update onboarding_status to 'processing'
    if (isOnboarding) {
      await supabaseAdmin.from("user_settings").update({
        onboarding_status: "processing",
        onboarding_progress: {
          threads_total: threadIds.length,
          threads_done: 0,
          eta_seconds: Math.ceil((threadIds.length * RATE_LIMIT_SECS_PER_THREAD * SAFETY_FACTOR) + (queuePos * SECS_PER_QUEUED_USER)),
          queue_position: queuePos,
        }
      }).eq("user_id", user.id);
    }

    const graphPipeline = async () => {
      await processInBatches(threadIds, 3, async (threadId) => {
        try {
          // Fetch full thread
          let threadRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
            { headers: { Authorization: `Bearer ${gmailToken}` } }
          );

          // Single-refresh guard
          if (threadRes.status === 401 && !tokenRefreshed && settings.gmail_token?.refresh_token) {
            const fresh = await refreshGmailToken(user.id, settings.gmail_token.refresh_token, supabaseAdmin);
            if (fresh) { gmailToken = fresh; tokenRefreshed = true; }
            threadRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
              { headers: { Authorization: `Bearer ${gmailToken}` } }
            );
          }
          if (!threadRes.ok) return;

          const threadData = await threadRes.json();
          const messages: any[] = threadData.messages || [];
          if (messages.length === 0) return;

          // Check if user replied (SENT label on any message in thread)
          const userReplied = messages.some((m: any) => (m.labelIds || []).includes("SENT"));

          // Use the most recent non-sent message as representative
          const firstMsg = messages.find((m: any) => !(m.labelIds || []).includes("SENT")) || messages[0];
          const headers = (firstMsg.payload?.headers || []).reduce((acc: any, h: any) => ({ ...acc, [h.name]: h.value }), {});
          const subject = headers["Subject"] || "(no subject)";
          const sender = headers["From"] || "unknown";
          const dateStr = headers["Date"] || "";
          const isImportant = (firstMsg.labelIds || []).includes("IMPORTANT");

          // Keep first 5 (context) and last 5 (latest updates)
          let selectedMessages = messages;
          let omittedText = "";
          if (messages.length > 10) {
            const first5 = messages.slice(0, 5);
            const last5 = messages.slice(-5);
            selectedMessages = [...first5, ...last5];
            omittedText = `\n\n... [${messages.length - 10} emails omitted for brevity] ...\n\n`;
          }

          // Concatenate selected messages, clean each
          const cleanedBodies = selectedMessages
            .map((m: any) => cleanEmailBody(decodeBody(m.payload) || ""))
            .filter(b => b.length > 0);

          let combinedBody = "";
          if (messages.length > 10 && cleanedBodies.length === 10) {
            combinedBody = cleanedBodies.slice(0, 5).join("\n\n---\n\n") + omittedText + cleanedBodies.slice(5).join("\n\n---\n\n");
          } else {
            combinedBody = cleanedBodies.join("\n\n---\n\n");
          }

          combinedBody = combinedBody.substring(0, 10000); // cap increased to 10,000 chars

          // ── LAYER 1: Spam/Ad heuristic (free) ──
          if (isSpamOrAd(subject, sender, combinedBody)) {
            threadsSkippedSpam++;
            asyncLog(supabaseAdmin, user.id, "THREAD_SKIP_SPAM", { thread_id: threadId, subject });
            return;
          }

          // ── LAYER 2: Trivial content guard (free) ──
          if (!isWorthProcessing(combinedBody)) {
            threadsSkippedTrivial++;
            asyncLog(supabaseAdmin, user.id, "THREAD_SKIP_TRIVIAL", { thread_id: threadId, subject });
            return;
          }

          // ── LAYER 3: Message ID dedup check ──
          // Gmail message IDs are globally unique — a simple existence check is
          // faster, cheaper, and more correct than the previous vector similarity
          // approach which ran an AI embedding model + 3 DB queries per email.
          try {
            const { data: existingMsg } = await supabaseAdmin
              .from("emails")
              .select("id")
              .eq("message_id", firstMsg.id)
              .maybeSingle();

            if (existingMsg) {
              threadsSkippedDedup++;
              consecutiveSkips++;
              asyncLog(supabaseAdmin, user.id, "THREAD_SKIP_DEDUP", { thread_id: threadId, subject });
              return;
            }
          } catch (e: any) {
            // Dedup errors are non-fatal — proceed to ingestion
            console.warn("[DEDUP] Error during message_id check:", e.message);
          }
          consecutiveSkips = 0; // reset on successful pass-through

          // ── INGEST TO GRAPH (Phase 3: Zero-Retention) ──
          const extractionResult = await graphStore.ingestEmailToGraph({
            message_id: firstMsg.id,
            subject,
            body: combinedBody,
            sender,
            thread_id: threadId,
            received_at: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
          }, user.id);

          // ── LIVE WEBHOOK TASK EXTRACTION (SRP Fixed) ──
          // We only call the LLM to extract UI Tasks if it's a live webhook.
          if (!isOnboarding && extractionResult) {
            const { entities, relationships } = extractionResult;
            const taskExtractor = new ContextualTaskExtractor();
            const contextString = `Entities: ${JSON.stringify(entities.map((e: any)=>e.name))}\nRelationships: ${JSON.stringify(relationships.map((r: any)=>`${r.source} ${r.relationType} ${r.target}`))}`;
            
            const extractedTasks = await taskExtractor.extractTasks(combinedBody, subject, contextString);

            // Instantly update the threads table for the Dashboard API
            if (extractedTasks) {
              const { error: updateErr } = await supabaseAdmin.from("threads").update({
                urgency: extractedTasks.urgency,
                action_type: extractedTasks.action_type,
                ai_summary: extractedTasks.ai_summary,
                action_items: extractedTasks.action_items,
                suggested_reply: extractedTasks.suggested_reply
              }).eq("gmail_thread_id", threadId).eq("user_id", user.id);
              
              if (updateErr) console.warn(`Failed to update thread tasks for ${threadId}:`, updateErr.message);
            }
          }

          threadsProcessed++;

          // Update progress every 5 threads
          if (isOnboarding && threadsProcessed % 5 === 0) {
            await supabaseAdmin.from("user_settings").update({
              onboarding_progress: {
                threads_total: threadIds.length,
                threads_done: threadsProcessed,
                eta_seconds: Math.ceil(((threadIds.length - threadsProcessed) * RATE_LIMIT_SECS_PER_THREAD * SAFETY_FACTOR)),
                queue_position: 0,
              }
            }).eq("user_id", user.id);
          }

        } catch (err: any) {
          console.error(`[GraphRAG] Thread ${threadId} ingestion failed:`, err.message);
          // Non-fatal — continue to next thread
        }
      });

      // ── Post-batch: build communities + finalise ──
      // DISABLED: buildCommunities() runs a full graph teardown + Louvain clustering +
      // N Groq LLM calls inline, causing Edge Function timeouts on every sync.
      // TODO: Move to a scheduled pg_cron job (e.g. every 1 hour).
      // try {
      //   await graphStore.buildCommunities();
      // } catch (e: any) {
      //   console.error("[GraphRAG] buildCommunities failed:", e.message);
      // }

      const finalUpdate: any = {
        last_synced_at: new Date().toISOString(),
        sync_in_progress: false,
        sync_lock_at: null,
        last_sync_error: null,
      };
      
      // ALWAYS mark onboarding as complete after the first batch is processed.
      // Remaining historical pages will continue syncing in the background via the background_worker,
      // and new tasks will magically pop into the user's dashboard via Realtime.
      if (isOnboarding) {
        finalUpdate.onboarding_status = "complete";
        finalUpdate.onboarding_progress = {
          threads_total: threadIds.length,
          threads_done: threadsProcessed,
          eta_seconds: 0,
          queue_position: 0,
        };
      }
      await supabaseAdmin.from("user_settings").update(finalUpdate).eq("user_id", user.id);

      asyncLog(supabaseAdmin, user.id, "GRAPHRAG_SYNC_COMPLETE", {
        threads_fetched: threadIds.length,
        threads_processed: threadsProcessed,
        threads_skipped_spam: threadsSkippedSpam,
        threads_skipped_trivial: threadsSkippedTrivial,
        threads_skipped_dedup: threadsSkippedDedup,
        pass_used: passUsed,
      });
    };

    // Onboarding: await the pipeline so the final status update always commits before exit.
    // Live webhook syncs: fire-and-forget so we return 200 immediately.
    if (isOnboarding) {
      await graphPipeline();
    } else {
      fireAndForget(graphPipeline());
    }

    // Estimate for frontend progress screen
    const estimatedSeconds = Math.ceil(
      (threadIds.length * RATE_LIMIT_SECS_PER_THREAD * SAFETY_FACTOR) +
      (queuePos * SECS_PER_QUEUED_USER)
    );

    return new Response(JSON.stringify({
      success: true,
      threads_fetched: threadIds.length,
      estimated_total_seconds: estimatedSeconds,
      queue_position: queuePos,
      pass_used: passUsed,
      remaining: settings.sync_page_token ? 1 : 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("Sync Error:", err.message);
    try {
      if (settings?.id) {
        await supabaseAdmin.from("user_settings").update({
          sync_in_progress: false,
          sync_lock_at: null,
          last_sync_error: `❌ Sync error: ${err.message}`
        }).eq("id", settings.id);
      }
    } catch (_) { /* best-effort */ }
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: getCorsHeaders(req) });
  }
});
