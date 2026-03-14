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
    // 1. Check if user already exists
    const { data: existingSettings } = await supabase
      .from('user_settings')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (existingSettings) {
      await supabase.from('user_settings').update({
        gmail_token: {
           token: providerToken,
           refresh_token: providerRefreshToken || null
        }
      }).eq('user_id', user.id);
      return res.status(200).json({ success: true, message: 'Updated existing token' });
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
        const now = new Date().toISOString().split('.')[0]; // IST-ish for prompt

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
- Deadline past ${now}? Skip it.
- No markdown. No text. Just JSON.`;

        const llmRes = await fetch("https://api.sarvam.ai/v1/chat/completions", {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${sarvamKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: "sarvam-105b", messages: [{ role: "user", content: prompt }] })
        });

        if (llmRes.ok) {
            const data = await llmRes.json();
            const reply = data.choices[0].message.content || "";
            
            // PRO: Use regex to extract JSON block (safest for AI responses)
            const jsonMatch = reply.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0].trim());
                    if (parsed.user_profile) user_profile = parsed.user_profile;
                    if (parsed.categories) categories = parsed.categories;
                    if (parsed.initial_tasks) initial_tasks = parsed.initial_tasks;
                } catch (e) {
                    console.error("JSON Parse fail", e, reply);
                }
            }
        }
    } else if (emails.length === 0) {
        console.log("[INFO] Empty inbox. Using blank-slate defaults.");
        user_profile = "A new user with an empty inbox, ready to start organizing.";
    }

    // 4. Atomic Save
    const { error: settingsError } = await supabase.from('user_settings').insert([{
        user_id: user.id,
        user_profile,
        categories,
        gmail_token: { token: providerToken, refresh_token: providerRefreshToken || null }
    }]);

    if (settingsError) throw settingsError;

    if (initial_tasks.length > 0) {
        const tasksToSave = initial_tasks.map(t => ({ ...t, user_id: user.id, status: 'pending' }));
        await supabase.from('tasks').insert(tasksToSave);
    }

    return res.status(200).json({ success: true, message: 'Fast-Track Onboarding complete!' });

  } catch (error) {
    console.error("Onboarding error:", error);
    return res.status(500).json({ error: error.message });
  }
}
