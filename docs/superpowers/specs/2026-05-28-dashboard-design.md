# Dashboard Design Spec
**Date:** 2026-05-28  
**Branch:** 002-graph-rag  
**Status:** Approved

---

## Overview

Replace the current monolithic dark-themed App.jsx dashboard (tabs: Tasks View / Graph Console / Directory) with a WorkHub-style three-column light dashboard. The new dashboard shows email threads sorted by urgency in the middle panel, with AI-generated summaries, action items, and suggested replies in the right detail panel.

---

## 1. Architecture & File Structure

### Files Created
| File | Purpose |
|---|---|
| `frontend/src/Dashboard.jsx` | Three-column layout shell. Owns global state: threads, userSettings, selectedThread, activeView. Handles sync + Realtime subscriptions. |
| `frontend/src/Sidebar.jsx` | Left navigation. Props: `activeView`, `threadCounts`, `userSettings`, `onNavigate`, `onSync`, `onSignOut` |
| `frontend/src/TaskList.jsx` | Middle panel. Props: `threads`, `selectedThread`, `activeFilter`, `onSelectThread`, `onFilterChange`, `loading` |
| `frontend/src/TaskDetail.jsx` | Right panel. Props: `thread`, `session`, `supabase`. Fetches thread detail on selection. |
| `frontend/src/PeopleView.jsx` | Contacts directory. Direct Supabase query (`contacts` table). |
| `frontend/src/ProjectsView.jsx` | Projects directory. Direct Supabase query (`projects` table). |
| `frontend/src/AskAIView.jsx` | Graph RAG chat. Calls `supabase.functions.invoke('query', ...)`. |

### Files Modified
| File | Change |
|---|---|
| `frontend/src/App.jsx` | Trimmed to ~200 lines: Supabase init, session state, `bootstrapUser`, `checkSyncHealth`, auth routing (Auth.jsx vs Dashboard.jsx), wizard overlay. **`fetchTasks` removed** — Dashboard.jsx fetches threads independently. **All Realtime subscriptions removed** — Dashboard.jsx owns them. All task/graph/directory rendering removed. |
| `frontend/src/index.css` | Append `db-*` CSS classes for the three-column dashboard layout. No existing classes modified. |

### App.jsx → Dashboard.jsx Handoff
App.jsx passes `{ session, supabase, onSignOut }` as props to Dashboard.jsx. Dashboard.jsx independently calls `api/feed` on mount and whenever `session` changes. `bootstrapUser` in App.jsx still triggers `setWizardStep(2)` for new users — the wizard overlay renders above `<Dashboard>` so the two are independent. When wizard completes (`wizardStep → null`), Dashboard re-fetches via a `useEffect` dep on `wizardStep`.

### Files Unchanged
- `frontend/src/Auth.jsx` — two-panel OAuth page, untouched
- `supabase/functions/api/index.ts` — already complete, serves `/feed` and `/thread-detail`
- All other edge functions

---

## 2. Data Model & API

### Primary Data Source: `api` Edge Function

**`POST /feed`** — Middle panel threads list
```json
Request:  { "filter": "all" | "important" | "action" | "unread", "limit": 20, "offset": 0 }
Response: { "threads": [{ id, subject, urgency, action_type, ai_summary, is_read, created_at, sender_name, sender_email, gmail_url }], "nextOffset": 20 }
```

**`POST /thread-detail`** — Right panel detail
```json
Request:  { "thread_id": "<uuid>" }
Response: { "thread": { ...all columns, action_items[], suggested_reply, gmail_url }, "emails": [...], "context": { edges: [...] } }
```

### Filter Tab → API Filter Mapping
| Tab | `filter` param | What it shows |
|---|---|---|
| All | `all` | All threads, newest first |
| Priority | `important` | urgency: URGENT or HIGH |
| Action | `action` | action_type: reply / approve / review / join |
| Unread | `unread` | is_read: false |

### Secondary Data Sources (view-specific)
| View | Source |
|---|---|
| PeopleView | `supabase.from('contacts').select('*')` |
| ProjectsView | `supabase.from('projects').select('*')` |
| AskAIView | `supabase.functions.invoke('query', { body: { query, mode } })` |

### Sidebar Counts (derived from `threads[]`, no extra queries)
- **Inbox** badge = `threads.length`
- **Priority** badge = `threads.filter(t => t.urgency === 'URGENT' || t.urgency === 'HIGH').length`
- **Unread** dot = `threads.some(t => !t.is_read)`

---

## 3. Layout & Navigation

### Three-Column Shell
```
┌──────────┬──────────────────────┬───────────────────────┐
│ SIDEBAR  │    TASK LIST         │   DETAIL PANEL        │
│  240px   │      420px           │      flex-1           │
│  fixed   │      fixed           │      scrollable       │
└──────────┴──────────────────────┴───────────────────────┘
```
- `height: 100vh`, `overflow: hidden` on the shell
- Each column scrolls independently
- Sidebar and list are `overflow-y: auto`, detail panel is `overflow-y: auto`

### Sidebar Nav Items
```
[Logo] Tasker AI

● Tasks          ← active by default; shows TaskList + TaskDetail
  People         ← PeopleView replaces middle+right columns
  Projects       ← ProjectsView replaces middle+right columns

AI TOOLS
  Ask AI         ← AskAIView (Graph RAG chat)

────────────────
  Settings       ← small dropdown: sync info, Gmail account, sign out
  [Avatar initials]
```

- Active item: `background: #eff6ff; color: #1d4ed8; border-radius: 6px`
- Hover: `background: #f3f4f6`
- Section labels ("AI TOOLS") in small caps, `color: #9ca3af`

### Theme
- Background: `#ffffff`
- Text: `#111827`
- Sidebar bg: `#f9fafb` with `border-right: 1px solid #e5e7eb`
- Accent blue: `#1d4ed8` / `#2563eb` (same tokens as Auth + Wizard)
- CSS namespace: `db-*` (dashboard), additive to index.css

---

## 4. Middle Panel (TaskList.jsx)

### Header
```
Good morning, [first name] 👋
Here's what needs your attention today.
```
First name derived from `session.user.user_metadata.full_name` or email prefix.

### Filter Tabs
`All (N) | Priority (N) | Action (N) | Unread (N)`  
Active tab: `border-bottom: 2px solid #1d4ed8; color: #1d4ed8`

### Thread Row
```
[urgency dot] [Gmail M icon] [Subject]          [time-ago]
              [Sender · Category]  [URGENT badge]  [▶ Action btn]
```
- Urgency dot: red (`#ef4444`) = URGENT, orange (`#f97316`) = HIGH, grey = LOW
- Urgency badge: `URGENT` red pill, `HIGH` orange pill, `MEDIUM` yellow, `LOW` grey
- Time-ago: formatted relative ("15m ago", "2h ago", "May 22")
- Action button: small outlined button label from `action_type` ("Approve" / "Reply" / "Review" / "View")
- Selected row: `background: #eff6ff; border-left: 3px solid #2563eb`
- Unread row: subject in `font-weight: 600`

### Empty / Loading States
- Loading: spinner + "Loading your inbox..."
- Empty: "You're all caught up! 🎉 We'll notify you when something important comes in."

### Pagination
Infinite scroll — load next 20 on scroll-to-bottom via `nextOffset` from API.

---

## 5. Right Panel (TaskDetail.jsx)

### Header
```
[← Back]                          [clock] [check] [archive] [⋯]
[Gmail M] Subject line                              URGENT badge
          Sender Name (Org) · sender@email.com       time-ago
          To: you@email.com
```
Back button only visible on mobile (< 768px).

### Tabs
`Summary | Email | Context`

**Summary tab** (default):
- `✦ AI Summary` section — renders `thread.ai_summary` or "Summary not yet generated."
- "Show more" toggle if summary > 3 lines
- `Action Items` section — renders `thread.action_items[]` as interactive checkboxes (visual only, no DB write in v1)
- `+ Add subtask` — disabled in v1 (shown greyed)
- `Suggested Reply` section — renders `thread.suggested_reply` in a grey box with `[Use Reply]` button that copies text to clipboard

**Email tab:**
- Lists raw email bodies from `thread.emails[]` in chronological order
- Each message: sender, time, body text
- `[Open in Gmail ↗]` link using `thread.gmail_url`

**Context tab:**
- Shows graph edges from `thread.context.edges[]`
- Simple list: "Riya Singh → SENT_BY → this thread"
- Falls back to "No context graph data available." if empty

### Loading State
Skeleton shimmer on first load. Error state: "Could not load thread details."

---

## 6. Error Handling

| Scenario | Behavior |
|---|---|
| `/feed` API error | Show "Could not load inbox" banner, retry button |
| `/thread-detail` error | Show "Could not load thread details" in right panel |
| No threads after sync | Show empty state with "Sync your Gmail" CTA |
| Session expired | `supabase.auth.signOut()` → redirects to Auth.jsx |

---

## 7. Features Preserved from Current App

| Current Feature | Where it lives in new design |
|---|---|
| Onboarding wizard (`wizardStep`) | App.jsx — rendered as `position: fixed` overlay above Dashboard |
| Manual sync button | Sidebar.jsx — sync icon next to Settings |
| Sign out | Sidebar.jsx — Settings dropdown |
| Realtime subscriptions (tasks/settings) | Dashboard.jsx — subscribes to `threads` table changes. Old subscriptions on `tasks` + `user_settings` tables **removed from App.jsx**. |
| Graph RAG chat | AskAIView.jsx |
| Directory (contacts/projects) | PeopleView.jsx / ProjectsView.jsx |
| `bootstrapUser` + `checkSyncHealth` | App.jsx — unchanged logic |

---

## 8. Out of Scope (v1)

- Marking threads as read (is_read write-back) — visual only
- Action item checkbox persistence — visual only  
- Reply sending — `POST /reply` is stubbed
- Mobile responsive sidebar collapse
- Dark mode toggle
- Search bar functionality
- Notifications bell
