# Quickstart: Industry Action Log

**Branch**: `001-industry-action-log`
**Date**: 2026-05-20

---

## What Was Built

Tasker is being transitioned from a generic email task categorizer into an **Industry Action Log** for corporate professionals. This document explains how the system works end-to-end after this feature is implemented.

---

## How It Works

```
Gmail Email Arrives
       ↓
webhook_ingest (unchanged)
       ↓
sync_queue (unchanged)
       ↓
background_worker → calls /sync (unchanged)
       ↓
sync/index.ts
  → fetches raw email
  → runs 3-stage PII shield  ← UNCHANGED
  → calls extractRawTasks()  ← MODIFIED PROMPT
       ↓
stages.ts (extractRawTasks)
  → LLM returns extended schema:
    title, summary, deadline, category,
    action_type, impact_level,
    sender_organization, escalation_risk,
    suggested_reply_draft
       ↓
sync/index.ts upserts to tasks table
  → new columns populated alongside existing ones
       ↓
Supabase Realtime pushes update to frontend
       ↓
App.jsx renders ActionCard components
  → grouped by sender_organization (clusters)
  → sorted by impact_level within each cluster
  → impact badge + action type chip displayed
  → escalation risk banner if present
  → suggested drafts expandable section
```

---

## Running Locally

```bash
# 1. Start the frontend dev server
cd frontend
npm run dev

# 2. Deploy updated edge functions (after code changes)
supabase functions deploy sync
supabase functions deploy synthesize_profile

# 3. Apply DB migration (one-time)
# Run the SQL in specs/001-industry-action-log/data-model.md
# via Supabase dashboard → SQL editor

# 4. Trigger a manual sync
# Click the sync button in the app UI or call:
curl -X POST https://<project>.supabase.co/functions/v1/sync \
  -H "Authorization: Bearer <user_jwt>"
```

---

## Key Files Changed

| File | Change |
|---|---|
| `supabase/functions/_shared/stages.ts` | Extraction prompt extended with action insight schema |
| `supabase/functions/sync/index.ts` | Upsert extended with 5 new columns |
| `supabase/functions/synthesize_profile/index.ts` | Onboarding prompts updated for corporate context |
| `frontend/src/App.jsx` | ActionCard component + cluster grouping layout |
| `frontend/src/index.css` | Impact badge + action chip visual tokens |

---

## Verifying a Successful Implementation

1. Open the app — header must read **"Action Log"** not "My Tasks"
2. Trigger sync — action cards must show `impact_level` badge and `action_type` chip
3. Expand a Reply Needed card — Suggested Drafts section must show 2–3 options
4. Check `debug_logs` table — `TASK_CATEGORIZED` events must include new fields
5. Run `node run_deep_test.mjs` — must pass 16/16 PII accuracy tests
