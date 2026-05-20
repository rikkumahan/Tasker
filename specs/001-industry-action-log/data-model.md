# Data Model: Industry Action Log

**Phase**: 1 — Design & Contracts
**Branch**: `001-industry-action-log`
**Date**: 2026-05-20

---

## Entity 1: Action Card (extends `tasks` table)

Represents a single actionable insight extracted from one email. This entity extends the existing `tasks` table with 5 new nullable columns. All existing columns remain unchanged.

### Existing Columns (unchanged)
| Column | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK to auth.users — RLS enforced |
| `source_email_id` | text | Unique Gmail message ID — dedup key |
| `title` | text | Short action headline |
| `summary` | text | Context summary of what the email says |
| `deadline` | text | Extracted deadline or due date |
| `category` | text | Repurposed as cluster/project label |
| `warnings` | text[] | Array of warning flags from previous version |
| `starred` | boolean | User-pinned flag |
| `status` | text | pending / ignored / done |
| `created_at` | timestamptz | Row creation time |
| `updated_at` | timestamptz | Last update time |

### New Columns (this feature)
| Column | Type | Nullable | Description |
|---|---|---|---|
| `action_type` | text | YES | One of: `approval_required`, `reply_needed`, `blocker`, `event`, `delegated_tracking`, `awareness` |
| `impact_level` | text | YES | One of: `high`, `medium`, `low` |
| `sender_organization` | text | YES | Normalized organization name extracted from email headers or signature |
| `escalation_risk` | text | YES | Max 2-sentence consequence description if the action is ignored |
| `suggested_reply_draft` | jsonb | YES | `{ "options": [{ "label": string, "text": string }] }` — 2-3 options for reply-type actions |

### Validation Rules
- `action_type` must be one of the 6 defined enum values when not null
- `impact_level` must be one of `high`, `medium`, `low` when not null
- `suggested_reply_draft.options` must contain between 2 and 3 items when present
- `source_email_id` remains the unique dedup key — unchanged

### State Transitions
```
pending → done       (user resolves the action)
pending → ignored    (user dismisses or email is noise)
ignored → pending    (re-queued on re-sync if email updated)
```

---

## Entity 2: Project / Client Cluster (derived — no new table)

A named grouping of Action Cards sharing a common organizational context. This entity is computed at query/render time from the `sender_organization` field — no new database table is required in this phase.

### Computed Attributes
| Attribute | Source |
|---|---|
| `cluster_name` | `tasks.sender_organization` (normalized by LLM) |
| `action_count` | COUNT of cards in cluster |
| `highest_impact` | MAX impact level within cluster (`high` > `medium` > `low`) |
| `last_activity` | MAX `updated_at` within cluster |

### Grouping Rules
- Cards with `sender_organization = NULL` fall into a synthetic "Other" cluster
- Clusters with zero `pending` cards are collapsed by default in the UI
- Cluster order: clusters containing `high` impact cards appear first

---

## Entity 3: Corporate User Profile (extends `user_settings.user_profile`)

The user's persona stored in the `user_profile` text column of `user_settings`. No schema change required — the profile string is enriched by updating the onboarding prompts.

### Profile Structure (natural language, stored as structured text)

```
Role: [Senior Account Manager / Engineering Lead / etc.]
Organization: [Company name]
Key Clients: [Client A, Client B]
Active Projects: [Project Zeus, Q3 Campaign]
Priority Senders: [CEO name, Key Client contact]
Action Focus: [approvals, client replies, budget decisions]
Communication Style: [formal / balanced / direct]
```

### Update Trigger
- Written on onboarding completion (`synthesize_profile` with mode=`onboarding`)
- Updated on open chat commands (`synthesize_profile` with mode=`chat`)
- Read by `extractRawTasks` in `stages.ts` on every sync to calibrate action type weights

---

## Migration Script

```sql
-- Safe, idempotent migration — run via Supabase SQL editor or apply_migration MCP
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS action_type       text,
  ADD COLUMN IF NOT EXISTS impact_level      text,
  ADD COLUMN IF NOT EXISTS sender_organization text,
  ADD COLUMN IF NOT EXISTS escalation_risk   text,
  ADD COLUMN IF NOT EXISTS suggested_reply_draft jsonb;

-- Optional: add check constraints for enum values
ALTER TABLE public.tasks
  ADD CONSTRAINT IF NOT EXISTS chk_action_type
    CHECK (action_type IN ('approval_required','reply_needed','blocker','event','delegated_tracking','awareness')),
  ADD CONSTRAINT IF NOT EXISTS chk_impact_level
    CHECK (impact_level IN ('high','medium','low'));
```
