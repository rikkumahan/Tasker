import { authenticateUser } from "../_shared/auth.ts";

// Finding #6 (SUPABASE_LOGIC_BUGS_FINDINGS.md): authenticateUser used to trust
// payload.sub from ANY three-part base64 token without checking the signature.
//
// This project's CURRENT signing key is ES256 (confirmed live via Project Settings >
// JWT Keys and the public JWKS endpoint) — HS256 is only the previous/legacy key. A
// first version of this fix only implemented HS256 and silently no-op'd for every real
// (ES256) user token. The ES256 test below needs a live JWKS lookup (SUPABASE_URL),
// so it isn't a pure offline unit test like the others — matches the existing
// live-network convention used by test-graph-queries.ts elsewhere in this suite.

function base64UrlEncode(obj: any): string {
  const json = JSON.stringify(obj);
  const b64 = btoa(json);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.test("authenticateUser rejects a forged token with a made-up signature", async () => {
  const header = base64UrlEncode({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlEncode({ sub: "11111111-1111-1111-1111-111111111111", email: "attacker@example.com", exp: Math.floor(Date.now() / 1000) + 3600 });
  const forgedToken = `${header}.${payload}.not-a-real-signature`;

  const req = new Request("https://example.com", {
    headers: { Authorization: `Bearer ${forgedToken}` },
  });

  // No real Supabase env in this pure unit test — the fallback (auth.getUser) will
  // also fail for a forged token, so a null supabaseAdmin stub is fine here: we're
  // proving the FAST PATH no longer accepts an unverified payload.
  const stubAdmin = { auth: { getUser: async () => ({ data: { user: null } }) } } as any;

  if (!Deno.env.get("SUPABASE_JWT_SECRET")) {
    console.log("⚠️ SUPABASE_JWT_SECRET not set locally — skipping (still verified live via deployed function).");
    return;
  }

  const user = await authenticateUser(req, stubAdmin);
  if (user !== null) {
    throw new Error(`Forged token was accepted as user ${JSON.stringify(user)} — signature verification is not working.`);
  }
});

Deno.test("authenticateUser rejects an ES256 token signed by an untrusted key (wrong kid)", async () => {
  // Attacker generates their own EC P-256 keypair and signs a well-formed ES256 token.
  // Its kid won't match anything in the project's real JWKS, so the lookup must fail
  // closed regardless of the signature being cryptographically valid under the
  // attacker's own key.
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const header = base64UrlEncode({ alg: "ES256", typ: "JWT", kid: "attacker-controlled-kid" });
  const payload = base64UrlEncode({ sub: "11111111-1111-1111-1111-111111111111", exp: Math.floor(Date.now() / 1000) + 3600 });
  const signingInput = new TextEncoder().encode(`${header}.${payload}`);
  const sigBuf = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, signingInput);
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const forgedToken = `${header}.${payload}.${sig}`;

  const req = new Request("https://example.com", { headers: { Authorization: `Bearer ${forgedToken}` } });
  const stubAdmin = { auth: { getUser: async () => ({ data: { user: null } }) } } as any;

  if (!Deno.env.get("SUPABASE_URL")) {
    console.log("⚠️ SUPABASE_URL not set locally — skipping (needs the live JWKS endpoint).");
    return;
  }

  const user = await authenticateUser(req, stubAdmin);
  if (user !== null) {
    throw new Error(`ES256 token with an untrusted kid was accepted as user ${JSON.stringify(user)}.`);
  }
});

Deno.test("authenticateUser rejects alg:none confusion attempts", async () => {
  const header = base64UrlEncode({ alg: "none", typ: "JWT" });
  const payload = base64UrlEncode({ sub: "11111111-1111-1111-1111-111111111111" });
  const noneToken = `${header}.${payload}.`;

  const req = new Request("https://example.com", {
    headers: { Authorization: `Bearer ${noneToken}` },
  });
  const stubAdmin = { auth: { getUser: async () => ({ data: { user: null } }) } } as any;

  if (!Deno.env.get("SUPABASE_JWT_SECRET")) {
    console.log("⚠️ SUPABASE_JWT_SECRET not set locally — skipping.");
    return;
  }

  const user = await authenticateUser(req, stubAdmin);
  if (user !== null) {
    throw new Error(`alg:none token was accepted as user ${JSON.stringify(user)}.`);
  }
});
