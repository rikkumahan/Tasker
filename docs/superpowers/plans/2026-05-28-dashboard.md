# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dark monolithic App.jsx dashboard with a WorkHub-style three-column light dashboard (Sidebar + TaskList + TaskDetail) wired to the existing `api` edge function.

**Architecture:** App.jsx becomes an auth/session/wizard shell (~350 lines). Dashboard.jsx owns the three-column layout and all thread state. Seven focused component files handle individual panels. Data flows from the `api` edge function (`POST /feed`, `POST /thread-detail`). CSS uses the `db-*` namespace appended to index.css.

**Tech Stack:** React 18 JSX, Vite, Supabase JS v2, date-fns, lucide-react, existing `api` Hono/Deno edge function.

---

### Task 1: Pre-flight — Apply migration 016 and deploy api edge function

**Files:**
- Reference: `supabase/migrations/016_dashboard_schema.sql` (already exists, may not be applied)
- Reference: `supabase/functions/api/index.ts` (already exists, may not be deployed)

- [ ] **Step 1: Apply migration 016 to add dashboard columns to threads**

```bash
npx supabase db push
```
Expected: migration `016_dashboard_schema.sql` applied. Adds `urgency`, `action_type`, `ai_summary`, `is_read`, `action_items`, `suggested_reply` to `threads`.

- [ ] **Step 2: Deploy the api edge function**

```bash
npx supabase functions deploy api
```
Expected: `api` function deployed. Verify by checking Supabase dashboard → Edge Functions → `api` shows as active.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: apply migration 016 and deploy api edge function"
```

---

### Task 2: CSS — Add db-* dashboard classes to index.css

**Files:**
- Modify: `frontend/src/index.css` (append at the end — do not change existing classes)

- [ ] **Step 1: Append the following CSS block to the very end of `frontend/src/index.css`**

```css
/* ═══════════════════════════════════════════════════
   DASHBOARD — db-* namespace
   Three-column WorkHub-style layout
   ═══════════════════════════════════════════════════ */

/* ── Shell ── */
.db-shell { display: flex; height: 100vh; overflow: hidden; background: #fff; color: #111827; }
.db-main  { flex: 1; display: flex; overflow: hidden; min-width: 0; }

/* ── Sidebar ── */
.db-sidebar { width: 240px; min-width: 240px; background: #f9fafb; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; padding: 1rem 0.75rem; overflow-y: auto; }
.db-brand { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.5rem; margin-bottom: 1.5rem; }
.db-brand-logo { width: 24px; height: 24px; object-fit: contain; }
.db-brand-name { font-weight: 700; font-size: 0.95rem; color: #111827; }
.db-nav { display: flex; flex-direction: column; gap: 2px; }
.db-nav-item { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.75rem; border-radius: 6px; border: none; background: transparent; color: #374151; font-size: 0.875rem; font-weight: 500; cursor: pointer; text-align: left; width: 100%; transition: background 0.15s; }
.db-nav-item:hover { background: #f3f4f6; }
.db-nav-item-on { background: #eff6ff !important; color: #1d4ed8 !important; }
.db-nav-label { flex: 1; }
.db-nav-badge { background: #e5e7eb; color: #374151; font-size: 0.7rem; font-weight: 600; padding: 1px 7px; border-radius: 10px; min-width: 20px; text-align: center; }
.db-nav-item-on .db-nav-badge { background: #dbeafe; color: #1d4ed8; }
.db-nav-section-label { font-size: 0.68rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #9ca3af; padding: 0.75rem 0.75rem 0.25rem; margin-top: 0.5rem; }
.db-sidebar-bottom { margin-top: auto; display: flex; align-items: center; gap: 0.35rem; padding: 0.5rem 0.25rem; border-top: 1px solid #e5e7eb; margin-top: 1rem; padding-top: 0.75rem; }
.db-sync-btn { background: transparent; border: none; cursor: pointer; color: #6b7280; padding: 0.375rem; border-radius: 6px; display: flex; align-items: center; transition: color 0.15s, background 0.15s; }
.db-sync-btn:hover:not(:disabled) { color: #111827; background: #f3f4f6; }
.db-sync-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.db-sync-spinning svg { animation: dbSpin 1s linear infinite; }
@keyframes dbSpin { to { transform: rotate(360deg); } }
.db-settings-wrap { position: relative; }
.db-settings-btn { background: transparent; border: none; cursor: pointer; color: #6b7280; padding: 0.375rem; border-radius: 6px; display: flex; align-items: center; transition: color 0.15s, background 0.15s; }
.db-settings-btn:hover { color: #111827; background: #f3f4f6; }
.db-settings-overlay { position: fixed; inset: 0; z-index: 10; }
.db-settings-popup { position: absolute; bottom: calc(100% + 8px); left: 0; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.75rem; width: 220px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); z-index: 20; display: flex; flex-direction: column; gap: 0.4rem; }
.db-settings-email { font-size: 0.82rem; font-weight: 600; color: #111827; word-break: break-all; padding-bottom: 0.4rem; border-bottom: 1px solid #f3f4f6; }
.db-settings-sync { font-size: 0.75rem; color: #6b7280; }
.db-signout-btn { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.5rem; background: transparent; border: none; color: #ef4444; cursor: pointer; border-radius: 4px; font-size: 0.82rem; font-weight: 500; transition: background 0.15s; width: 100%; }
.db-signout-btn:hover { background: #fef2f2; }
.db-avatar { width: 28px; height: 28px; border-radius: 50%; background: #1d4ed8; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.68rem; font-weight: 700; margin-left: auto; cursor: default; flex-shrink: 0; }

/* ── Middle panel ── */
.db-list-col { width: 420px; min-width: 360px; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; background: #fff; overflow: hidden; }
.db-list-header { padding: 1.25rem 1.25rem 0.75rem; }
.db-greeting-title { font-size: 1.1rem; font-weight: 700; color: #111827; margin: 0 0 0.2rem; }
.db-greeting-sub { font-size: 0.825rem; color: #6b7280; margin: 0; }
.db-filters { display: flex; border-bottom: 1px solid #e5e7eb; padding: 0 1rem; overflow-x: auto; }
.db-filter-tab { padding: 0.625rem 0.75rem; background: transparent; border: none; border-bottom: 2px solid transparent; color: #6b7280; font-size: 0.82rem; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 0.35rem; transition: color 0.15s; white-space: nowrap; margin-bottom: -1px; flex-shrink: 0; }
.db-filter-tab:hover { color: #111827; }
.db-filter-tab-on { color: #1d4ed8 !important; border-bottom-color: #1d4ed8 !important; }
.db-filter-count { background: #e5e7eb; color: #374151; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 10px; }
.db-filter-tab-on .db-filter-count { background: #dbeafe; color: #1d4ed8; }
.db-thread-list { flex: 1; overflow-y: auto; }
.db-thread-row { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.875rem 1.25rem; border-bottom: 1px solid #f3f4f6; cursor: pointer; transition: background 0.1s; position: relative; }
.db-thread-row:hover { background: #f9fafb; }
.db-thread-row-on { background: #eff6ff !important; border-left: 3px solid #2563eb; padding-left: calc(1.25rem - 3px); }
.db-thread-row-unread .db-thread-subject { font-weight: 600; }
.db-urgency-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
.db-thread-icon { flex-shrink: 0; margin-top: 1px; line-height: 0; }
.db-thread-body { flex: 1; min-width: 0; }
.db-thread-top { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.3rem; }
.db-thread-subject { flex: 1; font-size: 0.875rem; color: #111827; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-thread-time { font-size: 0.73rem; color: #9ca3af; flex-shrink: 0; }
.db-thread-bottom { display: flex; align-items: center; gap: 0.5rem; flex-wrap: nowrap; }
.db-thread-sender { font-size: 0.78rem; color: #6b7280; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-badge { font-size: 0.67rem; font-weight: 700; padding: 1px 7px; border-radius: 4px; letter-spacing: 0.03em; flex-shrink: 0; }
.db-badge-urgent { background: #fef2f2; color: #dc2626; }
.db-badge-high   { background: #fff7ed; color: #c2410c; }
.db-badge-medium { background: #fefce8; color: #a16207; }
.db-badge-low    { background: #f3f4f6; color: #6b7280; }
.db-badge-sm { font-size: 0.62rem; margin-left: 0.4rem; padding: 1px 6px; }
.db-action-btn { padding: 2px 10px; border: 1px solid #d1d5db; border-radius: 5px; background: #fff; color: #374151; font-size: 0.75rem; font-weight: 500; cursor: pointer; flex-shrink: 0; transition: background 0.1s, border-color 0.1s; white-space: nowrap; }
.db-action-btn:hover { background: #f9fafb; border-color: #9ca3af; }
.db-loading-row { display: flex; align-items: center; justify-content: center; gap: 0.75rem; padding: 3rem 2rem; color: #6b7280; font-size: 0.875rem; }
.db-empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 300px; padding: 3rem 2rem; text-align: center; gap: 0.5rem; }
.db-empty-icon { font-size: 2rem; }
.db-empty-title { font-size: 1rem; font-weight: 600; color: #111827; }
.db-empty-sub { font-size: 0.825rem; color: #6b7280; max-width: 260px; line-height: 1.5; }
.db-spinner { display: inline-block; width: 18px; height: 18px; border: 2px solid #e5e7eb; border-top-color: #2563eb; border-radius: 50%; animation: dbSpin 0.7s linear infinite; flex-shrink: 0; }

/* ── Right panel ── */
.db-detail-col { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #fff; min-width: 0; }
.db-detail-empty { align-items: center; justify-content: center; gap: 0.75rem; color: #9ca3af; }
.db-detail-empty-icon { font-size: 2.5rem; }
.db-detail-empty-title { font-size: 0.9rem; }
.db-detail-header { padding: 1.25rem; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
.db-detail-title-row { display: flex; align-items: flex-start; gap: 0.75rem; }
.db-detail-icon { flex-shrink: 0; margin-top: 2px; line-height: 0; }
.db-detail-title-group { flex: 1; min-width: 0; }
.db-detail-subject { font-size: 0.95rem; font-weight: 600; color: #111827; display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.35rem; line-height: 1.4; }
.db-detail-meta { font-size: 0.8rem; color: #6b7280; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.db-detail-meta-email { color: #9ca3af; }
.db-detail-meta-time { color: #9ca3af; }
.db-gmail-link { color: #9ca3af; display: flex; align-items: center; flex-shrink: 0; padding: 0.3rem; border-radius: 4px; transition: color 0.15s; }
.db-gmail-link:hover { color: #1d4ed8; }
.db-detail-tabs { display: flex; border-bottom: 1px solid #e5e7eb; padding: 0 1.25rem; flex-shrink: 0; }
.db-detail-tab { padding: 0.625rem 1rem; background: transparent; border: none; border-bottom: 2px solid transparent; color: #6b7280; font-size: 0.82rem; font-weight: 500; cursor: pointer; transition: color 0.15s; margin-bottom: -1px; text-transform: capitalize; }
.db-detail-tab:hover { color: #111827; }
.db-detail-tab-on { color: #1d4ed8 !important; border-bottom-color: #1d4ed8 !important; }
.db-detail-body { flex: 1; overflow-y: auto; padding: 1.25rem; display: flex; flex-direction: column; gap: 1.25rem; }
.db-detail-loading { display: flex; align-items: center; gap: 0.75rem; color: #6b7280; font-size: 0.875rem; }
.db-detail-error { color: #dc2626; font-size: 0.875rem; padding: 1rem; background: #fef2f2; border-radius: 6px; }
.db-detail-section { display: flex; flex-direction: column; gap: 0.5rem; }
.db-detail-section-title { font-size: 0.82rem; font-weight: 600; color: #374151; }
.db-detail-section-title-row { display: flex; align-items: center; justify-content: space-between; }
.db-summary-text { font-size: 0.875rem; color: #374151; line-height: 1.65; max-height: 4.9em; overflow: hidden; transition: max-height 0.25s ease; }
.db-summary-expanded { max-height: 2000px; }
.db-summary-empty { font-size: 0.825rem; color: #9ca3af; font-style: italic; }
.db-show-more { background: none; border: none; color: #2563eb; font-size: 0.78rem; cursor: pointer; padding: 0; text-align: left; margin-top: 0.15rem; }
.db-action-items { display: flex; flex-direction: column; gap: 0.5rem; }
.db-action-item { display: flex; align-items: flex-start; gap: 0.6rem; cursor: pointer; font-size: 0.875rem; color: #374151; user-select: none; }
.db-cb { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid #d1d5db; background: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; transition: all 0.15s; }
.db-cb-on { border-color: #2563eb !important; background: #2563eb !important; }
.db-item-done { text-decoration: line-through; color: #9ca3af; }
.db-use-reply-btn { display: flex; align-items: center; gap: 0.35rem; padding: 4px 12px; background: #1d4ed8; color: #fff; border: none; border-radius: 5px; font-size: 0.78rem; font-weight: 500; cursor: pointer; transition: background 0.15s; flex-shrink: 0; }
.db-use-reply-btn:hover { background: #1e40af; }
.db-suggested-reply { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.75rem 1rem; font-size: 0.825rem; color: #374151; line-height: 1.65; white-space: pre-wrap; }
.db-email-tab { display: flex; flex-direction: column; gap: 1rem; }
.db-email-msg { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
.db-email-msg-header { display: flex; justify-content: space-between; align-items: center; padding: 0.625rem 0.875rem; background: #f9fafb; border-bottom: 1px solid #e5e7eb; gap: 0.5rem; }
.db-email-from { font-size: 0.82rem; font-weight: 600; color: #374151; }
.db-email-msg-time { font-size: 0.73rem; color: #9ca3af; flex-shrink: 0; }
.db-email-body { padding: 0.75rem 0.875rem; font-size: 0.825rem; color: #374151; line-height: 1.65; max-height: 240px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
.db-gmail-link-btn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.875rem; background: #fff; border: 1px solid #d1d5db; border-radius: 6px; color: #374151; font-size: 0.82rem; font-weight: 500; text-decoration: none; transition: background 0.15s; align-self: flex-start; }
.db-gmail-link-btn:hover { background: #f9fafb; }
.db-context-tab { display: flex; flex-direction: column; gap: 0.5rem; }
.db-edge-row { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.625rem 0.875rem; background: #f9fafb; border-radius: 6px; font-size: 0.82rem; border: 1px solid #f3f4f6; }
.db-edge-type { font-weight: 700; color: #1d4ed8; font-size: 0.7rem; letter-spacing: 0.06em; white-space: nowrap; flex-shrink: 0; margin-top: 1px; }
.db-edge-desc { color: #374151; line-height: 1.5; }

/* ── People / Projects views ── */
.db-secondary-view { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #fff; }
.db-view-header { padding: 1.25rem; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
.db-view-title { font-size: 1.1rem; font-weight: 700; color: #111827; margin: 0 0 0.25rem; }
.db-view-sub { font-size: 0.825rem; color: #6b7280; margin: 0; }
.db-view-body { flex: 1; overflow-y: auto; padding: 1.25rem; }
.db-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.875rem; }
.db-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; transition: border-color 0.15s; }
.db-card:hover { border-color: #d1d5db; }
.db-card-name { font-size: 0.9rem; font-weight: 600; color: #111827; margin-bottom: 0.25rem; }
.db-card-sub { font-size: 0.8rem; color: #6b7280; line-height: 1.4; }
.db-card-badge { display: inline-block; font-size: 0.7rem; font-weight: 500; padding: 2px 8px; background: #eff6ff; color: #1d4ed8; border-radius: 4px; margin-top: 0.5rem; }
.db-card-badge-green { background: #f0fdf4; color: #15803d; }
.db-view-empty { text-align: center; padding: 3rem; color: #9ca3af; font-size: 0.875rem; }
.db-view-loading { display: flex; align-items: center; justify-content: center; gap: 0.75rem; padding: 3rem; color: #6b7280; font-size: 0.875rem; }

/* ── Ask AI view ── */
.db-ai-shell { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.db-ai-header { padding: 1.25rem; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
.db-ai-title { font-size: 1.1rem; font-weight: 700; color: #111827; margin: 0 0 0.25rem; }
.db-ai-sub { font-size: 0.825rem; color: #6b7280; margin: 0; }
.db-ai-mode-row { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
.db-ai-mode-btn { padding: 4px 12px; border-radius: 5px; border: 1px solid #d1d5db; background: #fff; color: #374151; font-size: 0.78rem; font-weight: 500; cursor: pointer; transition: all 0.15s; }
.db-ai-mode-btn-on { background: #eff6ff; border-color: #2563eb; color: #1d4ed8; }
.db-ai-messages { flex: 1; overflow-y: auto; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.875rem; }
.db-ai-bubble { max-width: 78%; padding: 0.75rem 1rem; border-radius: 12px; font-size: 0.875rem; line-height: 1.65; word-break: break-word; }
.db-ai-bubble-user { background: #1d4ed8; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
.db-ai-bubble-ai { background: #f3f4f6; color: #111827; align-self: flex-start; border-bottom-left-radius: 4px; }
.db-ai-input-bar { padding: 1rem 1.25rem; border-top: 1px solid #e5e7eb; display: flex; gap: 0.75rem; flex-shrink: 0; }
.db-ai-input { flex: 1; padding: 0.625rem 0.875rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.875rem; color: #111827; background: #fff; outline: none; font-family: inherit; }
.db-ai-input:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.12); }
.db-ai-send { padding: 0.625rem 1.25rem; background: #1d4ed8; color: #fff; border: none; border-radius: 8px; font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: background 0.15s; flex-shrink: 0; }
.db-ai-send:hover:not(:disabled) { background: #1e40af; }
.db-ai-send:disabled { background: #93c5fd; cursor: not-allowed; }
.db-ai-typing { display: flex; align-items: center; gap: 4px; padding: 0.5rem 0; align-self: flex-start; }
.db-ai-typing span { width: 6px; height: 6px; background: #9ca3af; border-radius: 50%; animation: dbTypingDot 1.2s infinite; }
.db-ai-typing span:nth-child(2) { animation-delay: 0.2s; }
.db-ai-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes dbTypingDot { 0%,80%,100%{ transform:scale(0.7);opacity:0.5; } 40%{ transform:scale(1);opacity:1; } }
```

- [ ] **Step 2: Run build to confirm no syntax errors**

```bash
cd frontend && npm run build
```
Expected: `✓ built in X.XXs` with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(dashboard): add db-* CSS classes for three-column layout"
```

---

### Task 3: Create Sidebar.jsx

**Files:**
- Create: `frontend/src/Sidebar.jsx`

- [ ] **Step 1: Create `frontend/src/Sidebar.jsx` with this content**

```jsx
import React, { useState } from 'react';
import { RefreshCw, LogOut, Settings, Users, FolderOpen, Brain, CheckSquare } from 'lucide-react';

export default function Sidebar({ activeView, threadCounts, userSettings, syncing, session, onNavigate, onSync, onSignOut }) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fullName = session?.user?.user_metadata?.full_name || '';
  const initials = fullName
    ? fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : (session?.user?.email?.[0] || '?').toUpperCase();

  const NavItem = ({ view, icon, label, badge }) => (
    <button
      className={`db-nav-item${activeView === view ? ' db-nav-item-on' : ''}`}
      onClick={() => onNavigate(view)}
    >
      {icon}
      <span className="db-nav-label">{label}</span>
      {badge > 0 && <span className="db-nav-badge">{badge}</span>}
    </button>
  );

  return (
    <aside className="db-sidebar">
      {/* Brand */}
      <div className="db-brand">
        <img src="/icons/logo.png" alt="Tasker AI" className="db-brand-logo" />
        <span className="db-brand-name">Tasker AI</span>
      </div>

      {/* Main nav */}
      <nav className="db-nav">
        <NavItem view="tasks"    icon={<CheckSquare size={16}/>} label="Tasks"    badge={threadCounts.inbox} />
        <NavItem view="people"   icon={<Users size={16}/>}       label="People"   badge={0} />
        <NavItem view="projects" icon={<FolderOpen size={16}/>}  label="Projects" badge={0} />
      </nav>

      {/* AI Tools section */}
      <div className="db-nav-section-label">AI Tools</div>
      <nav className="db-nav">
        <NavItem view="askai" icon={<Brain size={16}/>} label="Ask AI" badge={0} />
      </nav>

      {/* Bottom row: sync + settings + avatar */}
      <div className="db-sidebar-bottom">
        <button
          className={`db-sync-btn${syncing ? ' db-sync-spinning' : ''}`}
          onClick={onSync}
          disabled={syncing}
          title={syncing ? 'Syncing...' : 'Sync Gmail'}
        >
          <RefreshCw size={15} />
        </button>

        <div className="db-settings-wrap">
          <button className="db-settings-btn" onClick={() => setSettingsOpen(o => !o)} title="Settings">
            <Settings size={15} />
          </button>

          {settingsOpen && (
            <>
              <div className="db-settings-overlay" onClick={() => setSettingsOpen(false)} />
              <div className="db-settings-popup">
                <div className="db-settings-email">
                  {userSettings?.gmail_email || session?.user?.email || 'Unknown'}
                </div>
                {userSettings?.last_synced_at && (
                  <div className="db-settings-sync">
                    Last synced:{' '}
                    {new Date(userSettings.last_synced_at).toLocaleTimeString([], {
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                )}
                <button
                  className="db-signout-btn"
                  onClick={() => { setSettingsOpen(false); onSignOut(); }}
                >
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            </>
          )}
        </div>

        <div className="db-avatar" title={session?.user?.email}>{initials}</div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Run build**

```bash
cd frontend && npm run build
```
Expected: `✓ built in X.XXs` — Sidebar.jsx is not yet imported anywhere so this just confirms syntax is clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Sidebar.jsx
git commit -m "feat(dashboard): add Sidebar navigation component"
```

---

### Task 4: Create TaskList.jsx

**Files:**
- Create: `frontend/src/TaskList.jsx`

- [ ] **Step 1: Create `frontend/src/TaskList.jsx` with this content**

```jsx
import React, { useRef, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';

// Inline Gmail icon — no external dependency
const GmailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75L35 40h7c1.657 0 3-1.343 3-3V16.2z"/>
    <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6c-1.657 0-3-1.343-3-3V16.2z"/>
    <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,30.45 35,23.7 36,17"/>
    <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859C9.132 8.203 8.228 7.837 7.258 7.837 4.908 7.837 3 9.745 3 12.298z"/>
    <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341C39.868 8.203 40.772 7.837 41.742 7.837 44.092 7.837 45 9.745 45 12.298z"/>
  </svg>
);

const URGENCY_DOT   = { URGENT: '#ef4444', HIGH: '#f97316', MEDIUM: '#eab308', LOW: '#d1d5db' };
const URGENCY_CLASS = { URGENT: 'db-badge-urgent', HIGH: 'db-badge-high', MEDIUM: 'db-badge-medium', LOW: 'db-badge-low' };
const ACTION_LABEL  = { reply: 'Reply', approve: 'Approve', review: 'Review', join: 'Join', view: 'View' };

const FILTERS = [
  { key: 'all',       label: 'All' },
  { key: 'important', label: 'Priority' },
  { key: 'action',    label: 'Action' },
  { key: 'unread',    label: 'Unread' },
];

function timeAgo(iso) {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: false })
      .replace('about ', '')
      .replace(' minutes', 'm').replace(' minute', 'm')
      .replace(' hours', 'h').replace(' hour', 'h')
      .replace(' days', 'd').replace(' day', 'd');
  } catch { return ''; }
}

export default function TaskList({
  threads, loading, selectedThread, activeFilter,
  onSelectThread, onFilterChange, onLoadMore, session,
}) {
  const listRef = useRef(null);

  const firstName =
    session?.user?.user_metadata?.full_name?.split(' ')?.[0] ||
    session?.user?.email?.split('@')?.[0] ||
    'there';

  // Derived counts from loaded threads (no extra query)
  const counts = {
    all:       threads.length,
    important: threads.filter(t => t.urgency === 'URGENT' || t.urgency === 'HIGH').length,
    action:    threads.filter(t => ['reply','approve','review','join'].includes(t.action_type)).length,
    unread:    threads.filter(t => !t.is_read).length,
  };

  // Infinite scroll: load more when near bottom
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        onLoadMore();
      }
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [onLoadMore]);

  return (
    <div className="db-list-col">
      {/* Header */}
      <div className="db-list-header">
        <h2 className="db-greeting-title">Good morning, {firstName} 👋</h2>
        <p className="db-greeting-sub">Here's what needs your attention today.</p>
      </div>

      {/* Filter tabs */}
      <div className="db-filters">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`db-filter-tab${activeFilter === f.key ? ' db-filter-tab-on' : ''}`}
            onClick={() => onFilterChange(f.key)}
          >
            {f.label}
            {counts[f.key] > 0 && (
              <span className="db-filter-count">{counts[f.key]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Thread rows */}
      <div className="db-thread-list" ref={listRef}>
        {loading ? (
          <div className="db-loading-row">
            <span className="db-spinner" />
            <span>Loading your inbox...</span>
          </div>
        ) : threads.length === 0 ? (
          <div className="db-empty-state">
            <div className="db-empty-icon">🎉</div>
            <div className="db-empty-title">You're all caught up!</div>
            <div className="db-empty-sub">We'll notify you when something important comes in.</div>
          </div>
        ) : (
          threads.map(t => (
            <div
              key={t.id}
              className={[
                'db-thread-row',
                selectedThread?.id === t.id ? 'db-thread-row-on' : '',
                !t.is_read ? 'db-thread-row-unread' : '',
              ].join(' ').trim()}
              onClick={() => onSelectThread(t)}
            >
              <span
                className="db-urgency-dot"
                style={{ background: URGENCY_DOT[t.urgency] || URGENCY_DOT.LOW }}
              />
              <div className="db-thread-icon"><GmailIcon /></div>
              <div className="db-thread-body">
                <div className="db-thread-top">
                  <span className="db-thread-subject">{t.subject || '(no subject)'}</span>
                  <span className="db-thread-time">{timeAgo(t.created_at)}</span>
                </div>
                <div className="db-thread-bottom">
                  <span className="db-thread-sender">{t.sender_name || 'Unknown'}</span>
                  {t.urgency && t.urgency !== 'LOW' && (
                    <span className={`db-badge ${URGENCY_CLASS[t.urgency] || ''}`}>
                      {t.urgency}
                    </span>
                  )}
                  <button
                    className="db-action-btn"
                    onClick={e => { e.stopPropagation(); onSelectThread(t); }}
                  >
                    {ACTION_LABEL[t.action_type] || 'View'}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run build**

```bash
cd frontend && npm run build
```
Expected: `✓ built in X.XXs`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/TaskList.jsx
git commit -m "feat(dashboard): add TaskList middle-panel component"
```

---

### Task 5: Create TaskDetail.jsx

**Files:**
- Create: `frontend/src/TaskDetail.jsx`

- [ ] **Step 1: Create `frontend/src/TaskDetail.jsx` with this content**

```jsx
import React, { useState, useEffect } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';

const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const URGENCY_CLASS = { URGENT: 'db-badge-urgent', HIGH: 'db-badge-high', MEDIUM: 'db-badge-medium', LOW: 'db-badge-low' };

const GmailIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75L35 40h7c1.657 0 3-1.343 3-3V16.2z"/>
    <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6c-1.657 0-3-1.343-3-3V16.2z"/>
    <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,30.45 35,23.7 36,17"/>
    <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859C9.132 8.203 8.228 7.837 7.258 7.837 4.908 7.837 3 9.745 3 12.298z"/>
    <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341C39.868 8.203 40.772 7.837 41.742 7.837 44.092 7.837 45 9.745 45 12.298z"/>
  </svg>
);

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Normalise action_items: Supabase JSONB may return string[] or {text:string}[]
function normaliseItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => (typeof item === 'string' ? item : item?.text || JSON.stringify(item)));
}

const TABS = ['summary', 'email', 'context'];

export default function TaskDetail({ thread, session, supabase }) {
  const [detail, setDetail]               = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError]     = useState(null);
  const [activeTab, setActiveTab]         = useState('summary');
  const [expanded, setExpanded]           = useState(false);
  const [copied, setCopied]               = useState(false);
  const [checked, setChecked]             = useState({});

  useEffect(() => {
    if (!thread?.id) { setDetail(null); return; }
    setDetailLoading(true);
    setDetailError(null);
    setActiveTab('summary');
    setExpanded(false);
    setChecked({});

    supabase.functions.invoke('api/thread-detail', {
      body: { thread_id: thread.id },
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
    }).then(({ data, error }) => {
      if (error) throw error;
      setDetail(data);
    }).catch(e => {
      console.error('[TaskDetail] fetch error:', e);
      setDetailError('Could not load thread details. Please try again.');
    }).finally(() => setDetailLoading(false));
  }, [thread?.id]);

  const handleCopy = () => {
    const reply = detail?.thread?.suggested_reply;
    if (!reply) return;
    navigator.clipboard.writeText(reply).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Empty state
  if (!thread) {
    return (
      <div className="db-detail-col db-detail-empty">
        <div className="db-detail-empty-icon">📬</div>
        <div className="db-detail-empty-title">Select a thread to view details</div>
      </div>
    );
  }

  // Merge thread-list data with fully-fetched detail (detail wins)
  const t          = detail?.thread || thread;
  const actionItems = normaliseItems(t.action_items);
  const emails      = detail?.emails || [];
  const edges       = detail?.context?.edges || [];

  return (
    <div className="db-detail-col">
      {/* ── Header ── */}
      <div className="db-detail-header">
        <div className="db-detail-title-row">
          <div className="db-detail-icon"><GmailIcon size={20} /></div>
          <div className="db-detail-title-group">
            <div className="db-detail-subject">
              {t.subject || '(no subject)'}
              {t.urgency && t.urgency !== 'LOW' && (
                <span className={`db-badge db-badge-sm ${URGENCY_CLASS[t.urgency] || ''}`}>
                  {t.urgency}
                </span>
              )}
            </div>
            <div className="db-detail-meta">
              <span>{t.sender_name || 'Unknown'}</span>
              {t.sender_email && (
                <span className="db-detail-meta-email">· {t.sender_email}</span>
              )}
              <span className="db-detail-meta-time">{timeAgo(t.created_at)}</span>
            </div>
          </div>
          {t.gmail_url && (
            <a
              href={t.gmail_url}
              target="_blank"
              rel="noopener noreferrer"
              className="db-gmail-link"
              title="Open in Gmail"
            >
              <ExternalLink size={15} />
            </a>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="db-detail-tabs">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`db-detail-tab${activeTab === tab ? ' db-detail-tab-on' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      <div className="db-detail-body">
        {detailLoading ? (
          <div className="db-detail-loading">
            <span className="db-spinner" /> Loading thread details...
          </div>
        ) : detailError ? (
          <div className="db-detail-error">{detailError}</div>
        ) : activeTab === 'summary' ? (
          <>
            {/* AI Summary */}
            <div className="db-detail-section">
              <div className="db-detail-section-title">✦ AI Summary</div>
              {t.ai_summary ? (
                <>
                  <div className={`db-summary-text${expanded ? ' db-summary-expanded' : ''}`}>
                    {t.ai_summary}
                  </div>
                  {t.ai_summary.length > 200 && (
                    <button className="db-show-more" onClick={() => setExpanded(e => !e)}>
                      {expanded ? 'Show less ↑' : 'Show more ↓'}
                    </button>
                  )}
                </>
              ) : (
                <div className="db-summary-empty">Summary not yet generated.</div>
              )}
            </div>

            {/* Action Items */}
            <div className="db-detail-section">
              <div className="db-detail-section-title">Action Items</div>
              {actionItems.length === 0 ? (
                <div className="db-summary-empty">No action items extracted.</div>
              ) : (
                <div className="db-action-items">
                  {actionItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="db-action-item"
                      onClick={() => setChecked(prev => ({ ...prev, [idx]: !prev[idx] }))}
                    >
                      <div className={`db-cb${checked[idx] ? ' db-cb-on' : ''}`}>
                        {checked[idx] && (
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8"
                              strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <span className={checked[idx] ? 'db-item-done' : ''}>{item}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Suggested Reply */}
            {t.suggested_reply && (
              <div className="db-detail-section">
                <div className="db-detail-section-title-row">
                  <span className="db-detail-section-title">✦ Suggested Reply</span>
                  <button className="db-use-reply-btn" onClick={handleCopy}>
                    {copied
                      ? <><Check size={13}/> Copied!</>
                      : <><Copy size={13}/> Use Reply</>}
                  </button>
                </div>
                <div className="db-suggested-reply">{t.suggested_reply}</div>
              </div>
            )}
          </>
        ) : activeTab === 'email' ? (
          <div className="db-email-tab">
            {emails.length === 0 ? (
              <div className="db-summary-empty">No email content stored yet.</div>
            ) : (
              emails.map((email, idx) => (
                <div key={idx} className="db-email-msg">
                  <div className="db-email-msg-header">
                    <span className="db-email-from">
                      {email.sender_name || email.sender_email || 'Unknown'}
                    </span>
                    <span className="db-email-msg-time">
                      {email.received_at
                        ? new Date(email.received_at).toLocaleString([], {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })
                        : ''}
                    </span>
                  </div>
                  <div className="db-email-body">{email.body || '(no body)'}</div>
                </div>
              ))
            )}
            {t.gmail_url && (
              <a href={t.gmail_url} target="_blank" rel="noopener noreferrer" className="db-gmail-link-btn">
                Open in Gmail <ExternalLink size={13} />
              </a>
            )}
          </div>
        ) : (
          /* Context tab */
          <div className="db-context-tab">
            {edges.length === 0 ? (
              <div className="db-summary-empty">No context graph data available.</div>
            ) : (
              edges.map((edge, idx) => (
                <div key={idx} className="db-edge-row">
                  <span className="db-edge-type">{edge.relationship_type}</span>
                  <span className="db-edge-desc">{edge.description}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run build**

```bash
cd frontend && npm run build
```
Expected: `✓ built in X.XXs`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/TaskDetail.jsx
git commit -m "feat(dashboard): add TaskDetail right-panel component"
```

---

### Task 6: Create PeopleView.jsx

**Files:**
- Create: `frontend/src/PeopleView.jsx`

- [ ] **Step 1: Create `frontend/src/PeopleView.jsx` with this content**

```jsx
import React, { useState, useEffect } from 'react';

export default function PeopleView({ supabase, session }) {
  const [contacts, setContacts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    supabase
      .from('contacts')
      .select('id, name, email, organization, bio_summary')
      .order('name', { ascending: true })
      .then(({ data }) => {
        setContacts(data || []);
        setLoading(false);
      });
  }, [session]);

  const filtered = contacts.filter(c =>
    !search ||
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.organization?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="db-secondary-view">
      <div className="db-view-header">
        <h2 className="db-view-title">People</h2>
        <p className="db-view-sub">Contacts extracted from your Gmail threads.</p>
        <input
          style={{
            marginTop: '0.75rem', width: '100%', padding: '0.5rem 0.75rem',
            border: '1px solid #d1d5db', borderRadius: '6px',
            fontSize: '0.875rem', color: '#111827', outline: 'none',
            fontFamily: 'inherit',
          }}
          placeholder="Search by name, email, or organisation…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="db-view-body">
        {loading ? (
          <div className="db-view-loading">
            <span className="db-spinner" /> Loading contacts…
          </div>
        ) : filtered.length === 0 ? (
          <div className="db-view-empty">
            {search ? 'No contacts match your search.' : 'No contacts yet — sync your Gmail to build the graph.'}
          </div>
        ) : (
          <div className="db-card-grid">
            {filtered.map(c => (
              <div key={c.id} className="db-card">
                <div className="db-card-name">{c.name || c.email}</div>
                {c.email && <div className="db-card-sub">{c.email}</div>}
                {c.organization && (
                  <span className="db-card-badge">{c.organization}</span>
                )}
                {c.bio_summary && (
                  <div className="db-card-sub" style={{ marginTop: '0.5rem', fontSize: '0.76rem' }}>
                    {c.bio_summary.slice(0, 100)}{c.bio_summary.length > 100 ? '…' : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run build**

```bash
cd frontend && npm run build
```
Expected: `✓ built in X.XXs`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/PeopleView.jsx
git commit -m "feat(dashboard): add PeopleView contacts component"
```

---

### Task 7: Create ProjectsView.jsx

**Files:**
- Create: `frontend/src/ProjectsView.jsx`

- [ ] **Step 1: Create `frontend/src/ProjectsView.jsx` with this content**

```jsx
import React, { useState, useEffect } from 'react';

export default function ProjectsView({ supabase, session }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    supabase
      .from('projects')
      .select('id, name, description, status')
      .order('name', { ascending: true })
      .then(({ data }) => {
        setProjects(data || []);
        setLoading(false);
      });
  }, [session]);

  return (
    <div className="db-secondary-view">
      <div className="db-view-header">
        <h2 className="db-view-title">Projects</h2>
        <p className="db-view-sub">Focus areas extracted from your email graph.</p>
      </div>

      <div className="db-view-body">
        {loading ? (
          <div className="db-view-loading">
            <span className="db-spinner" /> Loading projects…
          </div>
        ) : projects.length === 0 ? (
          <div className="db-view-empty">
            No projects yet — sync your Gmail to build the graph.
          </div>
        ) : (
          <div className="db-card-grid">
            {projects.map(p => (
              <div key={p.id} className="db-card">
                <div className="db-card-name">{p.name}</div>
                {p.description && (
                  <div className="db-card-sub">
                    {p.description.slice(0, 120)}{p.description.length > 120 ? '…' : ''}
                  </div>
                )}
                {p.status && (
                  <span className={`db-card-badge${p.status === 'active' ? ' db-card-badge-green' : ''}`}>
                    {p.status}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run build**

```bash
cd frontend && npm run build
```
Expected: `✓ built in X.XXs`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/ProjectsView.jsx
git commit -m "feat(dashboard): add ProjectsView component"
```

---

### Task 8: Create AskAIView.jsx

**Files:**
- Create: `frontend/src/AskAIView.jsx`

- [ ] **Step 1: Create `frontend/src/AskAIView.jsx` with this content**

```jsx
import React, { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export default function AskAIView({ supabase, session }) {
  const [messages, setMessages] = useState([
    { sender: 'ai', text: 'Hi! Ask me anything about your emails, contacts, or projects. I use your email graph to answer.' },
  ]);
  const [input, setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode]     = useState('local'); // 'local' | 'global'
  const chatRef             = useRef(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(prev => [...prev, { sender: 'user', text }]);
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('query', {
        body: { query: text, mode },
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (error) throw error;
      setMessages(prev => [...prev, {
        sender: 'ai',
        text: data?.answer || 'No response received.',
      }]);
    } catch (e) {
      console.error('[AskAI] query error:', e);
      setMessages(prev => [...prev, {
        sender: 'ai',
        text: 'Sorry, something went wrong. Please try again.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="db-ai-shell">
      <div className="db-ai-header">
        <h2 className="db-ai-title">Ask AI</h2>
        <p className="db-ai-sub">Graph-powered answers from your email knowledge base.</p>
        <div className="db-ai-mode-row">
          <button
            className={`db-ai-mode-btn${mode === 'local' ? ' db-ai-mode-btn-on' : ''}`}
            onClick={() => setMode('local')}
          >
            Local search
          </button>
          <button
            className={`db-ai-mode-btn${mode === 'global' ? ' db-ai-mode-btn-on' : ''}`}
            onClick={() => setMode('global')}
          >
            Global search
          </button>
        </div>
      </div>

      <div className="db-ai-messages" ref={chatRef}>
        {messages.map((m, i) => (
          <div key={i} className={`db-ai-bubble db-ai-bubble-${m.sender}`}>
            {m.text}
          </div>
        ))}
        {loading && (
          <div className="db-ai-typing">
            <span/><span/><span/>
          </div>
        )}
      </div>

      <div className="db-ai-input-bar">
        <input
          className="db-ai-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Ask about your emails, contacts, deadlines…"
          disabled={loading}
        />
        <button
          className="db-ai-send"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run build**

```bash
cd frontend && npm run build
```
Expected: `✓ built in X.XXs`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/AskAIView.jsx
git commit -m "feat(dashboard): add AskAIView Graph RAG chat component"
```

---

### Task 9: Create Dashboard.jsx

**Files:**
- Create: `frontend/src/Dashboard.jsx`

- [ ] **Step 1: Create `frontend/src/Dashboard.jsx` with this content**

```jsx
import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './Sidebar';
import TaskList from './TaskList';
import TaskDetail from './TaskDetail';
import PeopleView from './PeopleView';
import ProjectsView from './ProjectsView';
import AskAIView from './AskAIView';

const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export default function Dashboard({ session, supabase, wizardStep, onSignOut }) {
  const [threads, setThreads]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [activeView, setActiveView]     = useState('tasks');
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedThread, setSelectedThread] = useState(null);
  const [nextOffset, setNextOffset]     = useState(0);
  const [userSettings, setUserSettings] = useState(null);
  const [syncing, setSyncing]           = useState(false);
  const debounceRef                     = useRef(null);
  // Guard against parallel fetchThreads calls causing race conditions
  const fetchingRef                     = useRef(false);

  // ── Fetch threads from api/feed ──
  const fetchThreads = async (filter = 'all', offset = 0, append = false) => {
    if (!session) return;
    if (fetchingRef.current && offset === 0) return; // Debounce overlapping resets
    fetchingRef.current = true;
    if (offset === 0 && !append) setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('api/feed', {
        body: { filter, limit: 20, offset },
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (error) throw error;
      const incoming = data?.threads || [];
      setThreads(prev => append ? [...prev, ...incoming] : incoming);
      setNextOffset(data?.nextOffset ?? 0);
    } catch (e) {
      console.error('[Dashboard] fetchThreads error:', e);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  };

  // ── Fetch user settings (sync timestamp, gmail_email) ──
  const fetchSettings = async () => {
    if (!session) return;
    const { data } = await supabase
      .from('user_settings')
      .select('last_synced_at, gmail_email, last_sync_error')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (data) setUserSettings(data);
  };

  // ── Initial load ──
  useEffect(() => {
    fetchThreads('all', 0);
    fetchSettings();
  }, [session]);

  // ── Re-fetch when wizard closes (onboarding just completed) ──
  useEffect(() => {
    if (wizardStep === null) {
      fetchThreads(activeFilter, 0);
    }
  }, [wizardStep]);

  // ── Realtime: threads table changes → debounced re-fetch ──
  useEffect(() => {
    if (!supabase || !session) return;
    const channel = supabase
      .channel('db-threads-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'threads' }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchThreads(activeFilter, 0), 800);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [session, activeFilter]);

  // ── Filter change (clears selection, resets to page 0) ──
  const handleFilterChange = (filter) => {
    setActiveFilter(filter);
    setSelectedThread(null);
    fetchThreads(filter, 0);
  };

  // ── Infinite scroll load-more ──
  const handleLoadMore = () => {
    if (nextOffset > 0 && !fetchingRef.current) {
      fetchThreads(activeFilter, nextOffset, true);
    }
  };

  // ── Manual sync (delegates to sync edge function) ──
  const handleManualSync = async () => {
    if (syncing || !session) return;
    setSyncing(true);
    try {
      await supabase.functions.invoke('sync', {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
    } catch (e) {
      console.error('[Dashboard] sync error:', e);
    } finally {
      setSyncing(false);
      fetchSettings();
      fetchThreads(activeFilter, 0);
    }
  };

  // ── Sidebar badge counts (derived — no extra queries) ──
  const threadCounts = {
    inbox:    threads.length,
    priority: threads.filter(t => t.urgency === 'URGENT' || t.urgency === 'HIGH').length,
    unread:   threads.filter(t => !t.is_read).length,
  };

  // ── Main content area: switches by activeView ──
  const renderContent = () => {
    switch (activeView) {
      case 'people':
        return <PeopleView supabase={supabase} session={session} />;
      case 'projects':
        return <ProjectsView supabase={supabase} session={session} />;
      case 'askai':
        return <AskAIView supabase={supabase} session={session} />;
      default: // 'tasks'
        return (
          <>
            <TaskList
              threads={threads}
              loading={loading}
              selectedThread={selectedThread}
              activeFilter={activeFilter}
              onSelectThread={setSelectedThread}
              onFilterChange={handleFilterChange}
              onLoadMore={handleLoadMore}
              session={session}
            />
            <TaskDetail
              thread={selectedThread}
              session={session}
              supabase={supabase}
            />
          </>
        );
    }
  };

  return (
    <div className="db-shell">
      <Sidebar
        activeView={activeView}
        threadCounts={threadCounts}
        userSettings={userSettings}
        syncing={syncing}
        session={session}
        onNavigate={(view) => { setActiveView(view); setSelectedThread(null); }}
        onSync={handleManualSync}
        onSignOut={onSignOut}
      />
      <div className="db-main">
        {renderContent()}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run build**

```bash
cd frontend && npm run build
```
Expected: `✓ built in X.XXs` — Dashboard is not yet imported anywhere so this only confirms syntax.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Dashboard.jsx
git commit -m "feat(dashboard): add Dashboard layout shell and state orchestration"
```

---

### Task 10: Refactor App.jsx to shell + wire Dashboard

**Files:**
- Modify: `frontend/src/App.jsx` (replace entire file)

**What this task does:** Remove all task/graph/directory rendering and state. Keep only session management, wizard state + handlers, and route between `<Auth>` and `<Dashboard>`.

- [ ] **Step 1: Replace the entire content of `frontend/src/App.jsx` with the following**

```jsx
import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import Auth from './Auth';
import Dashboard from './Dashboard';
import './index.css';

// ── Supabase client (singleton) ──
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

export default function App() {
  const [session, setSession]   = useState(null);
  const [loading, setLoading]   = useState(true);

  // ── Wizard state ── (stays here because the wizard overlay renders above <Dashboard>)
  const [wizardStep, setWizardStep] = useState(null); // null | 2 | 3 | 4 | 'progress'
  const [wizardFlags, setWizardFlags] = useState({
    lookbackDays: 30,
    trackingPrefs: ['tasks', 'deadlines', 'people', 'projects'],
    gmailLabels: ['IMPORTANT', 'INBOX'],
    customLabelIds: [],
    otherText: '',
    useCustomLabels: false,
  });
  const [availableLabels, setAvailableLabels] = useState([]);
  const [labelsLoading, setLabelsLoading]     = useState(false);
  const [onboardingProgress, setOnboardingProgress] = useState({
    threads_total: 0, threads_done: 0, eta_seconds: 0, queue_position: 0,
  });
  const [syncing, setSyncing] = useState(false); // wizard's "Start Syncing" spinner only

  const sessionRef              = React.useRef(null);
  const initialSyncDoneRef      = React.useRef(false);
  const onboardingTriggeredRef  = React.useRef(false);
  const onboardingPollRef       = React.useRef(null);
  const providerTokenRef        = React.useRef(null);

  // ── Session management ──
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      sessionRef.current = sess;
      setSession(sess);
      setLoading(false);
      if (sess) checkSyncHealth(sess);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      sessionRef.current = newSession;
      setSession(newSession);
      if (newSession) {
        if (_event === 'SIGNED_IN' && newSession.provider_token) {
          bootstrapUser(newSession);
        }
      } else {
        setWizardStep(null);
        initialSyncDoneRef.current = false;
        onboardingTriggeredRef.current = false;
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── checkSyncHealth: runs once on restore to catch in-progress onboarding ──
  const checkSyncHealth = async (sess) => {
    if (initialSyncDoneRef.current || !sess) return;
    initialSyncDoneRef.current = true;

    const { data: settings } = await supabase
      .from('user_settings')
      .select('user_profile, last_synced_at, onboarding_status, onboarding_progress')
      .eq('user_id', sess.user.id)
      .maybeSingle();

    if (settings?.onboarding_status === 'queued' || settings?.onboarding_status === 'processing') {
      if (settings.onboarding_progress) setOnboardingProgress(settings.onboarding_progress);
      setWizardStep('progress');
      startOnboardingPolling(sess);
      return;
    }

    const DEFAULT_PROFILE = "A busy professional seeking to organize their schedule, extract actionable tasks from communications, and manage deadlines efficiently.";
    if (!settings || !settings.user_profile || settings.user_profile === DEFAULT_PROFILE) {
      if (sess?.provider_token && !providerTokenRef.current?.providerToken) {
        providerTokenRef.current = {
          providerToken: sess.provider_token,
          providerRefreshToken: sess.provider_refresh_token,
        };
      }
      setWizardStep(2);
    }
  };

  // ── bootstrapUser: called only on true first SIGNED_IN with fresh provider_token ──
  const bootstrapUser = async (sess) => {
    if (onboardingTriggeredRef.current) return;
    onboardingTriggeredRef.current = true;
    providerTokenRef.current = {
      providerToken: sess?.provider_token,
      providerRefreshToken: sess?.provider_refresh_token,
    };
    setWizardStep(2);
    // Dashboard handles its own data fetching on mount
  };

  // ── fetchAvailableLabels: populates the Step 4 label picker ──
  const fetchAvailableLabels = async () => {
    setLabelsLoading(true);
    try {
      const sess = sessionRef.current;
      const { data, error } = await supabase.functions.invoke('labels', {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${sess.access_token}` },
      });
      if (!error && data?.labels) setAvailableLabels(data.labels);
    } catch (e) {
      console.error('[LABELS] fetch error:', e);
    }
    setLabelsLoading(false);
  };

  // ── startOnboardingPolling: polls user_settings every 10s until onboarding complete ──
  const startOnboardingPolling = (sess) => {
    if (onboardingPollRef.current) clearInterval(onboardingPollRef.current);
    onboardingPollRef.current = setInterval(async () => {
      const activeSess = sess || sessionRef.current;
      if (!activeSess) return;
      try {
        const { data: settings } = await supabase
          .from('user_settings')
          .select('onboarding_status, onboarding_progress')
          .eq('user_id', activeSess.user.id)
          .maybeSingle();
        if (settings?.onboarding_progress) setOnboardingProgress(settings.onboarding_progress);
        if (settings?.onboarding_status === 'complete') {
          clearInterval(onboardingPollRef.current);
          onboardingPollRef.current = null;
          setWizardStep(null); // Dashboard re-fetches threads via its wizardStep dep
        }
      } catch (e) {
        console.error('[POLL] onboarding_status error:', e);
      }
    }, 10000);
  };

  // ── handleWizardComplete: triggers bootstrap sync from wizard Step 4 ──
  const handleWizardComplete = async () => {
    const sess = sessionRef.current;
    if (!sess) return;
    setSyncing(true);
    try {
      const effective = wizardFlags.lookbackDays === -1
        ? (wizardFlags.customDays || 60)
        : wizardFlags.lookbackDays;

      const { data, error } = await supabase.functions.invoke('sync', {
        body: {
          ...(providerTokenRef.current || {}),
          sync_flags: {
            lookback_days: effective,
            tracking_preferences: [
              ...wizardFlags.trackingPrefs,
              ...(wizardFlags.otherText.trim() ? [wizardFlags.otherText.trim()] : []),
            ],
            gmail_labels: wizardFlags.gmailLabels,
            custom_label_ids: wizardFlags.customLabelIds,
          },
          bootstrap_only: true,
        },
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${sess.access_token}` },
      });
      if (error) throw error;
      setOnboardingProgress({
        threads_total: 0, threads_done: 0,
        eta_seconds: data?.estimated_total_seconds || 300,
        queue_position: data?.queue_position || 0,
      });
      setWizardStep('progress');
      startOnboardingPolling(sess);
    } catch (e) {
      console.error('[WIZARD] handleWizardComplete error:', e);
    } finally {
      setSyncing(false);
    }
  };

  // ── Render ──
  if (!supabase) {
    return (
      <div style={{ padding: '2rem', color: '#dc2626', fontFamily: 'sans-serif' }}>
        <strong>Configuration error:</strong> Missing{' '}
        <code>VITE_SUPABASE_URL</code> or <code>VITE_SUPABASE_ANON_KEY</code>{' '}
        in <code>frontend/.env</code>.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fff' }}>
        <span className="db-spinner" />
      </div>
    );
  }

  if (!session) return <Auth supabase={supabase} />;

  return (
    <>
      <Dashboard
        session={session}
        supabase={supabase}
        wizardStep={wizardStep}
        onSignOut={() => supabase.auth.signOut()}
      />

      {/* ═══ ONBOARDING WIZARD (New Users) — fixed overlay above Dashboard ═══ */}
      {wizardStep !== null && (
        <div className="wz-page">

          {/* Top bar */}
          <div className="wz-topbar">
            <div className="wz-brand">
              <img src="/icons/logo.png" alt="Tasker AI" className="wz-logo"/>
              <span className="wz-brand-name">Tasker AI</span>
            </div>
            {wizardStep !== 'progress' && (
              <span className="wz-step-label">Step {wizardStep - 1} of 3</span>
            )}
          </div>

          {/* Step dots */}
          {wizardStep !== 'progress' && (
            <div className="wz-dots">
              <div className={`wz-dot${wizardStep >= 2 ? ' wz-dot-on' : ''}`}/>
              <div className={`wz-dot${wizardStep >= 3 ? ' wz-dot-on' : ''}`}/>
              <div className={`wz-dot${wizardStep >= 4 ? ' wz-dot-on' : ''}`}/>
            </div>
          )}

          {/* Body */}
          <div className="wz-body">

            {/* ── STEP 2: Time range ── */}
            {wizardStep === 2 && (
              <div>
                <h2 className="wz-title">How far back should we look?</h2>
                <p className="wz-subtitle">We'll fetch emails from this period to extract your tasks and deadlines.</p>
                <div className="wz-grid-2">
                  {[{ label: '7 days', value: 7 }, { label: '30 days', value: 30 }, { label: '90 days', value: 90 }, { label: 'Custom', value: -1 }].map(({ label, value }) => {
                    const sel = wizardFlags.lookbackDays === value;
                    return (
                      <button
                        key={value}
                        className={`wz-tile${sel ? ' wz-tile-on' : ''}`}
                        onClick={() => setWizardFlags(f => ({ ...f, lookbackDays: value }))}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {wizardFlags.lookbackDays === -1 && (
                  <div className="wz-custom-row">
                    <input
                      type="number" min={1} max={365} placeholder="60" defaultValue={60}
                      className="wz-input wz-input-sm"
                      onChange={e => setWizardFlags(f => ({ ...f, customDays: parseInt(e.target.value) || 60 }))}
                    />
                    <span className="wz-custom-label">days back</span>
                  </div>
                )}
                <div className="wz-nav">
                  <button className="wz-next-btn" onClick={() => setWizardStep(3)}>Continue</button>
                </div>
              </div>
            )}

            {/* ── STEP 3: Tracking preferences ── */}
            {wizardStep === 3 && (
              <div>
                <h2 className="wz-title">What matters to you?</h2>
                <p className="wz-subtitle">We'll focus on these areas when extracting insights from your inbox.</p>
                <div className="wz-option-list">
                  {[
                    { id: 'tasks',     label: 'Tasks & Action Items',    desc: 'Things you need to do or follow up on' },
                    { id: 'deadlines', label: 'Deadlines & Commitments', desc: 'Dates, due dates, and time-sensitive items' },
                    { id: 'people',    label: 'People & Follow-ups',     desc: 'Contacts you need to get back to' },
                    { id: 'projects',  label: 'Projects & Threads',      desc: 'Ongoing work and multi-email conversations' },
                  ].map(({ id, label, desc }) => {
                    const checked = wizardFlags.trackingPrefs.includes(id);
                    return (
                      <label key={id} className={`wz-option${checked ? ' wz-option-on' : ''}`}>
                        <div className={`wz-cb${checked ? ' wz-cb-on' : ''}`}>
                          {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <input type="checkbox" checked={checked} onChange={() =>
                          setWizardFlags(f => ({ ...f, trackingPrefs: checked ? f.trackingPrefs.filter(p => p !== id) : [...f.trackingPrefs, id] }))
                        } style={{ display: 'none' }}/>
                        <div>
                          <div className="wz-option-label">{label}</div>
                          <div className="wz-option-desc">{desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <input
                  className="wz-input"
                  placeholder="Other categories (e.g. Legal, Finance, Compliance...)"
                  value={wizardFlags.otherText}
                  onChange={e => setWizardFlags(f => ({ ...f, otherText: e.target.value }))}
                />
                <div className="wz-nav">
                  <button className="wz-back-btn" onClick={() => setWizardStep(2)}>← Back</button>
                  <button className="wz-next-btn" onClick={() => { setWizardStep(4); fetchAvailableLabels(); }}>Continue</button>
                </div>
              </div>
            )}

            {/* ── STEP 4: Source selection ── */}
            {wizardStep === 4 && (
              <div>
                <h2 className="wz-title">Where should we look?</h2>
                <p className="wz-subtitle">Pick your email sources. Promotions, social, and updates are skipped automatically.</p>
                <div className="wz-option-list">
                  {[
                    { id: 'IMPORTANT', label: 'Important', desc: 'Gmail-curated · Recommended' },
                    { id: 'INBOX',     label: 'Inbox',     desc: 'All incoming emails' },
                    { id: 'SENT',      label: 'Sent',      desc: 'Emails you replied to' },
                  ].map(({ id, label, desc }) => {
                    const checked = wizardFlags.gmailLabels.includes(id);
                    return (
                      <label key={id} className={`wz-option${checked ? ' wz-option-on' : ''}`}>
                        <div className={`wz-cb${checked ? ' wz-cb-on' : ''}`}>
                          {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <input type="checkbox" checked={checked} onChange={() =>
                          setWizardFlags(f => ({ ...f, gmailLabels: checked ? f.gmailLabels.filter(l => l !== id) : [...f.gmailLabels, id] }))
                        } style={{ display: 'none' }}/>
                        <div>
                          <div className="wz-option-label">{label}</div>
                          <div className="wz-option-desc">{desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <label className={`wz-option wz-option-sm${wizardFlags.useCustomLabels ? ' wz-option-on' : ''}`}>
                  <div className={`wz-cb${wizardFlags.useCustomLabels ? ' wz-cb-on' : ''}`}>
                    {wizardFlags.useCustomLabels && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <input type="checkbox" checked={wizardFlags.useCustomLabels}
                    onChange={e => setWizardFlags(f => ({ ...f, useCustomLabels: e.target.checked }))}
                    style={{ display: 'none' }}/>
                  <div className="wz-option-label">Use my Gmail labels</div>
                </label>
                {wizardFlags.useCustomLabels && (
                  <div className="wz-labels-panel">
                    {labelsLoading ? (
                      <div className="wz-labels-empty">Loading your labels...</div>
                    ) : availableLabels.length === 0 ? (
                      <div className="wz-labels-empty">No custom labels found in Gmail.</div>
                    ) : availableLabels.map(lbl => {
                      const checked = wizardFlags.customLabelIds.includes(lbl.id);
                      return (
                        <label key={lbl.id} className={`wz-label-row${checked ? ' wz-label-row-on' : ''}`}>
                          <div className={`wz-cb wz-cb-sm${checked ? ' wz-cb-on' : ''}`}>
                            {checked && <svg width="8" height="6" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                          <input type="checkbox" checked={checked}
                            onChange={() => setWizardFlags(f => ({ ...f, customLabelIds: checked ? f.customLabelIds.filter(id => id !== lbl.id) : [...f.customLabelIds, lbl.id] }))}
                            style={{ display: 'none' }}/>
                          <span className="wz-label-name">{lbl.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <div className="wz-nav">
                  <button className="wz-back-btn" onClick={() => setWizardStep(3)}>← Back</button>
                  <button
                    className="wz-next-btn"
                    onClick={handleWizardComplete}
                    disabled={syncing || wizardFlags.gmailLabels.length === 0}
                  >
                    {syncing ? 'Setting up...' : 'Start Syncing'}
                  </button>
                </div>
              </div>
            )}

            {/* ── PROGRESS SCREEN ── */}
            {wizardStep === 'progress' && (() => {
              const { threads_total, threads_done, eta_seconds, queue_position } = onboardingProgress;
              const etaMins = Math.ceil((eta_seconds || 0) / 60);
              const pct = threads_total > 0 ? Math.round((threads_done / threads_total) * 100) : 0;
              const steps = [
                { label: 'Fetching emails',     detail: threads_total > 0 ? `${threads_total} threads found` : 'Scanning your inbox...', done: threads_total > 0 },
                { label: 'Filtering noise',     detail: 'Removing promotions & social', done: threads_total > 0 },
                { label: 'Building your graph', detail: etaMins > 0 ? `~${etaMins} min remaining` : 'Queued...', done: false },
              ];
              return (
                <div className="wz-progress">
                  <div className="wz-spinner"/>
                  <h2 className="wz-title" style={{ textAlign: 'center' }}>Setting up your workspace</h2>
                  <p className="wz-subtitle" style={{ textAlign: 'center' }}>Your graph is being built in the background.</p>
                  <div className="wz-status-list">
                    {steps.map(({ label, detail, done }, i) => (
                      <div key={i} className="wz-status-row">
                        <div className={`wz-status-icon${done ? ' wz-status-icon-done' : ''}`}>
                          {done
                            ? <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            : <div className="wz-status-pending"/>}
                        </div>
                        <div>
                          <div className={`wz-status-text${done ? ' wz-status-text-done' : ''}`}>{label}</div>
                          {detail && <div className="wz-status-detail">{detail}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {threads_total > 0 && (
                    <>
                      <div className="wz-pbar-wrap">
                        <div className="wz-pbar-fill" style={{ width: `${pct}%` }}/>
                      </div>
                      <div className="wz-pbar-label">{pct}% complete</div>
                    </>
                  )}
                  {queue_position > 0 && (
                    <p className="wz-queue-note">{queue_position} user{queue_position > 1 ? 's' : ''} ahead of you in queue</p>
                  )}
                  <p className="wz-close-note">You can close this tab — we'll continue in the background.</p>
                </div>
              );
            })()}

          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Run build — this is the critical integration build**

```bash
cd frontend && npm run build
```
Expected: `✓ built in X.XXs` with zero errors. If there are import errors, verify `Dashboard.jsx`, `Auth.jsx`, and all component files are in `frontend/src/`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(dashboard): refactor App.jsx to auth/wizard shell, wire Dashboard"
```

---

### Task 11: Final verification

**Files:** None — smoke-test only.

- [ ] **Step 1: Run the dev server**

```bash
cd frontend && npm run dev
```
Expected: Vite dev server starts at `http://localhost:5173`.

- [ ] **Step 2: Smoke-test the app in a browser — run through this checklist**

Open `http://localhost:5173` and verify:

| # | Check | Expected |
|---|---|---|
| 1 | Auth page loads | Two-panel layout with Gmail connect button |
| 2 | After sign-in (existing user) | Three-column dashboard appears, no wizard |
| 3 | Sidebar shows **Tasks** as active | `#eff6ff` background, blue text |
| 4 | Middle panel shows filter tabs | All / Priority / Action / Unread |
| 5 | Thread rows appear (if data exists) | Urgency dot + Gmail icon + subject + time |
| 6 | Click a thread row | Row turns blue-left-bordered, right panel loads |
| 7 | Right panel tabs | Summary / Email / Context switch correctly |
| 8 | AI Summary shows text (or "not yet generated") | No crash |
| 9 | Click **People** in sidebar | PeopleView replaces both middle + right panels |
| 10 | Click **Projects** in sidebar | ProjectsView appears |
| 11 | Click **Ask AI** | Chat input visible, send a message, response loads |
| 12 | Settings popup | Click settings gear → email + sync time + Sign Out visible |
| 13 | New user flow | Sign out → sign in fresh → wizard appears over dashboard |

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(dashboard): WorkHub-style three-column dashboard complete"
```
