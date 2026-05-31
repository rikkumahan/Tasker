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
    
    // Create client with service_role key to allow admin operations (like deleting users)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Get the user ID from the JWT
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    // We first delete the user from auth.users using the admin api.
    // If cascading deletes are set up correctly on the database, this is all we need.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      throw new Error(`Failed to delete user: ${deleteError.message}`);
    }

    // Optional: we could explicitly delete rows here if cascading is not set up,
    // e.g. delete from user_settings, threads, action_items, etc.
    // But typically auth.users cascade deletes everything if foreign keys are set to ON DELETE CASCADE.

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
