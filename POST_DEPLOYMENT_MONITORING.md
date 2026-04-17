# 🔍 Post-Deployment Monitoring Guide - Ghost Tasks Fix

**Deployment Time:** Now  
**Status:** ✅ Edge Function deployed to production  
**Next:** Real-time monitoring and verification

---

## Real-Time Monitoring Queries

### 1️⃣ Queue Health (Run every 30 seconds)

```sql
SELECT 
  COUNT(*) as total_queued,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
  SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
  MAX(created_at) as last_job,
  MAX(EXTRACT(EPOCH FROM (now() - created_at))) as oldest_job_age_sec
FROM sync_queue;
```

**Expected:**
- `pending` decreases over time (draining)
- `done` increases over time (progress)
- `oldest_job_age_sec` < 600 seconds (10 minutes)

---

### 2️⃣ Ghost Tasks Being Created (Run every minute)

```sql
SELECT 
  COUNT(*) as ghost_count,
  COUNT(DISTINCT user_id) as affected_users,
  COUNT(CASE WHEN created_at > now() - interval '5 minutes' THEN 1 END) as created_last_5min,
  COUNT(CASE WHEN created_at > now() - interval '1 hour' THEN 1 END) as created_last_hour,
  MAX(created_at) as most_recent
FROM tasks
WHERE status = 'ignored'
AND title = '[IGNORED_EMAIL]';
```

**Expected:**
- `created_last_5min` > 0 (actively being created)
- `ghost_count` increases steadily
- `affected_users` growing

---

### 3️⃣ Real Tasks Being Created (Run every minute)

```sql
SELECT 
  COUNT(*) as real_task_count,
  COUNT(DISTINCT user_id) as affected_users,
  COUNT(CASE WHEN created_at > now() - interval '5 minutes' THEN 1 END) as created_last_5min,
  COUNT(CASE WHEN created_at > now() - interval '1 hour' THEN 1 END) as created_last_hour,
  MAX(created_at) as most_recent
FROM tasks
WHERE status = 'pending'
AND title != '[IGNORED_EMAIL]';
```

**Expected:**
- `real_task_count` > 0 (users extracting real tasks)
- `created_last_5min` > 0 (ongoing extraction)

---

### 4️⃣ Sync Success Rate (Run every 5 minutes)

```sql
SELECT 
  event,
  COUNT(*) as total_events,
  COUNT(CASE WHEN data->>'error' IS NULL THEN 1 END) as successes,
  COUNT(CASE WHEN data->>'error' IS NOT NULL THEN 1 END) as failures,
  ROUND(100.0 * COUNT(CASE WHEN data->>'error' IS NULL THEN 1 END) / COUNT(*), 2) as success_rate
FROM debug_logs
WHERE created_at > now() - interval '10 minutes'
AND event IN ('V20_RESTORED_COMPLETE', 'SYNC_START', 'WORKER_DONE')
GROUP BY event
ORDER BY event;
```

**Expected:**
- `success_rate` >= 95%
- No spike in failures
- `WORKER_DONE` events present (background worker running)

---

### 5️⃣ Locked Users (Check for stuck syncs)

```sql
SELECT 
  user_id,
  sync_in_progress,
  sync_lock_at,
  EXTRACT(EPOCH FROM (now() - sync_lock_at)) as lock_age_sec,
  EXTRACT(EPOCH FROM (now() - last_synced_at)) as time_since_last_sync_sec
FROM user_settings
WHERE sync_in_progress = true
ORDER BY sync_lock_at DESC;
```

**Expected:**
- Empty result (no stuck locks)
- OR locks < 120 seconds old (will auto-expire)
- If any > 300 sec old: **ALARM** - needs manual unlock

---

### 6️⃣ Error Logs (Run every 2 minutes)

```sql
SELECT 
  event,
  COUNT(*) as count,
  MAX(created_at) as most_recent,
  STRING_AGG(DISTINCT data->>'error', ', ') as error_types
FROM debug_logs
WHERE created_at > now() - interval '10 minutes'
AND data->>'error' IS NOT NULL
GROUP BY event
ORDER BY count DESC
LIMIT 10;
```

**Expected:**
- Empty result (no errors)
- OR only transient errors (429 rate limit)

---

### 7️⃣ Task Distribution (Every 10 minutes)

```sql
SELECT 
  status,
  COUNT(*) as count,
  COUNT(CASE WHEN created_at > now() - interval '1 hour' THEN 1 END) as created_last_hour,
  COUNT(DISTINCT user_id) as affected_users
FROM tasks
GROUP BY status
ORDER BY count DESC;
```

**Expected:**
- `status='pending'` has real user tasks (visible)
- `status='ignored'` growing steadily (ghost tasks working)
- `status='completed'` relatively stable

---

## 🚨 Alert Thresholds

### 🔴 CRITICAL - Immediate Action Required

| Alert | Threshold | Action |
|-------|-----------|--------|
| Sync queue backlog | > 100 jobs after 15 min | Check background_worker logs |
| Ghost tasks not created | 0 created after 5 min | Check sync function logs |
| Error rate spike | > 10% failures in 5 min | Review debug_logs for errors |
| Stuck locks | Any lock > 300 sec | Manually unlock user |
| Backend crash | Multiple 500 errors | Check Edge Function logs |

### 🟡 WARNING - Monitor Closely

| Warning | Threshold | Action |
|---------|-----------|--------|
| Sync slowdown | > 30s per batch | Monitor LLM API latency |
| High ghost count | > 1000/user | May indicate LLM issue |
| Rate limit hits | > 5 per minute | Check API key rotation |
| Queue age | > 600s average | Background worker may be slow |

---

## ✅ Success Indicators (First 10 minutes)

```
⏱️  0-2 minutes:
  ✅ Ghost tasks start appearing in debug_logs
  ✅ sync_queue begins draining
  ✅ WORKER_DONE events visible

⏱️  2-5 minutes:
  ✅ Ghost task count grows steadily
  ✅ Real tasks appear in frontend
  ✅ Error rate remains < 5%
  ✅ No stuck locks

⏱️  5-10 minutes:
  ✅ Queue mostly drained
  ✅ Multiple users successfully synced
  ✅ Ghost tasks stabilizing
  ✅ Zero user-reported issues
```

---

## 🔧 Manual Intervention Procedures

### If Queue Not Draining

```sql
-- Check background worker status
SELECT 
  user_id, 
  status, 
  retry_count, 
  next_retry_at,
  created_at
FROM sync_queue
WHERE status IN ('pending', 'processing')
ORDER BY created_at DESC
LIMIT 20;

-- Check for stuck processing jobs
UPDATE sync_queue 
SET status = 'pending', next_retry_at = now()
WHERE status = 'processing' 
AND updated_at < now() - interval '5 minutes';
```

### If Ghost Tasks Not Created

```sql
-- Check recent sync logs
SELECT user_id, event, data, created_at
FROM debug_logs
WHERE event IN ('TASK_CATEGORIZED', 'SYNC_START', 'V20_RESTORED_COMPLETE')
AND created_at > now() - interval '5 minutes'
ORDER BY created_at DESC
LIMIT 50;

-- Check for LLM errors
SELECT data->>'error' as error_detail, COUNT(*) as count
FROM debug_logs
WHERE created_at > now() - interval '10 minutes'
AND data->>'error' IS NOT NULL
GROUP BY data->>'error'
LIMIT 10;
```

### If Stuck Locks Exist

```sql
-- View stuck locks
SELECT 
  user_id, 
  sync_lock_at,
  EXTRACT(EPOCH FROM (now() - sync_lock_at)) as age_sec
FROM user_settings
WHERE sync_in_progress = true
AND sync_lock_at < now() - interval '5 minutes';

-- Manually unlock specific user
UPDATE user_settings
SET sync_in_progress = false, 
    sync_lock_at = NULL
WHERE user_id = '[USER_ID]';

-- Trigger re-sync
INSERT INTO sync_queue (user_id, dedup_id)
VALUES ('[USER_ID]', 'manual_unlock_' || now()::text);
```

---

## 📊 Monitoring Dashboard SQL (Copy into Supabase)

```sql
-- CREATE VIEW for real-time monitoring
CREATE OR REPLACE VIEW monitoring_dashboard AS
SELECT 
  'Queue Health' as metric,
  JSON_BUILD_OBJECT(
    'total_queued', (SELECT COUNT(*) FROM sync_queue),
    'pending', (SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'),
    'processing', (SELECT COUNT(*) FROM sync_queue WHERE status = 'processing'),
    'done', (SELECT COUNT(*) FROM sync_queue WHERE status = 'done')
  ) as data
UNION ALL
SELECT
  'Ghost Tasks',
  JSON_BUILD_OBJECT(
    'total', (SELECT COUNT(*) FROM tasks WHERE status = 'ignored' AND title = '[IGNORED_EMAIL]'),
    'last_5min', (SELECT COUNT(*) FROM tasks WHERE status = 'ignored' AND title = '[IGNORED_EMAIL]' AND created_at > now() - interval '5 minutes'),
    'affected_users', (SELECT COUNT(DISTINCT user_id) FROM tasks WHERE status = 'ignored' AND title = '[IGNORED_EMAIL]')
  )
UNION ALL
SELECT
  'Real Tasks',
  JSON_BUILD_OBJECT(
    'total', (SELECT COUNT(*) FROM tasks WHERE status = 'pending' AND title != '[IGNORED_EMAIL]'),
    'last_5min', (SELECT COUNT(*) FROM tasks WHERE status = 'pending' AND title != '[IGNORED_EMAIL]' AND created_at > now() - interval '5 minutes'),
    'affected_users', (SELECT COUNT(DISTINCT user_id) FROM tasks WHERE status = 'pending' AND title != '[IGNORED_EMAIL]')
  )
UNION ALL
SELECT
  'Errors',
  JSON_BUILD_OBJECT(
    'last_5min', (SELECT COUNT(*) FROM debug_logs WHERE created_at > now() - interval '5 minutes' AND data->>'error' IS NOT NULL),
    'rate', ROUND(100.0 * (SELECT COUNT(*) FROM debug_logs WHERE created_at > now() - interval '5 minutes' AND data->>'error' IS NOT NULL) / NULLIF((SELECT COUNT(*) FROM debug_logs WHERE created_at > now() - interval '5 minutes'), 0), 2)
  );

-- Query it
SELECT * FROM monitoring_dashboard;
```

---

## 📋 Hourly Checklist

Every hour for the first 6 hours, run:

```sql
-- 1. Queue status
SELECT COUNT(*) as queued, COUNT(CASE WHEN status='done' THEN 1 END) as completed FROM sync_queue;

-- 2. Ghost task progress
SELECT COUNT(*) as ghost_total FROM tasks WHERE status='ignored' AND title='[IGNORED_EMAIL]';

-- 3. Real task growth
SELECT COUNT(*) as real_tasks FROM tasks WHERE status='pending' AND title!='[IGNORED_EMAIL]';

-- 4. Error rate
SELECT ROUND(100.0 * COUNT(CASE WHEN data->>'error' IS NOT NULL THEN 1 END) / NULLIF(COUNT(*), 0), 2) as error_rate FROM debug_logs WHERE created_at > now() - interval '1 hour';

-- 5. Stuck locks
SELECT COUNT(*) as stuck_locks FROM user_settings WHERE sync_in_progress=true AND sync_lock_at < now() - interval '5 minutes';
```

---

## 🎯 Expected Timeline

```
T+0 min:    Deployment complete
T+1 min:    First ghost tasks appear
T+2 min:    Queue starts draining
T+5 min:    Multiple users synced successfully
T+10 min:   Queue mostly empty
T+30 min:   All user syncs completed
T+1 hour:   System stable, metrics normalized
```

---

## 📞 Escalation Plan

If you observe critical issues:

1. **Queue not draining after 15 min**
   - Check background_worker Edge Function logs
   - Verify API keys are active
   - Check for rate limiting

2. **Ghost tasks not created**
   - Check sync Edge Function logs
   - Verify LLM API is responding
   - Check database write permissions

3. **High error rate (>10%)**
   - Review error types in debug_logs
   - Check for API rate limits
   - Verify network connectivity

4. **User reports frozen syncs**
   - Query stuck locks
   - Manually unlock if needed
   - Re-trigger sync_queue

---

**Next Steps:**  
Monitor these queries in Supabase SQL Editor for the next 10-30 minutes to confirm successful deployment.

Report status when ready!
