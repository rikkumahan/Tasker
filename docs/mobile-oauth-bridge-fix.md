# Mobile OAuth Redirect Bridge Documentation

This document describes the architecture, issues resolved, and complete setup for the **Mobile OAuth Redirect Bridge** in the Tasker application.

---

## 1. The Core Problem
When configuring third-party social authentication (e.g., Google Sign-In) on native mobile platforms (React Native/Expo Go):
1. **Scheme Restrictions**: Supabase GoTrue restricts social logins from redirecting directly to non-`http`/`https` schemes (like `exp://` or `taskerai://`). If attempted, it rejects the `redirect_to` parameter and redirects back to the project's default **Site URL** (your Vercel app).
2. **Wildcard & Port Constraints**: Expo Go runs on dynamic developer LAN IPs and ports (e.g., `exp://192.168.0.192:8081`), which cannot be hardcoded in GoTrue's allowed Redirect URL configurations.

---

## 2. The Bridge Architecture
To solve this, we route mobile authentication callbacks through an HTTPS Edge Function hosted on your Supabase project:

```
[Mobile App] --(1) signInWithOAuth (redirectTo = BRIDGE)--> [Supabase Auth]
                                                                  │
                                                          (2) Redirects to
                                                                  ▼
                                                           [Google Login]
                                                                  │
                                                      (3) Successful Auth
                                                                  ▼
[Mobile App] <--(5) HTTP 307 Redirect (exp://...)-- [Edge Function Bridge]
```

1. **Authorization**: The mobile app calls `signInWithOAuth` with `redirectTo` set to the Edge Function (`BRIDGE`). The target deep link (e.g. `exp://192.168.0.x:8081/--/auth-callback`) is URL-encoded and appended as the `exp` parameter:
   `https://[project].supabase.co/functions/v1/mobile-auth-bridge/redirect?exp=exp%3A%2F%2F192.168.0.x%3A8081%2F--%2Fauth-callback`
2. **Consent & Return**: The user signs in via Google. GoTrue processes the auth code, issues the session, and redirects to the `redirectTo` target (`BRIDGE`), appending the Supabase PKCE `code` query parameter.
3. **Bridge Redirection**: The Edge Function extracts the target `exp://` scheme, deletes it from the query parameters, and performs an **HTTP 307 Temporary Redirect** back to the deep link, carrying forward all remaining params (like the PKCE `code`).
4. **App Deep Linking**: The OS opens the app via the deep link, which is captured by `useURL()` on `/auth-callback` (or intercepted by `openAuthSessionAsync` on iOS) and exchanged for the user session.

---

## 3. Critical Fixes Implemented

### Fix A: Glob Wildcard Matching Path Constraint
* **The Bug**: The wildcard pattern added to the dashboard allowed list (`.../mobile-auth-bridge/**`) requires at least one character after the slash to match. A URL like `.../mobile-auth-bridge?exp=...` has a `?` instead of a `/` after `mobile-auth-bridge`, failing the glob check.
* **The Fix**: Appended a dummy path segment `/redirect` to the `BRIDGE` URL in the client app:
  `.../mobile-auth-bridge/redirect?exp=...`
  This satisfies the `/**` pattern matching since `redirect` is a valid path string after the slash.

### Fix B: Mobile Token Exchange Redirect URI Mismatch
* **The Bug**: During `exchangeCodeForSession(url)`, the SDK parses the incoming deep link URL and sends the raw `exp://` path as the token exchange's `redirect_uri`. GoTrue rejects it because it is not on the allowed Redirect URLs list.
* **The Fix**: Before exchanging the code, the app checks if the URL has a custom scheme (`exp://` or `taskerai://`). If it does, it dynamically reconstructs the whitelisted HTTPS bridge path and uses it as the exchange URL:
  `https://[project].supabase.co/functions/v1/mobile-auth-bridge/redirect?code=[code]`
  This forces the SDK to send the allowed HTTPS path as the `redirect_uri`.

### Fix C: Zustand Store Bootstrapping Race Condition
* **The Bug**: `exchangeCodeForSession` triggers `onAuthStateChange('SIGNED_IN')` before resolving. Since the Zustand store's tokens were set *after* the promise resolved, the `SIGNED_IN` event fired while `providerToken` was still `null`. As a result, the bootstrapping flow `bootstrapUser` was bypassed, causing a stuck loading spinner.
* **The Fix**: We now call `bootstrapUser(session)` directly inside the callback handler immediately after the session exchange resolves and the tokens are saved in the store.

---

## 4. Required Configuration

### Supabase Dashboard URL Configuration
Under **Authentication -> URL Configuration -> Redirect URLs**, ensure you have added:
```
https://esngoeuhtpdzyfttofyu.supabase.co/functions/v1/mobile-auth-bridge/**
```

### Production Setup
This architecture works identically in production. When building standalone apps, ensure:
1. The Edge Function's allowed schemes match your production scheme (`taskerai://`):
   ```typescript
   if (!decoded.startsWith('exp://') && !decoded.startsWith('taskerai://')) {
     return new Response('Invalid redirect scheme', { status: 400 });
   }
   ```
2. In your production Supabase project's allowed Redirect URLs, you add your production edge function path:
   ```
   https://[production-project].supabase.co/functions/v1/mobile-auth-bridge/**
   ```
