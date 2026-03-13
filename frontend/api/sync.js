import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const githubToken = process.env.GITHUB_PAT;
    const repoOwner = process.env.GITHUB_OWNER;
    const repoName = process.env.GITHUB_REPO;

    if (!githubToken || !repoOwner || !repoName) {
        return res.status(500).json({ error: 'Missing GitHub configuration on Vercel' });
    }

    // FIX: On Vercel server-side, VITE_ vars are NOT available via process.env.
    // We must use SUPABASE_URL and SUPABASE_ANON_KEY (without the VITE_ prefix).
    // Add these as plain (non-VITE_) env vars in your Vercel project settings.
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    // Write last_sync_triggered_at FIRE-AND-FORGET (non-blocking)
    // We do NOT await this — the GitHub dispatch is the critical path.
    const authHeader = req.headers.authorization;
    if (authHeader && supabaseUrl && supabaseAnonKey) {
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } }
        });
        // Fire and forget — don't await, don't block the GitHub dispatch
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (user) {
                supabase.from('user_settings')
                    .update({ last_sync_triggered_at: new Date().toISOString() })
                    .eq('user_id', user.id)
                    .then(() => {}) // silent
                    .catch(() => {}); // silent
            }
        }).catch(() => {}); // silent failure — this is non-critical
    }

    // CRITICAL PATH: Trigger the GitHub Action
    try {
        const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/dispatches`, {
            method: 'POST',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ event_type: 'manual-refresh' })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('GitHub API Error:', errorData);
            return res.status(response.status).json({ error: 'Failed to trigger GitHub Action' });
        }

        return res.status(200).json({ success: true, message: 'Sync triggered' });
    } catch (error) {
        console.error('Server Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
