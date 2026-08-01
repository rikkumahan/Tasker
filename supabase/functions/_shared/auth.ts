import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad) base64 += "=".repeat(4 - pad);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(base64Url: string): string {
  const bytes = base64UrlToUint8Array(base64Url);
  return new TextDecoder().decode(bytes);
}

let hmacKeyPromise: Promise<CryptoKey> | null = null;
function getHmacKey(secret: string): Promise<CryptoKey> {
  if (!hmacKeyPromise) {
    hmacKeyPromise = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
  }
  return hmacKeyPromise;
}

// Project is on Supabase's newer JWT signing keys (ES256/ECC P-256 is the CURRENT
// signing key; HS256 is only the PREVIOUS key, kept solely to verify not-yet-expired
// tokens issued before rotation — confirmed live via Project Settings > JWT Keys and
// the public JWKS endpoint). Real current traffic is ES256, not HS256 — a first version
// of this file only checked HS256 and silently no-op'd for every real user token.
const JWKS_URL = `${(Deno.env.get("SUPABASE_URL") ?? "").trim()}/auth/v1/.well-known/jwks.json`;
const JWKS_TTL_MS = 10 * 60 * 1000; // 10 min — keys rotate rarely, short TTL just bounds staleness after a rotation

let jwksCache: { keys: JsonWebKey[] } | null = null;
let jwksCacheAt = 0;
async function getJwks(): Promise<{ keys: JsonWebKey[] }> {
  if (!jwksCache || Date.now() - jwksCacheAt > JWKS_TTL_MS) {
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    jwksCache = await res.json();
    jwksCacheAt = Date.now();
  }
  return jwksCache!;
}

const es256KeyCache = new Map<string, Promise<CryptoKey>>();
async function getEs256Key(kid: string): Promise<CryptoKey | null> {
  let keyPromise = es256KeyCache.get(kid);
  if (!keyPromise) {
    const jwks = await getJwks();
    const jwk = jwks.keys.find((k: any) => k.kid === kid && k.kty === "EC");
    if (!jwk) return null;
    keyPromise = crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    es256KeyCache.set(kid, keyPromise);
  }
  return keyPromise;
}

/**
 * Verifies a Supabase JWT's signature (ES256 via the project's JWKS endpoint — the
 * current signing scheme — with HS256/SUPABASE_JWT_SECRET supported as a fallback for
 * any not-yet-expired tokens issued under the previous legacy key). Returns the decoded
 * payload only if the signature is valid and the token isn't expired. This is the sole
 * independent check standing behind the gateway's verify_jwt setting — see
 * SUPABASE_LOGIC_BUGS_FINDINGS.md #6/#9.
 */
async function verifyJwtSignature(tokenStr: string): Promise<Record<string, any> | null> {
  const parts = tokenStr.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: Record<string, any>;
  let payload: Record<string, any>;
  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64));
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    return null;
  }

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8Array(signatureB64);
  let valid = false;

  if (header.alg === "ES256" && header.kid) {
    const key = await getEs256Key(header.kid);
    if (!key) return null;
    valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, data);
  } else if (header.alg === "HS256") {
    const secret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (!secret) return null;
    const key = await getHmacKey(secret);
    valid = await crypto.subtle.verify("HMAC", key, signature, data);
  } else {
    return null; // reject alg-confusion attempts (e.g. "none") and anything unrecognized
  }

  if (!valid) return null;
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;

  return payload;
}

/**
 * Extracts and independently verifies the JWT from the Authorization header
 * (signature + expiry), falling back to the Supabase auth API only if that
 * fails (e.g. an opaque/non-JWT access token).
 */
export async function authenticateUser(req: Request, supabaseAdmin: SupabaseClient): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const tokenStr = authHeader.replace(/^Bearer\s+/i, "").trim();

  let payload: Record<string, any> | null = null;
  try {
    payload = await verifyJwtSignature(tokenStr);
  } catch (e) {
    console.error("[Auth] JWT verification error (falling back to auth.getUser):", (e as Error).message);
  }
  if (payload?.sub) {
    return { id: payload.sub, email: payload.email || "" };
  }

  // Fallback to Supabase API (handles non-JWT/opaque tokens)
  const { data: authData } = await supabaseAdmin.auth.getUser(tokenStr);
  if (authData?.user) {
    return { id: authData.user.id, email: authData.user.email || "" };
  }

  return null;
}
