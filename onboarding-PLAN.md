# Auth & Onboarding Wizard — TaskerAI React Native
## *"TaskerAI — Know What Matters Next."*

> **SDLC Phase:** Phase 3 (Implementation)
> **Principles applied:** `DESIGN_SYSTEM.md` · `system-design-sdlc` · `clean-code`

---

## 0. Agent Orientation (READ THIS FIRST)

### Repo & Workspace
- **Monorepo root:** `c:\Users\rikku\OneDrive\Desktop\tasker`
- **All new code goes in:** `c:\Users\rikku\OneDrive\Desktop\tasker\TaskerAI\`
- **Web app (DO NOT TOUCH):** `c:\Users\rikku\OneDrive\Desktop\tasker\frontend\`
- **Supabase project ID:** `esngoeuhtpdzyfttofyu`
- **Supabase URL:** `https://esngoeuhtpdzyfttofyu.supabase.co`

### MCP Tools Required
1. **code-review-graph** — Run `list_graph_stats_tool` first. If `last_updated` is more than 1 hour old, run `build_or_update_graph_tool` (incremental). Use `semantic_search_nodes_tool` to find any existing function before writing a new one.
2. **supabase MCP** — Use `execute_sql` with project ID `esngoeuhtpdzyfttofyu` to verify table schemas before writing any DB queries. Key table: `user_settings`.

### What Already Exists in `TaskerAI/` — DO NOT OVERWRITE
| File/Folder | Status | Notes |
|---|---|---|
| `app/_layout.js` | ✅ EXISTS | Add auth guard logic to this file — do not replace it entirely |
| `app/_layout.web.js` | ✅ EXISTS | Wraps `<WebShell />` — add auth guard here too |
| `app/(tabs)/` | ✅ EXISTS | 5 tab screens: index, tasks, waiting, projects, people. DO NOT TOUCH |
| `app/(tabs)/_layout.js` | ✅ EXISTS | Frosted glass tab bar — DO NOT TOUCH |
| `components/Theme.js` | ✅ EXISTS | All `T.*` design tokens are here — import from here, never invent values |
| `components/Icons.js` | ✅ EXISTS | Icon components already defined |
| `components/web/` | ✅ EXISTS | Web-only shell, sidebar, etc. DO NOT TOUCH |
| `lib/` | 🆕 EMPTY | Create new files here |
| `store/` | 🆕 EMPTY | Create new files here |

### Dependencies Already Installed
All packages below are already in `TaskerAI/package.json` — **do NOT run npm/expo install**:
- `@supabase/supabase-js` ✅
- `@react-native-async-storage/async-storage` ✅
- `expo-auth-session` ✅
- `expo-web-browser` ✅
- `expo-linking` ✅
- `zustand` ✅
- `react-native-url-polyfill` — **NOT installed** — must be added: `npx expo install react-native-url-polyfill`

### Pre-flight Checklist (Already Done by User)
- [x] `app.json` has `"scheme": "taskerai"` (line 6)
- [x] Supabase Redirect URLs: `taskerai://**` and `http://localhost:8081/**` added
- [x] `TaskerAI/.env` file created with:
  ```
  EXPO_PUBLIC_SUPABASE_URL=https://esngoeuhtpdzyfttofyu.supabase.co
  EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzbmdvZXVodHBkenlmdHRvZnl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNjIzNDQsImV4cCI6MjA4ODczODM0NH0.cqgKh0m2osCqGDm1eamQF9WLVZXYgLd8opuk2Yo-EN8
  ```

---

## 1. Requirements

### Functional Requirements
| # | Requirement |
|---|---|
| F1 | User can sign in with Google (Gmail OAuth) via `expo-auth-session` |
| F2 | New user sees 3-step wizard: Lookback → Tracking Prefs → Email Sources |
| F3 | Wizard submits to `sync` edge function with `bootstrap_only: true` |
| F4 | Progress screen polls `user_settings` every 10s until `onboarding_status = 'complete'` |
| F5 | Returning user (onboarding_status = 'complete') bypasses wizard entirely |
| F6 | Session persists across app restarts (AsyncStorage) |
| F7 | "Skip to Dashboard" exits polling without losing background sync |

### Non-Functional Requirements
| # | Requirement |
|---|---|
| NF1 | All colors, type, spacing from `components/Theme.js` (`T.*`) — no invented values |
| NF2 | Each component has single responsibility (clean-code SRP) |
| NF3 | Functions ≤ 20 lines; max 2 arguments |
| NF4 | Auth token never logged or persisted to plaintext |
| NF5 | Polling interval always cleared on unmount — no memory leaks |

---

## 2. Database Schema (verify with supabase MCP before writing queries)

Use `execute_sql` on project `esngoeuhtpdzyfttofyu`:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'user_settings';
```

Key columns used in this feature:
| Column | Type | Used For |
|---|---|---|
| `user_id` | uuid | Filter by `session.user.id` |
| `onboarding_status` | text | `null` / `'queued'` / `'processing'` / `'complete'` |
| `onboarding_progress` | jsonb | `{threads_total, threads_done, eta_seconds, queue_position}` |
| `user_profile` | text | Detect new users (null or default string) |
| `last_synced_at` | timestamptz | Health check |

---

## 3. Architecture

```
App Launch
    │
    ▼
_layout.js (auth guard)
    │
    ├── No session ──────────────────► (auth)/login.js
    │                                        │
    │                                   Google OAuth
    │                                        │
    │                                   SIGNED_IN event
    │                                        │
    │                              authStore.bootstrapUser()
    │                                        │
    ├── New user ─────────────────► (onboarding)/step-lookback.js
    │                                        │
    │                               step-tracking.js
    │                                        │
    │                               step-sources.js
    │                                        │
    │                            handleWizardComplete()
    │                          supabase.functions.invoke('sync')
    │                                        │
    │                               (onboarding)/progress.js
    │                             polls user_settings every 10s
    │                                        │
    │                            onboarding_status = 'complete'
    │                                        │
    └── Returning user ──────────────────► (tabs)/
```

---

## 4. Critical Implementation Detail — `provider_token`

> [!IMPORTANT]
> This is the most subtle bug to avoid. Read carefully.

Google's Gmail access token (`provider_token`) is **only available once** — during the OAuth consent screen (`SIGNED_IN` event). On every subsequent app reload or token refresh, `session.provider_token` is `null`.

The `sync` edge function needs this token to call Gmail API. Therefore:

**The `authStore` MUST capture it immediately on `SIGNED_IN`:**

```js
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session?.provider_token) {
    // ← Capture RIGHT NOW. It will be null on next refresh.
    useAuthStore.getState().bootstrapUser(session);
  }
});
```

**The store holds it until wizard completes:**
```js
// Inside authStore:
providerToken: null,
providerRefreshToken: null,

bootstrapUser: (session) => {
  set({
    providerToken: session.provider_token,
    providerRefreshToken: session.provider_refresh_token,
  });
  // then navigate to wizard
}
```

**Wizard final step sends it:**
```js
// Inside step-sources.js handleWizardComplete:
const { providerToken, providerRefreshToken } = useAuthStore.getState();
await supabase.functions.invoke('sync', {
  body: {
    providerToken,
    providerRefreshToken,
    bootstrap_only: true,
    sync_flags: { ... }
  }
});
```

This exact pattern is used in the web app (`frontend/src/App.jsx` lines 41, 58, 125–128, 184).

---

## 5. Design Tokens (from `components/Theme.js`)

Import ONLY from `components/Theme.js`. Never hardcode color/spacing values.

```js
import { T } from '../../components/Theme';
```

Key tokens for onboarding screens:
| Token | Value | Use |
|---|---|---|
| `T.accent` | `#F2673C` | Primary CTA, active borders, checkbox fill |
| `T.accentTint` | `rgba(242,103,60,0.12)` | Selected tile background |
| `T.bg` | `#F8FAFC` | Screen background |
| `T.surface` | `#ffffff` | Card/tile background |
| `T.surfaceWarm` | `#F1F5F9` | Secondary tile background |
| `T.fg` | `#111827` | Primary text |
| `T.fg2` | `#374151` | Secondary text |
| `T.muted` | `#6B7280` | Subtitles, hints, tagline |
| `T.border` | `#E5E7EB` | Default borders |
| `T.warmSurface` | `#FFF8F5` | Warm accent panels |
| `T.warmBorder` | `#FFE4D9` | Warm accent borders |
| `T.logoGrad` | `['#F2673C', '#ea580c']` | Logo gradient, primary button |
| `T.radiusSm` | `10` | Tiles |
| `T.radiusMd` | `15` | Cards |
| `T.radiusPill` | `9999` | Pills, badges |
| `T.sp4` | `16` | Standard padding |
| `T.sp6` | `24` | Screen horizontal padding |
| `T.sp8` | `32` | Section gaps |
| `T.textXs` | `12` | Badges, step counter |
| `T.textSm` | `14` | Descriptions, subtitles |
| `T.textBase` | `16` | Card names |
| `T.textXl` | `24` | Wizard step titles |
| `T.motionFast` | `150` | Checkbox/tile toggle (ms) |
| `T.motionBase` | `240` | Screen transitions (ms) |

### Tagline
```js
// lib/brand.js
export const BRAND = {
  name: 'TaskerAI',
  tagline: 'TaskerAI — Know What Matters Next.',
  wordmark: { primary: 'Tasker', accent: 'AI' },
};
```
Place tagline on: **Login screen** (below welcome pill) and **Progress screen** (under spinner title). Use `T.muted`, `T.textXs`, `letterSpacing: 0.7`.

---

## 6. Google OAuth — Mobile Implementation

> [!IMPORTANT]
> Mobile OAuth is different from web. Do NOT use `supabase.auth.signInWithOAuth()` directly (that's the web pattern in `frontend/src/Auth.jsx`). Use `expo-auth-session` instead.

```js
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const handleGoogleLogin = async () => {
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'taskerai' });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUri,
      scopes: 'https://www.googleapis.com/auth/gmail.readonly',
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) return;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);

  if (result.type === 'success') {
    const url = result.url;
    // Supabase client auto-detects the session from the URL
    await supabase.auth.setSession({
      access_token: /* parse from url */ '',
      refresh_token: /* parse from url */ '',
    });
    // OR: use supabase.auth.getSessionFromUrl(result.url)
  }
};
```

> **Simpler alternative**: Use `supabase.auth.signInWithOAuth` with `skipBrowserRedirect: true` + `WebBrowser.openAuthSessionAsync`, then call `supabase.auth.getSessionFromUrl(result.url)`. Check current Supabase JS v2 docs for exact method name.

---

## 7. File Structure — What to Create

All paths relative to `TaskerAI/`:

```
lib/                          ← currently empty
  supabase.js                 [NEW] Supabase singleton client
  brand.js                    [NEW] BRAND constant + tagline

store/                        ← currently empty
  authStore.js                [NEW] Zustand store for auth + wizard state

hooks/
  useOnboardingPolling.js     [NEW] 10s polling hook with cleanup

app/
  _layout.js                  [MODIFY] Add auth guard + font loading (DO NOT replace providers)
  _layout.web.js              [MODIFY] Add same auth guard for web
  (auth)/
    _layout.js                [NEW] Bare Stack, headerShown: false
    login.js                  [NEW] Login screen with Google OAuth
  (onboarding)/
    _layout.js                [NEW] Stack, disable back on progress screen
    step-lookback.js          [NEW] Step 1: lookback days
    step-tracking.js          [NEW] Step 2: tracking preferences
    step-sources.js           [NEW] Step 3: email sources + labels
    progress.js               [NEW] Progress screen with polling

components/
  onboarding/                 [NEW folder]
    WizardHeader.js           [NEW] Brand row + step dots (display only)
    WizardTile.js             [NEW] Pressable tile (selected/unselected)
    WizardCheckRow.js         [NEW] Checkbox row
    ServiceCard.js            [NEW] OAuth provider card
```

---

## 8. Detailed Implementation — Phase by Phase

### Phase A — Foundation

#### A1. Install missing dependency
```bash
cd c:\Users\rikku\OneDrive\Desktop\tasker\TaskerAI
npx expo install react-native-url-polyfill
```

#### A2. `lib/supabase.js` [NEW]
```js
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

#### A3. `lib/brand.js` [NEW]
```js
export const BRAND = {
  name: 'TaskerAI',
  tagline: 'TaskerAI — Know What Matters Next.',
  wordmark: { primary: 'Tasker', accent: 'AI' },
};
```

#### A4. `store/authStore.js` [NEW]
Zustand store. Fields:
- `session` — Supabase session object
- `providerToken` — Gmail OAuth token (captured once on SIGNED_IN)
- `providerRefreshToken`
- `wizardStep` — `null | 'lookback' | 'tracking' | 'sources' | 'progress'`
- `onboardingProgress` — `{ threads_total, threads_done, eta_seconds, queue_position }`
- `wizardFlags` — `{ lookbackDays: 30, trackingPrefs: [...], gmailLabels: [...], customLabelIds: [], otherText: '' }`
- `errorMessage` — string (never use alert())

Actions:
- `initAuth()` — calls `supabase.auth.getSession()` + sets up `onAuthStateChange` listener
- `bootstrapUser(session)` — captures providerToken, checks `onboarding_status`, sets wizardStep
- `checkSyncHealth(session)` — for app restores: checks if onboarding in progress, resumes polling
- `handleWizardComplete()` — invokes `sync` edge function with providerToken + wizardFlags
- `signOut()` — calls `supabase.auth.signOut()`, resets store
- `setWizardFlags(partial)` — merges partial update into wizardFlags

**Logic for `bootstrapUser` (mirrors web app `App.jsx` lines 110–131):**
```
1. Guard: if already triggered, return early
2. Query user_settings for onboarding_status
3. If 'complete': return (returning user, no wizard)
4. If 'queued'/'processing': set wizardStep='progress', start polling
5. Else: set providerToken from session, set wizardStep='lookback'
```

#### A5. `hooks/useOnboardingPolling.js` [NEW]
```js
// Polls user_settings every 10s
// Clears interval when onboarding_status = 'complete'
// useEffect cleanup always clears interval on unmount
```

---

### Phase B — Navigation Shell

#### B1. Modify `app/_layout.js` [MODIFY — do not replace existing providers]

Add to the existing layout:
1. Load fonts with `useFonts` (Plus Jakarta Sans + Inter — already in package.json)
2. Call `useAuthStore.getState().initAuth()` in `useEffect([], [])`
3. Read `session` and `wizardStep` from store
4. Add `<Redirect>` logic:
   - No session → redirect to `/(auth)/login`
   - Has session + wizardStep → redirect to `/(onboarding)/step-lookback` (or appropriate step)
   - Has session + no wizardStep → allow through to `/(tabs)`
5. Declare Stack screens: `(auth)`, `(onboarding)`, `(tabs)`

Keep existing: `<SafeAreaProvider>`, `<GestureHandlerRootView>`

#### B2. Modify `app/_layout.web.js` [MODIFY — keep WebShell]
Mirror the same auth guard. When no session, render the login screen inline or redirect. Keep `<WebShell />` wrapping.

---

### Phase C — Shared Onboarding Components

All components in `components/onboarding/`.

#### C1. `WizardHeader.js`
Props: `step` (1|2|3|null), `totalSteps` (3)
Renders: Logo mark + "Tasker**AI**" wordmark | step counter text | 3 dot progress indicators
No state. Pure display. Uses `T.accent`, `T.fg`, `T.muted`, `T.textXs`.

#### C2. `WizardTile.js`
Props: `label`, `selected`, `onPress`
Renders: `Pressable` with border `T.border` (default) or `T.accent` + bg `T.accentTint` (selected)
Uses `Animated` for `T.motionFast` (150ms) color transition.

#### C3. `WizardCheckRow.js`
Props: `label`, `description`, `checked`, `onToggle`
Renders: Full-width `Pressable` row with custom checkbox (filled `T.accent` when checked), label in `T.fg`, description in `T.muted`.

#### C4. `ServiceCard.js`
Props: `icon` (ReactNode), `name`, `description`, `badge` (string|null), `onConnect`, `loading`, `primary`
Renders: White card with border `T.border`, icon, text, button (gradient if `primary`).
Elevation: `shadowColor:'#000', shadowOffset:{0,4}, shadowOpacity:0.07, shadowRadius:16, elevation:4`

---

### Phase D — Screens

#### D1. `(auth)/login.js`
- Full-screen layout: left hero panel + right service cards (web) / single scroll (mobile)
- Display `BRAND.tagline` below welcome pill in `T.muted`, `T.textXs`
- One `ServiceCard` for Google (primary, active), two dimmed "Coming Soon" cards (Slack, Teams)
- `handleGoogleLogin` using expo-auth-session pattern (Section 6 above)
- On success: `onAuthStateChange` fires `SIGNED_IN` → `bootstrapUser()` → navigation handled by root layout

#### D2. `(onboarding)/step-lookback.js`
- `<WizardHeader step={1} totalSteps={3} />`
- Title: "How far back should we look?"
- 2×2 grid of `<WizardTile>`: 7 days / 30 days / 90 days / Custom
- Custom: `<TextInput keyboardType='numeric'>` reveals when "Custom" selected
- State stored in `useAuthStore` wizardFlags.lookbackDays
- "Continue" → navigate to step-tracking

#### D3. `(onboarding)/step-tracking.js`
- `<WizardHeader step={2} totalSteps={3} />`
- Title: "What matters to you?"
- 4 `<WizardCheckRow>` items: Tasks, Deadlines, People, Projects
- One `<TextInput>` for "Other" custom category
- State in wizardFlags.trackingPrefs + otherText
- "Back" → step-lookback | "Continue" → step-sources

#### D4. `(onboarding)/step-sources.js`
- `<WizardHeader step={3} totalSteps={3} />`
- Title: "Where should we look?"
- 3 `<WizardCheckRow>`: IMPORTANT, INBOX, SENT
- Expandable "Use my Gmail labels" section → calls `supabase.functions.invoke('labels')` to fetch user's Gmail labels
- "Start Syncing" button: calls `handleWizardComplete()` from store → navigate to progress

#### D5. `(onboarding)/progress.js`
- Display `BRAND.tagline` under spinner title
- 3-step status list (same as web app): Fetching emails / Filtering noise / Building your graph
- `Animated` progress bar: width driven by `(threads_done / threads_total) * 100%`, animated with `T.motionBase` (240ms)
- Queue position notice when > 0
- Uses `useOnboardingPolling` hook
- "Skip to Dashboard" → clear poll → navigate to tabs

---

### Phase E — Verification Checklist

Run each check in Expo Go on iOS simulator or Android emulator:

| # | Check | Expected |
|---|---|---|
| E1 | Cold launch, no session | Login screen appears |
| E2 | Tap "Connect Google", complete OAuth | Wizard starts at Step 1 (lookback) |
| E3 | Navigate wizard forward and back | Selections preserved in store |
| E4 | Reach Step 3, enable custom labels | Labels load from edge function |
| E5 | Tap "Start Syncing" | Progress screen shows ETA |
| E6 | Wait 10s | `threads_done` count updates |
| E7 | `onboarding_status` becomes `'complete'` | Tabs appear automatically |
| E8 | Sign out, sign in again (no consent screen) | Wizard skipped, goes to tabs |
| E9 | Kill app mid-wizard, reopen | Resumes at correct state |

---

## 9. Clean-Code Constraints

| Rule | Application |
|---|---|
| Functions ≤ 20 lines | `handleGoogleLogin`, `checkSyncHealth`, `bootstrapUser` each stay tight |
| Single responsibility | `WizardHeader` renders header only. `useOnboardingPolling` manages interval only. `authStore` holds auth state only. |
| Intention-revealing names | `wizardStep`, `onboardingProgress`, `providerToken` — never abbreviate |
| No magic numbers | All intervals, sizes, colors reference `T.*` or `BRAND.*` or named constants |
| Error handling | Every async action has `try/catch`; errors set `errorMessage` in store — never use `alert()` |
| No null returns | Store actions return early with meaningful guards |

---

## 10. What NOT to Touch

- `app/(tabs)/` — all tab screens work and must remain untouched
- `app/(tabs)/_layout.js` — frosted glass tab bar — do not modify
- `components/web/` — web sidebar, shell, task detail panel — do not modify
- `components/Theme.js` — read-only, import from it
- `frontend/` — the old web app, archived, do not touch
- `supabase/` — edge functions and migrations — do not modify
