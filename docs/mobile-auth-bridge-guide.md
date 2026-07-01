# Architecture Guide: Mobile OAuth Redirect Bridge

Standard OAuth flows (like Google Sign-In) inside hybrid mobile applications (React Native, Expo Go) often present complex integration challenges. This guide documents the **Mobile OAuth Redirect Bridge** architecture implemented in Tasker, explaining why this method was chosen, how it functions, and the complete code implementation.

---

## 1. The Core Problem: Why Traditional Mobile OAuth is Painful

When building a mobile application with Supabase Auth (GoTrue) and Google OAuth, you typically run into three major roadblocks:

1. **Protocol Restrictions**: Google and Supabase GoTrue require callback redirect URLs to be valid `http` or `https` schemes. They reject custom mobile protocols like `exp://` (Expo Go) or `taskerai://` (Production Standalone) directly in the initial request.
2. **Dynamic LAN IPs in Development**: During local development, Expo Go runs on dynamic developer LAN IPs and ports (e.g., `exp://192.168.0.192:8081`). Since these change constantly, you cannot whitelist them in the Google Cloud Console or Supabase URL Configuration.
3. **Double SDK Maintenance**: The "standard" native approach requires installing native Google Sign-In SDKs on iOS/Android, managing credentials separately in Google Cloud Console, signing in natively, and then passing the ID token to Supabase. This adds bundle weight, increases maintenance complexity, and breaks the universal code model between web and mobile.

---

## 2. The Solution: Mobile OAuth Redirect Bridge

Instead of using native SDKs, we route the authentication flow through a single, secure **HTTPS Edge Function** hosted on Supabase:

```
[Mobile App] ────────── (1) signInWithOAuth ──────────► [Supabase Auth]
     │                       (redirectTo = BRIDGE)            │
     │                                                        │ (2) Redirects
     ▼                                                        ▼
[OS Link Interceptor] ◄─── (4) HTTP 307 (exp://) ◄─── [Google Auth Screen]
  (auth-callback)             (Bridge Redirects)
```

### Flow Walkthrough
1. **Initiation**: The React Native app calls Supabase's `signInWithOAuth` with `redirectTo` pointing to the Edge Function (`BRIDGE`). The actual deep link (e.g., `exp://192.168.0.192:8081/--/auth-callback`) is URL-encoded and appended as a parameter:
   `https://[project].supabase.co/functions/v1/mobile-auth-bridge/redirect?exp=exp%3A%2F%2F192.168.0.192%3A8081%2F--%2Fauth-callback`
2. **Consent**: The user authenticates in the browser. Supabase GoTrue processes the auth code and redirects the browser to the `redirectTo` destination (the `BRIDGE`), appending the session `code` or `access_token` query/hash parameters.
3. **Bypassing the Protocol Check**: Because the `BRIDGE` URL is a secure `https://` domain belonging to your Supabase project, Supabase GoTrue allows it as a whitelisted redirect URI.
4. **Temporary Redirect**: The Edge Function extracts the dynamic target deep link (from the `exp` parameter), deletes `exp` from the query parameters, and performs an **HTTP 307 Temporary Redirect** back to the mobile deep link, carrying forward all authentication tokens.
5. **App Capture**: The operating system opens the app via the custom deep link, which is intercepted by the mobile code to complete the login process.

---

## 3. Why This Method Was Chosen

| Metric / Benefit | Native Google SDK Method | Redirect Bridge Method (Tasker) |
| :--- | :--- | :--- |
| **Bundle Size / Overhead** | Heavy (native library wrappers) | **Zero** (uses native web browser) |
| **Configuration Complexity** | High (plist files, credentials, Gradle files) | **Low** (one Supabase dashboard wildcard) |
| **Cross-Platform Portability** | Custom native code for Android/iOS | **100% Shared JS/TS Code** |
| **Local Dev Support** | Painful (must map/tunnel dynamic IPs) | **Automatic** (dynamic IP encoded in request) |
| **Google Console Maintenance** | Needs separate iOS + Android OAuth Clients | **Single Web Client** for the entire project |

---

## 4. Complete Code Implementation

### Backend: Supabase Edge Function (`supabase/functions/mobile-auth-bridge/index.ts`)
This lightweight function intercepts the callback, validates the target deep link protocol, and performs the redirect:

```typescript
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const expRedirect = url.searchParams.get('exp');

  // Read fallback from environment variable or default to production scheme
  const decoded = expRedirect
    ? decodeURIComponent(expRedirect)
    : Deno.env.get('DEV_EXPO_URL') || 'taskerai://auth-callback';

  // Security check: Only redirect to authorized schemes
  if (!decoded.startsWith('exp://') && !decoded.startsWith('taskerai://')) {
    return new Response('Invalid redirect scheme', { status: 400 });
  }

  // Clean the redirect parameters and redirect with status 307
  url.searchParams.delete('exp');
  const queryString = url.searchParams.toString();
  const separator = queryString ? (decoded.includes('?') ? '&' : '?') : '';
  const redirectTarget = `${decoded}${separator}${queryString}`;

  return Response.redirect(redirectTarget, 307);
});
```

### Frontend: Login Handler (`TaskerAI/app/(auth)/login.js`)
On mobile, we route the login request to the bridge:

```javascript
const expRedirectUri = AuthSession.makeRedirectUri({ path: 'auth-callback' });
const BRIDGE = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/mobile-auth-bridge/redirect?exp=${encodeURIComponent(expRedirectUri)}`;

const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: BRIDGE,
    scopes: 'https://www.googleapis.com/auth/gmail.readonly',
    queryParams: { access_type: 'offline', prompt: 'consent' },
    skipBrowserRedirect: true, // Let WebBrowser handle it
  },
});

if (oauthError || !data?.url) throw oauthError;

// Open in-app browser session
const result = await WebBrowser.openAuthSessionAsync(data.url, expRedirectUri);
if (result.type === 'success' && result.url) {
  await useAuthStore.getState().handleOAuthCallback(result.url);
}
```

### Frontend: State Store (`TaskerAI/store/authStore.js`)
Handles the incoming OAuth tokens and addresses race conditions:

```javascript
handleOAuthCallback: async (url) => {
  // Prevent duplicate callback loops (e.g. useURL and WebBrowser resolving together)
  if (get()._lastProcessedUrl === url) return;

  if (get().session) {
    // Fallback: If session was restored in the background, extract provider token
    if (!get().providerToken) {
      const params = new URLSearchParams(url.split('#')[1] || url.split('?')[1] || '');
      const providerToken = params.get('provider_token');
      if (providerToken) {
        set({
          _lastProcessedUrl: url,
          providerToken,
          providerRefreshToken: params.get('provider_refresh_token') || null,
        });
        await get().bootstrapUser(get().session);
      }
    }
    return;
  }
  
  set({ _lastProcessedUrl: url, _callbackInProgress: true, isLoading: true });
  
  // (Proceed to exchange code/set session in Supabase SDK)
}
```

### Frontend: Navigation Guard (`TaskerAI/app/_layout.js`)
Ensures segments changes trigger redirection back to tab navigation:

```javascript
useEffect(() => {
  if (isLoading) return;

  const inAuthGroup = segments[0] === '(auth)';
  const inOnboardingGroup = segments[0] === '(onboarding)';

  if (!session) {
    if (!inAuthGroup) router.replace('/(auth)/login');
    return;
  }

  // Redirect to tab pages if authenticated and no onboarding wizard is active
  if (inAuthGroup || inOnboardingGroup) {
    router.replace('/(tabs)');
  }
}, [session, isLoading, wizardStep, segments]); // <-- segments dependency is key!
```

---

## 5. Required Configurations

### 1. Supabase Redirect URL Wildcard
In your **Supabase Dashboard** under **Authentication -> URL Configuration -> Redirect URLs**, add a single wildcard URL matching the Edge Function:
```
https://[project-ref].supabase.co/functions/v1/mobile-auth-bridge/**
```
The `/**` wildcard allows the project to dynamically route parameters like `?exp=...` safely without breaking the allowed list.

### 2. Google Cloud Console Redirect URIs
No mobile redirects are added to Google. Simply whitelist Supabase's built-in callback URL in your web client credentials:
```
https://[project-ref].supabase.co/auth/v1/callback
```
