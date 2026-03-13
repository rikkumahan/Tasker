// Returns the status of the most recent GitHub Actions workflow run
// Status values: 'queued' | 'in_progress' | 'completed' | 'unknown'
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const githubToken = process.env.GITHUB_PAT;
    const repoOwner = process.env.GITHUB_OWNER;
    const repoName = process.env.GITHUB_REPO;

    if (!githubToken || !repoOwner || !repoName) {
        return res.status(500).json({ error: 'Missing GitHub config' });
    }

    try {
        // Fetch the most recent workflow run (any event type, latest first)
        const response = await fetch(
            `https://api.github.com/repos/${repoOwner}/${repoName}/actions/runs?per_page=1`,
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`,
                },
            }
        );

        if (!response.ok) {
            return res.status(200).json({ status: 'unknown' });
        }

        const data = await response.json();
        const latestRun = data.workflow_runs?.[0];

        if (!latestRun) {
            return res.status(200).json({ status: 'unknown' });
        }

        return res.status(200).json({
            status: latestRun.status,          // 'queued' | 'in_progress' | 'completed'
            conclusion: latestRun.conclusion,  // 'success' | 'failure' | null
            started_at: latestRun.run_started_at,
            updated_at: latestRun.updated_at,
        });
    } catch (error) {
        console.error('sync-status error:', error);
        return res.status(200).json({ status: 'unknown' });
    }
}
