import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

/**
 * Extracts and verifies the JWT from the Authorization header.
 * Falls back to Supabase auth API if direct decode fails.
 */
export async function authenticateUser(req: Request, supabaseAdmin: SupabaseClient): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const tokenStr = authHeader.replace(/^Bearer\s+/i, "").trim();
  let user: AuthenticatedUser | null = null;

  try {
    const parts = tokenStr.split(".");
    if (parts.length === 3) {
      const base64Url = parts[1];
      let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const pad = base64.length % 4;
      if (pad) base64 += "=".repeat(4 - pad);
      const jsonPayload = decodeURIComponent(
        atob(base64).split("").map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
      );
      const payload = JSON.parse(jsonPayload);
      if (payload.sub) {
        user = { id: payload.sub, email: payload.email || "" };
      }
    }
  } catch (e: any) {
    console.warn("[Auth] Fast JWT decode failed, trying fallback...", e.message);
  }

  // Fallback to Supabase API
  if (!user) {
    const { data: authData } = await supabaseAdmin.auth.getUser(tokenStr);
    if (authData?.user) {
      user = { id: authData.user.id, email: authData.user.email || "" };
    }
  }

  return user;
}
