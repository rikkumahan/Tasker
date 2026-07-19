const supabaseUrl = 'https://esngoeuhtpdzyfttofyu.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzbmdvZXVodHBkenlmdHRvZnl1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzE2MjM0NCwiZXhwIjoyMDg4NzM4MzQ0fQ.ZudlVLCZZ7TLka86DAZvcIHEzCqWwX1NGvBUTzoFITw';

async function test() {
  const res = await fetch(`${supabaseUrl}/functions/v1/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`
    },
    body: JSON.stringify({ user_id: 'bc5aadc4-f2c7-4e0d-8448-3c805071ab7f' })
  });
  
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Response:", text);
}

test();
