import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { providerToken, providerRefreshToken } = req.body;
  if (!providerToken) {
    return res.status(400).json({ error: 'Missing provider token' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing auth header' });
  
  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid user token' });
  }

  try {
    // 0. Register user early to prevent "Ghost Users" on timeout
    console.log(`[INFO] Onboarding start for ${user.id}...`);
    await supabase.from('user_settings').upsert({
        user_id: user.id,
        gmail_email: user.email,  // enables webhook_ingest to look up user by email
        gmail_token: { token: providerToken, refresh_token: providerRefreshToken || null }
    }, { onConflict: 'user_id' });

    // 1. Check if user already has a profile
    const { data: existingSettings } = await supabase
      .from('user_settings')
      .select('user_profile')
      .eq('user_id', user.id)
      .single();

    if (existingSettings?.user_profile) {
      return res.status(200).json({ success: true, message: 'Existing user' });
    }

    // 2. Cold Start: Fetch 20 emails in PARALLEL to beat Vercel's 10s timeout
    console.log(`[INFO] Cold Start: Parallel fetch for ${user.id}...`);
    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20', {
       headers: { Authorization: `Bearer ${providerToken}` }
    });
    
    if (!listRes.ok) throw new Error("Gmail API list failed");
    const listData = await listRes.json();
    
    let emails = [];
    if (listData.messages) {
       // PARALLEL FETCHING: All bodies at once
       const messagePromises = listData.messages.map(async (msg) => {
          try {
              const fullMsgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
                  headers: { Authorization: `Bearer ${providerToken}` }
              });
              const fullMsg = await fullMsgRes.json();
              
              const headers = fullMsg.payload?.headers || [];
              const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
              const sender = headers.find(h => h.name === 'From')?.value || 'unknown';
              
              let body = "";
              const extractBody = (part) => {
                  if (part.mimeType === 'text/plain' && part.body?.data) {
                      const safeB64 = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
                      body += Buffer.from(safeB64, 'base64').toString('utf8');
                  } else if (part.parts) {
                      part.parts.forEach(extractBody);
                  }
              };
              if (fullMsg.payload) extractBody(fullMsg.payload);
              
              return {
                  id: msg.id,
                  subject,
                  sender,
                  body: body.substring(0, 500).replace(/\n/g, " ").trim()
              };
          } catch (e) { return null; }
       });
       
       const results = await Promise.all(messagePromises);
       emails = results.filter(e => e !== null);
    }

    // 3. Unified LLM Call: Persona + Categories + Initial Tasks
    let user_profile = "A student seeking productivity.";
    let categories = ["academic", "admin", "opportunity", "social", "other"];
    let initial_tasks = [];

    const sarvamKey = process.env.SARVAM_API_KEY;
    if (sarvamKey && emails.length > 0) {
        const emailBlock = emails.map(e => `ID: ${e.id}\nFrom: ${e.sender}\nSub: ${e.subject}\nBody: ${e.body}...`).join("\n---\n");
        const now = new Date().toISOString().split('.')[0]; 

        const prompt = `You are an AI on-boarding a new user. Analyze these 20 emails:
${emailBlock}

TASK:
1. Write a 3-sentence user_profile based on their email themes.
2. Define exactly 5 broad categories (snake_case).
3. Extract up to 5 MOST URGENT tasks/events found.

Return ONLY this JSON:
{
  "user_profile": "...",
  "categories": ["cat1", "cat2", "cat3", "cat4", "cat5"],
  "initial_tasks": [
    {
      "source_email_id": "...",
      "title": "...",
      "course": "...",
      "deadline": "ISO8601 no Z",
      "summary": "...",
      "category": "Pick from your 5 generated categories"
    }
  ]
}

Rules:
- Deadline already passed before ${now}? SKIP it.
- No markdown. No text. Just JSON.`;

        const llmRes = await fetch("https://api.sarvam.ai/v1/chat/completions", {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${sarvamKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: "sarvam-105b", messages: [{ role: "user", content: prompt }] })
        });

        if (llmRes.ok) {
            const data = await llmRes.json();
            const reply = data.choices[0].message.content || "";
            
            // PRO: Use robust regex to extract the outermost JSON object
            const jsonMatch = reply.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0].trim());
                    if (parsed.user_profile) user_profile = parsed.user_profile;
                    if (parsed.categories) categories = parsed.categories;
                    if (parsed.initial_tasks) {
                        // Handle potential array or object cases from chatty AI
                        initial_tasks = Array.isArray(parsed.initial_tasks) ? parsed.initial_tasks : [];
                    }
                } catch (e) {
                    console.error("JSON extraction failed", e, reply);
                }
            } else {
                console.warn("[WARNING] AI reply had no JSON block", reply);
            }
        }
    } else if (emails.length === 0) {
        console.log("[INFO] Empty inbox. Using blank-slate defaults.");
        user_profile = "A new user with an empty inbox, ready to start organizing.";
    }

    // 4. Atomic Save
    const { error: settingsError } = await supabase.from('user_settings').upsert({
        user_id: user.id,
        gmail_email: user.email,  // persist canonical email for webhook routing
        user_profile,
        categories,
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
        gmail_token: { token: providerToken, refresh_token: providerRefreshToken || null }
    }, { onConflict: 'user_id' });

    if (settingsError) throw settingsError;

    // 5. Register Gmail Push Watch (auto-renews Pub/Sub subscription for this user)
    // This is what makes webhook_ingest receive real-time notifications.
    // Google Watch tokens expire after 7 days — re-running onboard refreshes them.
    try {
      const watchRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${providerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          labelIds: ['INBOX'],
          topicName: `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/topics/tasker-gmail-push`,
        }),
      });
      if (!watchRes.ok) {
        const err = await watchRes.json();
        console.warn('[WARN] Gmail watch registration failed:', err);
      } else {
        const watchData = await watchRes.json();
        console.log(`[INFO] Gmail watch registered. Expires: ${new Date(parseInt(watchData.expiration)).toISOString()}`);
      }
    } catch (e) {
      // Non-fatal: webhook path won't work but normal sync still will
      console.warn('[WARN] Gmail watch error:', e.message);
    }

    if (initial_tasks.length > 0) {
        const tasksToSave = initial_tasks.map(t => ({ ...t, user_id: user.id, status: 'pending' }));
        const { error: taskError } = await supabase.from('tasks').upsert(tasksToSave, { onConflict: 'source_email_id' });
        if (taskError) console.error("Initial task save error:", taskError);
    }

    // 6. Catchup Prime — enqueue a background job to drain remaining inbox history
    // The fast-track only scanned 20 emails. This lets the background_worker
    // silently scan the rest (100s of emails) at 180 RPM without blocking the user.
    try {
      const catchupDedupId = `${user.id}_onboard_catchup_${Date.now()}`;
      await supabase.from('sync_queue').insert({
        user_id: user.id,
        dedup_id: catchupDedupId
      });
      console.log('[INFO] Catchup Prime enqueued for background processing.');
    } catch (e) {
      // Non-fatal: onboard still succeeds even if queue insert fails
      console.warn('[WARN] Catchup prime failed:', e.message);
    }

    return res.status(200).json({ success: true, message: 'Fast-Track Onboarding complete!' });


  } catch (error) {
    console.error("Onboarding error:", error);
    return res.status(500).json({ error: error.message });
  }
}
