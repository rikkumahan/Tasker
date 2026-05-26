import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { decodeBody, sleep, cleanEmailBody, isSpamOrAd, isWorthProcessing } from "../_shared/utils.ts";
import { refreshGmailToken } from "../_shared/oauth.ts";
import { GraphRAGStore } from "../_shared/graph.ts";

// ─────────────────────────────────────────────
// Constants — Groq free-tier aware
// ─────────────────────────────────────────────
const CALLS_PER_THREAD = 2;        // 1 LLM extraction + 1 embedding
const GROQ_RPM_AGGREGATE = 120;    // 4 keys × 30 RPM
const RATE_LIMIT_SECS_PER_THREAD = 60 / (GROQ_RPM_AGGREGATE / CALLS_PER_THREAD); // ~1s
const SAFETY_FACTOR = 1.3;
const SECS_PER_QUEUED_USER = 60;

const THREAD_BATCH = 20;           // threads per sync call
const DEDUP_THRESHOLD = 0.97;      // cosine similarity for near-duplicate skip
const MAX_CONSECUTIVE_SKIPS = 3;   // guardrail: never skip more than 3 in a row

// ─────────────────────────────────────────────
// Supabase Edge Runtime fire-and-forget helper
// ─────────────────────────────────────────────
function fireAndForget(promise: Promise<any>) {
  try {
    // @ts-ignore: EdgeRuntime is Supabase-specific
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(promise);
    }
  } catch {
    promise.catch((err: any) => console.error("[BG Task Error]", err));
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
  const labels: string[] = syncFlags?.gmail_labels || ["IMPORTANT", "INBOX"];
  if (labels.includes("IMPORTANT")) sources.push("is:important");
  if (labels.includes("INBOX"))     sources.push("in:inbox");
  if (labels.includes("SENT"))      sources.push("in:sent");
  for (const id of (syncFlags?.custom_label_ids || [])) {
    sources.push(`label:${id}`);
  }
  if (sources.length > 0) parts.push(`(${sources.join(" OR ")})`);

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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let user: any = null;
    let reqBody: any = {};
    try { reqBody = await req.json(); } catch { }
    let tokenStr = authHeader.replace(/^Bearer\s+/i, "").trim();

    // Service-role call from background_worker
    if (tokenStr === (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim() && reqBody.user_id) {
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
        updated_at: new Date().toISOString(),
      }, { onConflict: "dedup_id" });

      // Mark onboarding as queued in user_settings
      await supabaseAdmin.from("user_settings").update({ onboarding_status: "queued" }).eq("user_id", user.id);

      // Compute queue position for estimate
      const { data: queuePos } = await supabaseAdmin.rpc("get_onboarding_queue_position", { p_user_id: user.id });

      return new Response(JSON.stringify({
        success: true,
        message: "Onboarding queued",
        queue_position: queuePos ?? 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    asyncLog(supabaseAdmin, user.id, "GRAPHRAG_SYNC_START", {});

    const isOnboarding = !settings.last_synced_at;
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
        .eq("id", settings.id).select("id");
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

    // Pass 1: Full query (category filter + source + keywords + time)
    let tokenRefreshedOnList = false;
    const fetchThreadList = async (query: string): Promise<any[]> => {
      let res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=${THREAD_BATCH}&q=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Bearer ${gmailToken}` } }
      );
      if (res.status === 401 && !tokenRefreshedOnList && settings.gmail_token?.refresh_token) {
        const fresh = await refreshGmailToken(user.id, settings.gmail_token.refresh_token, supabaseAdmin);
        if (fresh) { gmailToken = fresh; tokenRefreshedOnList = true; }
        res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=${THREAD_BATCH}&q=${encodeURIComponent(query)}`,
          { headers: { Authorization: `Bearer ${gmailToken}` } }
        );
      }
      if (!res.ok) return [];
      const d = await res.json();
      return d.threads || [];
    };

    let threads = await fetchThreadList(fullQuery);
    asyncLog(supabaseAdmin, user.id, "THREAD_FETCH_P1", { count: threads.length, query: fullQuery });

    // Pass 2: Relax keyword terms (keep source + category filter + time)
    if (threads.length < 5) {
      passUsed = 2;
      const relaxedQuery = buildGmailQuery({ ...syncFlags, tracking_preferences: [] }, settings.last_synced_at);
      threads = await fetchThreadList(relaxedQuery);
      asyncLog(supabaseAdmin, user.id, "THREAD_FETCH_P2", { count: threads.length });
    }

    // Pass 3: Bare — no query filter, just time window
    if (threads.length < 5) {
      passUsed = 3;
      const days = syncFlags?.lookback_days || 30;
      const after = Math.floor((Date.now() - days * 24 * 3600 * 1000) / 1000);
      threads = await fetchThreadList(`after:${after}`);
      asyncLog(supabaseAdmin, user.id, "THREAD_FETCH_P3", { count: threads.length });
    }

    // Fallback to messages if still empty
    if (threads.length === 0) {
      passUsed = 4;
      const days = syncFlags?.lookback_days || 30;
      const after = Math.floor((Date.now() - days * 24 * 3600 * 1000) / 1000);
      let msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${THREAD_BATCH}&q=after:${after}`,
        { headers: { Authorization: `Bearer ${gmailToken}` } }
      );
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        const msgs = msgData.messages || [];
        // Treat each message as its own "thread"
        threads = msgs.map((m: any) => ({ id: m.threadId || m.id }));
      }
      asyncLog(supabaseAdmin, user.id, "THREAD_FETCH_P4_FALLBACK", { count: threads.length });
    }

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
      for (let i = 0; i < threadIds.length; i++) {
        const threadId = threadIds[i];
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
          if (!threadRes.ok) continue;

          const threadData = await threadRes.json();
          const messages: any[] = threadData.messages || [];
          if (messages.length === 0) continue;

          // Check if user replied (SENT label on any message in thread)
          const userReplied = messages.some((m: any) => (m.labelIds || []).includes("SENT"));

          // Use the most recent non-sent message as representative
          const firstMsg = messages.find((m: any) => !(m.labelIds || []).includes("SENT")) || messages[0];
          const headers = (firstMsg.payload?.headers || []).reduce((acc: any, h: any) => ({ ...acc, [h.name]: h.value }), {});
          const subject = headers["Subject"] || "(no subject)";
          const sender = headers["From"] || "unknown";
          const dateStr = headers["Date"] || "";
          const isImportant = (firstMsg.labelIds || []).includes("IMPORTANT");

          // Concatenate all messages in thread (for richer context), clean each
          const combinedBody = messages
            .map((m: any) => cleanEmailBody(decodeBody(m.payload) || ""))
            .filter(b => b.length > 0)
            .join("\n\n---\n\n")
            .substring(0, 3000); // cap at 3000 chars

          // ── LAYER 1: Spam/Ad heuristic (free) ──
          if (isSpamOrAd(subject, sender, combinedBody)) {
            threadsSkippedSpam++;
            asyncLog(supabaseAdmin, user.id, "THREAD_SKIP_SPAM", { thread_id: threadId, subject });
            continue;
          }

          // ── LAYER 2: Trivial content guard (free) ──
          if (!isWorthProcessing(combinedBody)) {
            threadsSkippedTrivial++;
            asyncLog(supabaseAdmin, user.id, "THREAD_SKIP_TRIVIAL", { thread_id: threadId, subject });
            continue;
          }

          // ── LAYER 3: Semantic dedup check ──
          // GUARDRAILS: never skip if important, or if we'd skip 3+ in a row
          let shouldSkipDedup = false;
          if (!isImportant && consecutiveSkips < MAX_CONSECUTIVE_SKIPS) {
            try {
              const dedupPayload = `${subject} ${combinedBody.substring(0, 300)}`;
              const embedRes = await supabaseAdmin.functions.invoke("embed", {
                body: { text: dedupPayload }
              });
              if (embedRes.data?.embedding) {
                const { data: similar } = await supabaseAdmin.rpc("match_emails", {
                  query_embedding: embedRes.data.embedding,
                  match_threshold: DEDUP_THRESHOLD,
                  match_count: 1
                });
                if (similar && similar.length > 0) {
                  // Only skip if same sender too
                  const existingEmail = await supabaseAdmin.from("emails")
                    .select("id, sender_id").eq("id", similar[0].id).single();
                  const senderMatch = existingEmail?.data?.sender_id; // rough check
                  if (senderMatch) {
                    shouldSkipDedup = true;
                  }
                }
              }
            } catch (e: any) {
              // Dedup errors are non-fatal — proceed to ingestion
              console.warn("[DEDUP] Error during dedup check:", e.message);
            }
          }

          if (shouldSkipDedup) {
            threadsSkippedDedup++;
            consecutiveSkips++;
            asyncLog(supabaseAdmin, user.id, "THREAD_SKIP_DEDUP", { thread_id: threadId, subject });
            continue;
          }
          consecutiveSkips = 0; // reset on successful pass-through

          // ── INGEST TO GRAPH ──
          await graphStore.ingestEmailToGraph({
            message_id: firstMsg.id,
            subject,
            body: combinedBody,
            sender,
            thread_id: threadId,
            received_at: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
          }, user.id);

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
      }

      // ── Post-batch: build communities + finalise ──
      try {
        await graphStore.buildCommunities();
      } catch (e: any) {
        console.error("[GraphRAG] buildCommunities failed:", e.message);
      }

      const finalUpdate: any = {
        last_synced_at: new Date().toISOString(),
        sync_in_progress: false,
        sync_lock_at: null,
        last_sync_error: null,
      };
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

    // Fire the pipeline — non-blocking so we can return immediately
    fireAndForget(graphPipeline());

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
