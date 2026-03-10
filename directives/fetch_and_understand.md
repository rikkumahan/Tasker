---
name: fetch_and_understand
description: n8n workflow that fetches academic emails from Gmail, sends them to the LLM for contextual understanding, detects changes, and upserts structured tasks into Supabase.
---

# Fetch & Understand Emails → Supabase

## Goal
Poll Gmail for academic emails, use Sarvam.ai to extract structured tasks with context (course, deadline, summary, warnings), detect updates to existing tasks, and store everything in Supabase.

## Trigger
- **Schedule:** every 2 hours (saves LLM API costs)
- **Webhook (manual refresh):** POST `/webhook/refresh` — triggered by the dashboard's Refresh button

## Inputs
- Gmail account (OAuth credential in n8n)
- Sarvam.ai API key (stored in n8n credential: `SARVAM_API_KEY`, base URL: `https://api.sarvam.ai/v1`)
- Supabase URL + service role key (stored in n8n Supabase credential)

## n8n Workflow Nodes (in order)

### 1. Trigger (Schedule or Webhook)
- Schedule: every 2 hours
- Webhook path: `/webhook/refresh`

### 2. Supabase Node — Fetch Current Context
- Operation: Get Many
- Table: `tasks`
- Filter: `status = 'pending'`
- Output: Array of existing tasks. We will map this to a string `{{current_pending_tasks_json}}`

### 2b. Supabase Node — Fetch User Settings Profile
- Operation: Get Many
- Table: `user_settings`
- Limit: 1
- Output: The personalization context. We map this to `{{user_profile}}` and `{{categories_from_supabase}}`

### 3. Gmail Node — Fetch Emails (Incremental)
- Operation: Get Many
- Filters: `is:unread after:{{last_synced_timestamp}}` (Or rely on an n8n webhook triggering incrementally).
- Max results: 20 per run
- Output: array of email objects (`id`, `subject`, `body`, `from`, `date`)

### 4. Code Node — Prepare LLM Input
For each email, build the prompt:

```
You are an academic and personal productivity assistant. 
Your goal is to extract new tasks and events from the incoming email WITHOUT duplicating existing tasks.

USER CONTEXT & PERSONALITY PROFILE:
"{{user_profile}}"
(Use this context to decide if an email is actually relevant/actionable for this specific user, or just generic spam).

CURRENT PENDING TASKS AWAITING THE USER:
{{current_pending_tasks_json}}

Email subject: {{subject}}
Email body: {{body}}
Email date: {{date}}

Return a JSON array. Each element is one task:
[
  {
    "title": "short task name e.g. DAA Quiz",
    "course": "course name e.g. DAA",
    "deadline": "ISO 8601 datetime or null if unclear",
    "location": "room/venue or null",
    "summary": "1-2 sentence plain English summary",
    "category": "String. Pick ONE category from this user list: [{{categories_from_supabase}}]. If none fit perfectly, invent a concise new 1-word or 2-word label.",
    "source_email_id": "{{id}}"
  }
]

Rules:
- Do NOT output a task if it is already present in CURRENT PENDING TASKS (but DO output it if the deadline/location changed so we can update it).
- If the email contains actionable tasks, academic deadlines, career opportunities, OR college events (fests, hackathons, seminars, extracurriculars), assign a relevant concise category.
- If the email is purely informational, an announcement, or has NO deadline/clear action, you MUST extract it but give it the exact category "Check_Out_Mail".
- If it is completely spam or irrelevant, return [].
```

### 4. Sarvam.ai Node (OpenAI Node — custom base URL)
- Credential: OpenAI type, API key = `SARVAM_API_KEY`, Base URL = `https://api.sarvam.ai/v1`
- Model: `sarvam-m` (or latest available text model)
- System prompt: (included in step 3 prompt)
- Temperature: 0 (we want deterministic JSON)
- Parse response as JSON

### 5. Code Node — Flatten Tasks
Flatten LLM output into a flat array of task objects across all emails.

### 6. Loop Over Tasks
For each task:

#### 6a. Supabase Node — Check Existing
- Operation: Get
- Table: `tasks`
- Filter: `source_email_id = {{task.source_email_id}}`

#### 6b. IF Node — Does it exist?
- **Yes (update path):** Compare deadline. If deadline has changed:
  - Set `updated = true`
  - Set `change_note = "Rescheduled from <old_deadline>"`
- **No (insert path):** Set `updated = false`, `change_note = null`

#### 6c. Supabase Node — Upsert
- Operation: Upsert
- Conflict column: `source_email_id`
- Payload: all task fields

### 7. Code Node — Compute Warnings
After all upserts, query all pending tasks and compute:
- `⚠️ Quiz tomorrow` — deadline is tomorrow
- `⚠️ 3+ deadlines this week` — count tasks in next 7 days
- `⚠️ Two tasks same day` — multiple deadlines on same date

Write warnings back to each affected task's `warnings` array via Supabase update.

## Outputs
- `tasks` table in Supabase fully updated
- Dashboard frontend auto-refreshes via Supabase real-time subscription

## Exported Workflow
Save n8n workflow JSON to: `execution/n8n_workflows/email_to_tasks.json`

## Edge Cases & Learnings
- If LLM returns malformed JSON, the Code node should catch and log — do not crash the workflow
- Emails with no academic content return `[]` — skip gracefully
- Rate limit on Sarvam.ai: if hit, add a Wait node (2s) between LLM calls
- Gmail OAuth token expires periodically — re-auth in n8n credentials panel
