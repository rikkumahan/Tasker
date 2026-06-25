import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders() });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");
    
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const uid = user.id;

    // Delete all user data to reset the account, but KEEP the auth.users account.
    // The order matters slightly for foreign keys if they don't have CASCADE, but we'll try to delete in order of leaves to roots.
    
    // Use the optimized database function to wipe all data in one transaction
    const { error: wipeError } = await supabase.rpc('wipe_user_data');
    if (wipeError) {
      throw new Error(`Failed to wipe user data: ${wipeError.message}`);
    }

    // Finally, completely delete the user identity from auth.users
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (deleteError) {
      throw new Error(`Failed to delete auth user: ${deleteError.message}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...getCorsHeaders(), "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...getCorsHeaders(), "Content-Type": "application/json" } }
    );
  }
});
