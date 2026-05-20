const fs = require('fs');

async function testSync() {
  const envContent = fs.readFileSync('.env', 'utf-8');
  let serviceKey = '';
  let url = '';
  envContent.split('\n').forEach(l => {
    if (l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) serviceKey = l.split('=')[1].trim();
    if (l.startsWith('SUPABASE_URL=')) url = l.split('=')[1].trim();
  });

  const TEST_USER_ID = "c5fc30a2-4545-4155-a97f-76d76fc8067f";

  console.log('--- STARTING PROPER DEBUG OPERATION ---');
  console.log('Target Edge Function:', `${url}/functions/v1/sync`);
  console.log('Mocking Auth Token:', 'SUPABASE_SERVICE_ROLE_KEY');

  const startTime = Date.now();
  
  try {
    const res = await fetch(`${url}/functions/v1/sync`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ user_id: TEST_USER_ID })
    });

    const body = await res.text();
    console.log(`\nHTTP STATUS: ${res.status}`);
    console.log(`EXECUTION TIME: ${Date.now() - startTime}ms`);
    console.log(`RESPONSE BODY: ${body}\n`);

    console.log('--- AUDITING DATABASE DEBUG LOGS ---');
    // Database logs validation is performed automatically by mcp
  } catch (err) {
    console.error("HTTP Execution Error:", err);
  }
}

testSync();
