---
name: dashboard
description: SOP for the frontend task dashboard — a static PWA that reads from Supabase in real-time and displays academic tasks in a glanceable widget interface.
---

# Academic Task Dashboard – Frontend

## Goal
A minimal, glanceable, cross-device task dashboard. Opens in any browser, installable as a PWA (add to home screen). Reads tasks from Supabase in real-time — no manual refresh required.

## Stack
- HTML + CSS + Vanilla JS
- `@supabase/supabase-js` via CDN
- PWA manifest + service worker for installability

## Environment Variables (set in `frontend/config.js`)
```js
const SUPABASE_URL = "https://<your-project>.supabase.co"
const SUPABASE_ANON_KEY = "<your-anon-key>"
const N8N_REFRESH_WEBHOOK = "https://<your-n8n>/webhook/refresh"
```

## Files
- `frontend/index.html` — main shell
- `frontend/style.css` — all styles
- `frontend/app.js` — Supabase client, real-time subscription, task rendering
- `frontend/config.js` — env vars (gitignored)
- `frontend/manifest.json` — PWA manifest
- `frontend/sw.js` — service worker (offline shell)

## UI Layout

```
┌──────────────────────────────┐
│  Tue Mar 10   Last: 9:32 AM  │  ← header bar
│                        [↻]   │  ← refresh button
├──────────────────────────────┤
│  TODAY                       │  ← section header
│  ┌──────────────────────┐    │
│  │ [DAA]  Quiz  9 AM ⚠️ │    │  ← task card
│  │ "Quiz tomorrow, Lab 4"│    │
│  └──────────────────────┘    │
│  ┌──────────────────────┐    │
│  │ [OS]   Lab   2 PM    │    │
│  └──────────────────────┘    │
├──────────────────────────────┤
│  UPCOMING                    │
│  [CN]  Assignment  Thu       │
│  [DAA] Project     Fri  🔄   │
├──────────────────────────────┤
│  COMPLETED  ▾                │  ← collapsible
└──────────────────────────────┘
```

## Task Card Spec
- Course badge: short color-coded label (auto color per unique course name)
- Title + deadline ("Tomorrow 9 AM" / "In 3 days" / "Thu 5 PM")
- 1-line summary from LLM
- ⚠️ badge if warnings exist (tooltip shows warning text)
- 🔄 badge if `updated = true` (tooltip shows `change_note`)
- Tap/click to expand: full summary + "Open in Gmail" button
- Swipe left or checkbox: mark complete → PATCH Supabase `status = 'completed'`

## Real-time Updates
```js
supabase
  .channel('tasks')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, 
    payload => renderTasks())
  .subscribe()
```
Dashboard auto-updates when n8n upserts without any user action.

## Refresh Button
- Calls `N8N_REFRESH_WEBHOOK` via `fetch POST`
- Shows spinner while waiting
- On webhook response, real-time subscription re-renders automatically

## PWA Setup
- Add to `<head>`: `<link rel="manifest" href="manifest.json">`
- `manifest.json`: name, short_name, start_url, display: standalone, icons
- `sw.js`: cache the shell for offline access

## Deployment
- Recommended: deploy `frontend/` to **Vercel** or **Netlify** (free, instant HTTPS, same URL on all devices)
- Or: open `index.html` locally (no HTTPS = no PWA install, but still works in browser)
- Share the URL with any device to access the dashboard

## Learnings
- Supabase anon key is safe to expose in frontend (RLS restricts write access)
- PWA install banner appears automatically on Chrome/Android after first visit
- iOS Safari: user must manually "Add to Home Screen" from share menu
