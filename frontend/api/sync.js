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

    try {
        const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/dispatches`, {
            method: 'POST',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                event_type: 'manual-refresh'
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('GitHub API Error:', errorData);
            return res.status(response.status).json({ error: 'Failed to trigger GitHub Action' });
        }

        return res.status(200).json({ success: true, message: 'GitHub Action triggered successfully' });
    } catch (error) {
        console.error('Server Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
