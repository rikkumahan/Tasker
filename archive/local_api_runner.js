const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from BOTH root .env and frontend .env
dotenv.config();
dotenv.config({ path: path.join(__dirname, 'frontend', '.env'), override: true });

// PRO: Explicitly map and LOG for debugging
console.log('[DEBUG] Initializing Environment Alignment...');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// Ensure they are NOT empty strings
if (process.env.SUPABASE_URL === '') delete process.env.SUPABASE_URL;
if (process.env.SUPABASE_ANON_KEY === '') delete process.env.SUPABASE_ANON_KEY;
process.env.SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

console.log('[DEBUG] Supabase URL:', process.env.SUPABASE_URL ? 'FOUND' : 'MISSING');
console.log('[DEBUG] Supabase Key:', process.env.SUPABASE_ANON_KEY ? 'FOUND (starts with ' + process.env.SUPABASE_ANON_KEY.substring(0, 5) + '...)' : 'MISSING');

const app = express();
const PORT = 3001;

app.use(express.json());

// Helper to mimic Vercel's req/res for the locally imported handlers
const wrapHandler = (handlerPath) => async (req, res) => {
    try {
        console.log(`[API] ${req.method} ${req.url}`);
        const absolutePath = path.resolve(__dirname, 'frontend', 'api', handlerPath);
        
        // Clear cache for hot reloading
        delete require.cache[require.resolve(absolutePath)];
        const module = await import('file://' + absolutePath);
        const handler = module.default;
        
        await handler(req, res);
    } catch (err) {
        console.error(`[ERROR] API ${handlerPath}:`, err);
        res.status(500).json({ error: err.message });
    }
};

const { spawn } = require('child_process');

// Route mapping (mimics Vercel directory routing)
app.post('/api/onboard', wrapHandler('onboard.js'));

// PRO: Override /api/sync to run the local python sync engine instead of GitHub Action
app.post('/api/sync', async (req, res) => {
    console.log('[LOCAL SYNC] Starting local Python sync engine...');
    const python = spawn('python', ['execution/auto_sync.py'], {
        cwd: __dirname,
        env: { ...process.env, ...dotenv.config({ path: path.join(__dirname, 'frontend', '.env') }).parsed }
    });

    python.stdout.on('data', (data) => console.log(`[SYNC STDOUT] ${data.toString().trim()}`));
    python.stderr.on('data', (data) => console.error(`[SYNC STDERR] ${data.toString().trim()}`));

    python.on('close', (code) => {
        console.log(`[LOCAL SYNC] Process exited with code ${code}`);
    });

    res.status(200).json({ success: true, message: 'Local sync triggered' });
});

// Mock sync-status to return 'completed' immediately or track with a global var
app.get('/api/sync-status', (req, res) => {
    res.status(200).json({ status: 'completed', started_at: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`\x1b[32m[SUCCESS]\x1b[0m Local API Server running at http://localhost:${PORT}`);
    console.log(`[INFO] Proxying requests from Vite (port 5173) to this server.`);
});
