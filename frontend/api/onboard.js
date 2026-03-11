import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { providerToken, providerRefreshToken } = req.body;
  if (!providerToken) {
    return res.status(400).json({ error: 'Missing provider token' });
  }

  // Also get the auth token from headers to identify the user
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing auth header' });
  
  const token = authHeader.replace('Bearer ', '');
  
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  
  // Create a Supabase client acting on behalf of the logged-in user
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid user token' });
  }

  try {
    // 1. Check if user already has a settings profile
    const { data: existingSettings } = await supabase
      .from('user_settings')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (existingSettings) {
      // If they already have settings, just update their gmail_token silently
      // In case they just logged back in and their token refreshed
      await supabase.from('user_settings').update({
        gmail_token: {
           access_token: providerToken,
           refresh_token: providerRefreshToken || null
        }
      }).eq('user_id', user.id);
      
      return res.status(200).json({ success: true, message: 'Updated existing token' });
    }

    // 2. NEW USER FULL SETUP: Fetch Emails
    console.log(`[INFO] Fetching emails for new user ${user.id}...`);
    const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50', {
       headers: { Authorization: `Bearer ${providerToken}` }
    });
    
    if (!gmailRes.ok) {
        throw new Error("Failed to fetch from Gmail API");
    }
    const gmailData = await gmailRes.json();
    
    let emailText = "";
    if (gmailData.messages) {
       for (const msg of gmailData.messages) {
          try {
              const fullMsgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
                 headers: { Authorization: `Bearer ${providerToken}` }
              });
              const fullMsg = await fullMsgRes.json();
              
              const headers = fullMsg.payload?.headers || [];
              const subjectHeader = headers.find(h => h.name === 'Subject');
              const fromHeader = headers.find(h => h.name === 'From');
              
              const subject = subjectHeader ? subjectHeader.value : '(no subject)';
              const sender = fromHeader ? fromHeader.value : 'unknown';
              
              let body = "";
              const extractBody = (part) => {
                  if (part.mimeType === 'text/plain' && part.body?.data) {
                      body += Buffer.from(part.body.data, 'base64').toString('utf8');
                  } else if (part.parts) {
                      part.parts.forEach(extractBody);
                  }
              };
              if (fullMsg.payload) extractBody(fullMsg.payload);
              
              const preview = body.substring(0, 300).replace(/\n/g, " ").trim();
              emailText += `From: ${sender}\nSubject: ${subject}\nBody: ${preview}...\n---\n`;
          } catch (e) {
             console.error("Failed to fetch individual message", e);
          }
       }
    }

    // 3. Call Sarvam AI for Profile Generation (with fallback)
    const sarvamKey = process.env.SARVAM_API_KEY;
    let user_profile = "A student managing academic and personal tasks.";
    let categories = ["academic_deadline", "admin_notice", "opportunity", "campus_event", "security_warning"];

    if (sarvamKey && emailText) {
        console.log("[INFO] Sending inbox payload to Sarvam AI...");
        const prompt = `
You are an AI assistant helping a student organize their tasks.
Look at the following sample of recent emails from their inbox.

Emails:
${emailText}

Based on this content, perform two tasks:
1. Write a 3 to 4 sentence \`user_profile\` summarizing who this user is, what their current life state is (e.g., student, job seeker), and what types of deadlines/events they care about.
2. Define EXACTLY 5 broad categories that these emails can be grouped into for a task manager dashboard.
Categories should be single snake_case strings (e.g., academic_deadline, club_event).

Return ONLY a JSON object with exactly these two keys:
{
  "user_profile": "detailed personality description here...",
  "categories": ["category_1", "category_2", "category_3", "category_4", "category_5"]
}`;
        
        const llmRes = await fetch("https://api.sarvam.ai/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${sarvamKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "sarvam-105b",
                messages: [{ role: "user", content: prompt }]
            })
        });
        
        if (llmRes.ok) {
            const llmData = await llmRes.json();
            try {
                const reply = llmData.choices[0].message.content;
                const cleaned = reply.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(cleaned);
                if (parsed.user_profile && parsed.categories) {
                    user_profile = parsed.user_profile;
                    categories = parsed.categories;
                }
            } catch (e) {
                console.error("Failed to parse Sarvam JSON response", e);
            }
        } else {
            console.error("Sarvam AI Error", await llmRes.text());
        }
    }

    // 4. Save entire payload to Supabase
    // This completes the zero-terminal onboarding process
    const { error: insertError } = await supabase.from('user_settings').insert([{
        user_id: user.id,
        user_profile,
        categories,
        gmail_token: {
           access_token: providerToken,
           refresh_token: providerRefreshToken || null
        }
    }]);

    if (insertError) {
        throw insertError;
    }

    return res.status(200).json({ success: true, message: 'Onboarding completed!' });

  } catch (error) {
    console.error("Onboarding server error:", error);
    return res.status(500).json({ error: error.message });
  }
}
