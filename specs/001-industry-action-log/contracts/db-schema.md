# Contract: Database Schema

**Interface**: Edge Functions → PostgreSQL (`tasks` table)
**Direction**: Backend → Database

---

## Migration (apply once)

```sql
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS action_type          text,
  ADD COLUMN IF NOT EXISTS impact_level         text,
  ADD COLUMN IF NOT EXISTS sender_organization  text,
  ADD COLUMN IF NOT EXISTS escalation_risk      text,
  ADD COLUMN IF NOT EXISTS suggested_reply_draft jsonb;

ALTER TABLE public.tasks
  ADD CONSTRAINT IF NOT EXISTS chk_action_type
    CHECK (action_type IN (
      'approval_required','reply_needed','blocker',
      'event','delegated_tracking','awareness'
    )),
  ADD CONSTRAINT IF NOT EXISTS chk_impact_level
    CHECK (impact_level IN ('high','medium','low'));
```

---

## Upsert Contract (sync/index.ts → tasks)

All new fields are passed inside the existing upsert object. Null values are acceptable for all new columns.

```typescript
await supabase.from('tasks').upsert({
  // Existing fields (unchanged)
  user_id, source_email_id, title, summary,
  deadline, category, warnings, status,
  // New fields
  action_type:           item.action_type ?? null,
  impact_level:          item.impact_level ?? null,
  sender_organization:   item.sender_organization ?? null,
  escalation_risk:       item.escalation_risk ?? null,
  suggested_reply_draft: item.suggested_reply_draft ?? null,
}, { onConflict: 'source_email_id' });
```

---

## Read Contract (frontend → tasks)

Frontend SELECT query extended to include new columns:

```sql
SELECT
  id, user_id, source_email_id, title, summary,
  deadline, category, warnings, starred, status,
  created_at, updated_at,
  -- New columns
  action_type, impact_level, sender_organization,
  escalation_risk, suggested_reply_draft
FROM public.tasks
WHERE user_id = auth.uid()
  AND status = 'pending'
ORDER BY
  CASE impact_level
    WHEN 'high'   THEN 1
    WHEN 'medium' THEN 2
    WHEN 'low'    THEN 3
    ELSE 4
  END,
  created_at DESC;
```
