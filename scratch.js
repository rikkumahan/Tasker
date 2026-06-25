const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({path: './frontend/.env'});

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function checkHealth() {
  const { data: queue, error: queueErr } = await supabase.from('sync_queue').select('*');
  console.log('Queue State:', queue?.length ? queue : 'Empty');

  const { data: logs, error: logsErr } = await supabase.from('debug_logs').select('*').order('created_at', { ascending: false }).limit(10);
  console.log('Recent Logs:', logs);
}

checkHealth().catch(console.error);
