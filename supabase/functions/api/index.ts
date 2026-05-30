import { Hono } from 'https://deno.land/x/hono@v4.3.11/mod.ts';
import { cors } from 'https://deno.land/x/hono@v4.3.11/middleware.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateUser } from "../_shared/auth.ts";
import { decodeBody } from "../_shared/utils.ts";

// Base path mirrors Supabase's function slug: invoke('api/feed') → /api/feed
const app = new Hono().basePath('/api');

// --- Constants ---
const FILTERS = {
  ALL: 'all',
  UNREAD: 'unread',
  ACTION: 'action',
  IMPORTANT: 'important'
} as const;

const ACTION_TYPES = ['reply', 'approve', 'review', 'join'];
const URGENCY_LEVELS = ['URGENT', 'HIGH'];

// Global Error Handler
app.onError((err, c) => {
  console.error(`[API Error] ${err.message}`, err);
  return c.json({ error: "Internal Server Error", details: err.message }, 500);
});

// Global CORS Middleware
app.use('*', cors({
  origin: '*',
  allowHeaders: ['authorization', 'x-client-info', 'apikey', 'content-type'],
  allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE'],
}));

// Global Auth & Supabase Middleware
app.use('*', async (c, next) => {
  const req = c.req.raw;
  if (req.method === 'OPTIONS') return next();

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("MY_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
  );

  const user = await authenticateUser(req, supabaseAdmin);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  c.set('user', user);
  c.set('supabaseAdmin', supabaseAdmin);

  await next();
});

// ── Handler: feed ──
// Registered at both /feed and /api/feed because supabase.functions.invoke('api/feed')
// hits the path /api/feed inside Hono (Supabase passes full slug path).
async function handleFeed(c: any) {
  const user = c.get('user');
  const supabase = c.get('supabaseAdmin');

  let body;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const filter = body.filter || FILTERS.ALL;
  const limit = Math.min(body.limit || 20, 50);
  const offset = body.offset || 0;

  let query = supabase
    .from('threads')
    .select('id, gmail_thread_id, subject, urgency, action_type, ai_summary, action_items, suggested_reply, is_read, created_at, emails(sender_id, snippet, contacts(name, email))')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filter === FILTERS.UNREAD) query = query.eq('is_read', false);
  if (filter === FILTERS.ACTION) query = query.in('action_type', ACTION_TYPES);
  if (filter === FILTERS.IMPORTANT) query = query.in('urgency', URGENCY_LEVELS);

  const { data: threads, error } = await query;
  if (error) throw new Error(`Supabase query failed: ${error.message}`);

  const formattedThreads = (threads || []).map((t: any) => {
    const firstEmail = (t.emails && t.emails.length > 0) ? t.emails[0] : null;
    const contact = firstEmail?.contacts ?? null;
    const gmailUrl = `https://mail.google.com/mail/u/0/#all/${t.gmail_thread_id}`;

    return {
      id: t.id,
      gmail_thread_id: t.gmail_thread_id,
      gmail_url: gmailUrl,
      subject: t.subject,
      urgency: t.urgency,
      action_type: t.action_type,
      ai_summary: t.ai_summary,
      action_items: t.action_items || [],
      suggested_reply: t.suggested_reply || null,
      is_read: t.is_read,
      created_at: t.created_at,
      sender_name: contact?.name || 'Unknown',
      sender_email: contact?.email || 'Unknown'
    };
  });

  return c.json({ threads: formattedThreads, nextOffset: offset + limit });
}
app.post('/feed', handleFeed);

// ── Handler: thread-detail ──
async function handleThreadDetail(c: any) {
  const user = c.get('user');
  const supabase = c.get('supabaseAdmin');

  const body = await c.req.json();
  const { thread_id } = body;

  if (!thread_id) return c.json({ error: "thread_id is required" }, 400);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(thread_id)) return c.json({ error: "invalid thread_id" }, 400);

  const { data: thread, error: threadErr } = await supabase
    .from('threads')
    .select('*')
    .eq('id', thread_id)
    .eq('user_id', user.id)
    .single();
  if (threadErr) throw new Error(`Failed to fetch thread: ${threadErr.message}`);

  const { data: emails } = await supabase
    .from('emails')
    .select('id, body, snippet, received_at, contacts(name, email)')
    .eq('thread_id', thread_id)
    .order('received_at', { ascending: true });

  const formattedEmails = (emails || []).map((e: any) => ({
    id: e.id,
    body: e.body || e.snippet || null,
    received_at: e.received_at,
    sender_name: e.contacts?.name || null,
    sender_email: e.contacts?.email || null,
  }));

  const { data: edges } = await supabase
    .from('graph_edges')
    .select('*')
    .eq('user_id', user.id)
    .or(`source_id.eq.${thread_id},target_id.eq.${thread_id}`);

  const gmailUrl = `https://mail.google.com/mail/u/0/#all/${thread.gmail_thread_id}`;

  return c.json({
    thread: { ...thread, gmail_url: gmailUrl },
    emails: formattedEmails,
    context: { edges: edges || [] }
  });
}
app.post('/thread-detail', handleThreadDetail);

// ── Handler: raw-email (Zero-Retention Live Fetch) ──
async function handleRawEmail(c: any) {
  const user = c.get('user');
  const supabase = c.get('supabaseAdmin');

  let reqBody;
  try {
    reqBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const { message_id } = reqBody;

  if (!message_id) return c.json({ error: "message_id is required" }, 400);

  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('secrets')
    .eq('user_id', user.id)
    .single();

  const providerToken = userSettings?.secrets?.provider_token;
  if (!providerToken) {
    return c.json({ error: "Google OAuth token missing. Please sign in again." }, 401);
  }

  try {
    const gmailRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}?format=full`,
      { headers: { Authorization: `Bearer ${providerToken}` } }
    );

    if (!gmailRes.ok) throw new Error(`Gmail API returned ${gmailRes.status}`);

    const payload = await gmailRes.json();
    const rawBody = decodeBody(payload.payload) || payload.snippet || "No body content found.";

    return c.json({ body: rawBody });
  } catch (e: any) {
    console.error("Live Fetch Proxy Error:", e);
    return c.json({ error: "Failed to fetch raw email from Gmail." }, 500);
  }
}
app.post('/raw-email', handleRawEmail);

// ── Handler: reply ──
async function handleReply(c: any) {
  return c.json({ success: true, message: "Stubbed for now" });
}
app.post('/reply', handleReply);


Deno.serve(app.fetch);
