# Deployment Plan: Ghost Tasks Fix (Infinite Loop Resolution)

**Commit:** `f465686`  
**Date:** 2026-04-18  
**Status:** Ready for Production Deployment

---

## Executive Summary

This deployment fixes a critical infinite loop in the sync engine where processing 15 emails that yield zero valid tasks (spam/newsletters) would cause the system to:
1. Forget those emails were processed (no tasks inserted = dedup engine has no record)
2. Re-process the same 15 emails infinitely
3. Prevent `sync_page_token` from advancing
4. Freeze the sync for affected users indefinitely

**Solution:** Ghost Tasks — lightweight, invisible task records for skipped emails.

---

## Technical Changes

### File Modified
- `supabase/functions/sync/index.ts` (lines 884-908)

### Implementation Details

**Before:** Only real tasks are upserted
```typescript
if (finalTasks.length > 0) {
  const { error: upsertError } = await supabaseAdmin.from("tasks").upsert(finalTasks);
  if (upsertError) throw new Error("Failed to persist tasks: " + upsertError.message);
}
```

**After:** Ghost tasks + real tasks are combined and upserted together
```typescript
// Identify skipped emails from the processed batch
const batchEmails = unprocessedEmails.slice(0, 15);
const processedEmailIds = new Set(finalTasks.map(t => t.source_email_id));
const ghostTasks = batchEmails
  .filter(e => !processedEmailIds.has(e.id))
  .map(e => ({
    title: "[IGNORED_EMAIL]",
    summary: "Email skipped – no actionable tasks detected",
    category: "System",
    status: "ignored",
    user_id: user.id,
    source_email_id: e.id,
  }));

// Combine and upsert
const allTasksToUpsert = [...finalTasks, ...ghostTasks];
if (allTasksToUpsert.length > 0) {
  const { error: upsertError } = await supabaseAdmin.from("tasks").upsert(allTasksToUpsert, { onConflict: "source_email_id" });
  if (upsertError) throw new Error("Failed to persist tasks: " + upsertError.message);
}
```

### Ghost Task Properties
| Property | Value | Purpose |
|----------|-------|---------|
| `title` | `[IGNORED_EMAIL]` | Clear, non-user-facing identifier |
| `summary` | `Email skipped – no actionable tasks detected` | Audit trail explanation |
| `category` | `System` | System-level, not user-visible |
| `status` | `ignored` | Distinguishes from `pending` |
| `source_email_id` | Email ID | Critical for dedup engine |
| `user_id` | User ID | Audit and filtering |

---

## System Compatibility

### ✅ Dedup Engine (Unaffected)
- Queries: `SELECT * FROM tasks WHERE source_email_id IN (...)`
- **Does NOT filter by status** — ghost tasks are detected automatically
- Location: `sync/index.ts:811-814`

### ✅ Frontend UI (Ghost Tasks Invisible)
- Frontend query: `SELECT * FROM tasks WHERE user_id = ? AND status = 'pending'`
- **Filters out `status='ignored'`** — ghost tasks never appear in UI
- Location: `frontend/src/App.jsx:164`

### ✅ Background Worker (Compatible)
- Re-queues: `if (data?.remaining > 0) {...}`
- **No changes needed** — uses existing catchup mechanism
- Location: `supabase/functions/background_worker/index.ts:66-71`

### ✅ Webhook Ingest (Compatible)
- Inserts: `INSERT INTO sync_queue (...)`
- **No changes needed** — pure queue insertion
- Location: `supabase/functions/webhook_ingest/index.ts:52-54`

### ✅ Database Schema (Compatible)
- `status` field: `text not null default 'pending'`
- **No schema migration required** — `'ignored'` is a valid text value
- Location: `execution/supabase_schema.sql:12`

---

## Deployment Checklist

### Pre-Deployment

- [ ] **Code Review Approved** — Verify commit `f465686` has been reviewed
- [ ] **Backup user_settings** — In case manual lock cleanup is needed
  ```sql
  SELECT user_id, sync_in_progress, sync_lock_at FROM user_settings 
  WHERE sync_in_progress = true;
  ```

### Deployment Steps

1. **Deploy Edge Function**
   ```bash
   supabase functions deploy sync
   ```
   This deploys `supabase/functions/sync/index.ts` to production.

2. **Optional: Unlock Stuck Users** (only if needed)
   ```sql
   UPDATE user_settings 
   SET sync_in_progress = false, sync_lock_at = NULL 
   WHERE sync_in_progress = true 
   AND (sync_lock_at IS NULL OR EXTRACT(EPOCH FROM (now() - sync_lock_at)) > 300);
   ```

3. **Trigger Catchup Syncs** (for users with pending emails)
   ```sql
   INSERT INTO sync_queue (user_id, dedup_id)
   SELECT DISTINCT user_id, 'manual_' || user_id || '_' || now()::text
   FROM user_settings
   WHERE sync_page_token IS NOT NULL;
   ```
   This re-queues any users that were stuck in multi-page inbox processing.

4. **Monitor Background Worker**
   ```sql
   SELECT user_id, status, retry_count, created_at, next_retry_at
   FROM sync_queue
   ORDER BY created_at DESC
   LIMIT 20;
   ```

### Post-Deployment

- [ ] **Verify Queue Draining** — Check `sync_queue` status over 5 minutes
- [ ] **Monitor Debug Logs** — Look for `TASK_CATEGORIZED` events
  ```sql
  SELECT user_id, event, data, created_at
  FROM debug_logs
  WHERE event IN ('TASK_CATEGORIZED', 'V20_RESTORED_COMPLETE')
  ORDER BY created_at DESC
  LIMIT 50;
  ```
- [ ] **Check Task Counts** — Verify ghost tasks are inserted but frontend is clean
  ```sql
  -- Should show many 'ignored' tasks created recently
  SELECT status, COUNT(*) as count, MAX(created_at)
  FROM tasks
  WHERE created_at > now() - interval '1 hour'
  GROUP BY status;
  ```

---

## Testing Plan

### Unit Test: Ghost Task Generation

**Scenario:** Batch of 15 emails, all spam (LLM returns 0 tasks)

**Expected Behavior:**
1. `finalTasks = []` (no real tasks)
2. `ghostTasks = [15 records with status='ignored']`
3. All 15 emails have entries in `tasks` table with `source_email_id` set
4. Dedup engine detects them on next sync attempt

**Test SQL:**
```sql
-- After first sync of spam-heavy batch
SELECT id, source_email_id, title, status, created_at
FROM tasks
WHERE title = '[IGNORED_EMAIL]'
AND created_at > now() - interval '1 minute';
```

### Integration Test: Dedup Prevention

**Scenario:** User's inbox has 100 emails, first 15 are spam, next 15 are newsletters

**Expected Behavior:**
1. First sync: 15 ghost tasks created, 0 real tasks, `sync_page_token` advances
2. Second sync: Same 15 emails NOT re-processed (dedup detects ghost tasks), next 15 processed
3. User sees only real tasks in UI (ghost tasks filtered out)

**Test SQL:**
```sql
-- Verify ghost tasks don't appear in UI
SELECT COUNT(*) as frontend_visible_tasks
FROM tasks
WHERE user_id = '[TEST_USER]'
AND status = 'pending';

-- Verify backend knows about all processed emails
SELECT COUNT(*) as backend_total_processed
FROM tasks
WHERE user_id = '[TEST_USER]'
AND source_email_id IS NOT NULL;
```

### Performance Test: Sync Duration

**Before:** Could hang indefinitely on spam batches  
**After:** Should complete in <10s per 15-email batch

**Test Command:**
```sql
-- Check last few syncs
SELECT user_id, data->>'processed' as batch_size, 
       EXTRACT(EPOCH FROM (created_at - lag(created_at) OVER (ORDER BY created_at))) as sync_duration_sec
FROM debug_logs
WHERE event = 'V20_RESTORED_COMPLETE'
ORDER BY created_at DESC
LIMIT 10;
```

---

## Rollback Plan

If issues arise:

1. **Revert Commit**
   ```bash
   git revert f465686
   git push
   ```

2. **Re-deploy Old Function**
   ```bash
   supabase functions deploy sync
   ```

3. **Manual Cleanup** (optional, if ghost tasks cause problems)
   ```sql
   DELETE FROM tasks
   WHERE status = 'ignored'
   AND title = '[IGNORED_EMAIL]';
   ```

**Note:** Rollback will NOT cause regressions. Existing real tasks are unaffected. The system will simply revert to the old behavior (potential freezing on spam batches), but will be functional.

---

## Monitoring Dashboard Queries

### Real-Time Queue Health
```sql
SELECT 
  COUNT(*) as total_queued,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
  SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
  MAX(created_at) as last_job
FROM sync_queue;
```

### Ghost Task Stats
```sql
SELECT 
  COUNT(*) as ghost_count,
  COUNT(DISTINCT user_id) as affected_users,
  COUNT(CASE WHEN created_at > now() - interval '1 hour' THEN 1 END) as created_last_hour
FROM tasks
WHERE status = 'ignored'
AND title = '[IGNORED_EMAIL]';
```

### Sync Success Rate
```sql
SELECT 
  event,
  COUNT(*) as count,
  SUM(CASE WHEN data->>'error' IS NOT NULL THEN 1 ELSE 0 END) as errors
FROM debug_logs
WHERE created_at > now() - interval '6 hours'
AND event LIKE 'V%_SYNC_%'
GROUP BY event;
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Database bloat (too many ghost tasks) | Low | Medium | Implement cleanup job (optional) |
| Frontend breaks (unexpected `ignored` status) | Very Low | High | Frontend already filters by `pending` only |
| Dedup logic breaks | Very Low | Critical | No schema changes; dedup queries ANY status |
| Performance degradation | Very Low | Medium | Ghost tasks are lightweight, no extra LLM calls |

---

## Success Criteria

✅ Deployment is successful when:
1. `sync_queue` drains completely within 10 minutes
2. Users with spam-heavy inboxes complete sync within normal time
3. `debug_logs` shows `TASK_CATEGORIZED` events for ghost tasks
4. Zero `status='ignored'` tasks appear in user UI
5. No increase in error rate or sync failures

---

## Post-Deployment Review (24 hours)

**Checklist:**
- [ ] Queue empty
- [ ] No stuck locks in `user_settings`
- [ ] Ghost task count stabilizes
- [ ] User reported sync issues resolved
- [ ] No spike in error logs
- [ ] Background worker processing normally

---

**Prepared by:** OpenCode Agent  
**Date:** 2026-04-18  
**Approval Status:** Pending
