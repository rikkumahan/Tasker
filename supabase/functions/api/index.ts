import { Hono } from 'https://deno.land/x/hono@v4.3.11/mod.ts';
import { cors } from 'https://deno.land/x/hono@v4.3.11/middleware.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateUser } from "../_shared/auth.ts";
import { decodeBody } from "../_shared/utils.ts";

const app = new Hono();

// --- Constants (Clean Code: Avoid Magic Strings) ---
const FILTERS = {
  ALL: 'all',
  UNREAD: 'unread',
  ACTION: 'action',
  IMPORTANT: 'important'
} as const;

const ACTION_TYPES = ['reply', 'approve', 'review', 'join'];
const URGENCY_LEVELS = ['URGENT', 'HIGH'];

// Global Error Handler (Clean Code: Proper Exception Handling)
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

// ── GET /feed ──
app.post('/feed', async (c) => {
  const user = c.get('user');
  const supabase = c.get('supabaseAdmin');
  
  let body;
  try {
    body = await c.req.json();
  } catch {
    body = {}; // Fallback if no body provided, but no longer swallowing real errors
  }

  const filter = body.filter || FILTERS.ALL;
  const limit = Math.min(body.limit || 20, 50); // Cap limit for safety
  const offset = body.offset || 0; // Pagination support

  // N+1 Fix: Join emails→contacts to get sender info (emails has sender_id FK, not sender_name/email)
  let query = supabase
    .from('threads')
    .select('id, gmail_thread_id, subject, urgency, action_type, ai_summary, is_read, created_at, emails(sender_id, snippet, contacts(name, email))')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filter === FILTERS.UNREAD) query = query.eq('is_read', false);
  if (filter === FILTERS.ACTION) query = query.in('action_type', ACTION_TYPES);
  if (filter === FILTERS.IMPORTANT) query = query.in('urgency', URGENCY_LEVELS);

  const { data: threads, error } = await query;
  if (error) throw new Error(`Supabase query failed: ${error.message}`);

  // Format the payload for the frontend
  const formattedThreads = (threads || []).map(t => {
    // Extract first email's sender via the contacts join
    const firstEmail = (t.emails && t.emails.length > 0) ? t.emails[0] : null;
    const contact = firstEmail?.contacts ?? null;
    
    // Construct exact Gmail deep link for this specific user account
    const userEmail = encodeURIComponent(user.email || '');
    const gmailUrl = `https://mail.google.com/mail/u/${userEmail}/#all/${t.gmail_thread_id}`;

    return {
      id: t.id,
      gmail_thread_id: t.gmail_thread_id,
      gmail_url: gmailUrl,
      subject: t.subject,
      urgency: t.urgency,
      action_type: t.action_type,
      ai_summary: t.ai_summary,
      is_read: t.is_read,
      created_at: t.created_at,
      sender_name: contact?.name || 'Unknown',
      sender_email: contact?.email || 'Unknown'
    };
  });

  return c.json({ threads: formattedThreads, nextOffset: offset + limit });
});

// ── GET /thread-detail ──
app.post('/thread-detail', async (c) => {
  const user = c.get('user');
  const supabase = c.get('supabaseAdmin');
  
  const body = await c.req.json();
  const { thread_id } = body;

  if (!thread_id) return c.json({ error: "thread_id is required" }, 400);

  // Validate UUID format before interpolating into PostgREST filter string (prevents filter injection)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(thread_id)) return c.json({ error: "invalid thread_id" }, 400);

  const { data: thread, error: threadErr } = await supabase.from('threads').select('*').eq('id', thread_id).eq('user_id', user.id).single();
  if (threadErr) throw new Error(`Failed to fetch thread: ${threadErr.message}`);

  const { data: emails } = await supabase
    .from('emails')
    .select('id, body, snippet, received_at, contacts(name, email)')
    .eq('thread_id', thread_id)
    .order('received_at', { ascending: true });

  // Reshape to expected shape: flatten contacts join into sender_name/sender_email
  const formattedEmails = (emails || []).map((e: any) => ({
    id: e.id,
    body: e.body || e.snippet || null,
    received_at: e.received_at,
    sender_name: e.contacts?.name || null,
    sender_email: e.contacts?.email || null,
  }));

  const { data: edges } = await supabase.from('graph_edges').select('*').eq('user_id', user.id).or(`source_id.eq.${thread_id},target_id.eq.${thread_id}`);
  
  const userEmail = encodeURIComponent(user.email || '');
  const gmailUrl = `https://mail.google.com/mail/u/${userEmail}/#all/${thread.gmail_thread_id}`;

  return c.json({
    thread: {
      ...thread,
      gmail_url: gmailUrl
    },
    emails: formattedEmails,
    context: { edges: edges || [] }
  });
});

// ── POST /raw-email (Zero-Retention Live Fetch) ──
app.post('/raw-email', async (c) => {
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

  // 1. Get OAuth token securely
  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('secrets')
    .eq('user_id', user.id)
    .single();

  const providerToken = userSettings?.secrets?.provider_token;
  if (!providerToken) {
    return c.json({ error: "Google OAuth token missing. Please sign in again." }, 401);
  }

  // 2. Fetch raw email from Google
  try {
    const gmailRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}?format=full`,
      { headers: { Authorization: `Bearer ${providerToken}` } }
    );
    
    if (!gmailRes.ok) throw new Error(`Gmail API returned ${gmailRes.status}`);

    const payload = await gmailRes.json();
    
    // 3. Decode base64 body (Memory-only, no DB insertion)
    const rawBody = decodeBody(payload.payload) || payload.snippet || "No body content found.";
    
    return c.json({ body: rawBody });
  } catch (e: any) {
    console.error("Live Fetch Proxy Error:", e);
    return c.json({ error: "Failed to fetch raw email from Gmail." }, 500);
  }
});

// ── POST /reply ──
app.post('/reply', async (c) => {
  return c.json({ success: true, message: "Stubbed for now" });
});

Deno.serve(app.fetch);
