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

    // Write last_sync_triggered_at so the frontend can show a countdown lock
    const authHeader = req.headers.authorization;
    if (authHeader) {
        try {
            const supabase = createClient(
                process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
                process.env.VITE_SUPABASE_ANON_KEY,
                { global: { headers: { Authorization: authHeader } } }
            );
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                await supabase.from('user_settings')
                    .update({ last_sync_triggered_at: new Date().toISOString() })
                    .eq('user_id', user.id);
            }
        } catch (e) {
            console.warn('[WARN] Could not update last_sync_triggered_at:', e.message);
        }
    }

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
