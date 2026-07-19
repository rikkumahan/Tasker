# ⚡ IMMEDIATE ACTIONS - Post-Deployment (RIGHT NOW)

**Status:** Edge Function deployed ✅  
**Next:** Verify it's working  
**Timeline:** First 10 minutes are critical

---

## 🚀 Right Now (Next 5 minutes)

### 1. Confirm Deployment Success
```bash
# Check function is live
supabase functions list

# Expected: "sync" function shows latest code
```

### 2. Run Verification Script
```bash
bash verify-ghost-tasks.sh

# Expected: All 5 checks should PASS (green ✅)
```

### 3. Check Queue Status
```sql
-- Go to Supabase SQL Editor and run:
SELECT COUNT(*) as queued, 
       SUM(CASE WHEN status='done' THEN 1 END) as done_count
FROM sync_queue;

-- Expected: queue count should start decreasing within 2 minutes
```

### 4. Look for Ghost Tasks
```sql
-- Should see recent ghost tasks created
SELECT COUNT(*) as ghost_tasks,
       MAX(created_at) as most_recent
FROM tasks
WHERE status = 'ignored' 
AND title = '[IGNORED_EMAIL]'
AND created_at > now() - interval '3 minutes';

-- Expected: ghost_tasks > 0, most_recent = recent timestamp
```

---

## 🎯 First 10 Minutes - Monitoring Checklist

### Every 2 minutes, check these 4 queries:

#### Query 1: Queue Health
```sql
SELECT COUNT(*) as pending FROM sync_queue WHERE status='pending';
```
**Goal:** Should be decreasing (draining)

#### Query 2: Ghost Task Creation
```sql
SELECT COUNT(*) as ghost_count FROM tasks 
WHERE status='ignored' AND title='[IGNORED_EMAIL]'
AND created_at > now() - interval '2 minutes';
```
**Goal:** Should be > 0 (actively creating)

#### Query 3: Real Tasks
```sql
SELECT COUNT(*) as real_tasks FROM tasks 
WHERE status='pending' AND title != '[IGNORED_EMAIL]'
AND created_at > now() - interval '2 minutes';
```
**Goal:** Should be > 0 (extracting real tasks)

#### Query 4: Errors
```sql
SELECT COUNT(*) as errors FROM debug_logs 
WHERE created_at > now() - interval '2 minutes'
AND data->>'error' IS NOT NULL;
```
**Goal:** Should be 0 or very few

---

## 🚨 If Something's Wrong

### ❌ No Ghost Tasks Being Created
```
Symptom: Ghost task count stays at 0
Action:
  1. Check sync function logs in Supabase
  2. Look for "TASK_CATEGORIZED" events in debug_logs
  3. Check if LLM API is responding
  
SQL to investigate:
SELECT event, COUNT(*), MAX(created_at)
FROM debug_logs
WHERE created_at > now() - interval '5 minutes'
GROUP BY event;
```

### ❌ Queue Not Draining
```
Symptom: Sync queue stays full after 5 minutes
Action:
  1. Check background_worker Edge Function logs
  2. Verify database connections are working
  3. Check for API rate limits
  
SQL to investigate:
SELECT user_id, status, retry_count FROM sync_queue LIMIT 10;
```

### ❌ High Error Rate
```
Symptom: Error count > 10% of requests
Action:
  1. Check debug_logs for error types
  2. Look for 401 (auth), 429 (rate limit), 500 (server)
  3. Check LLM API status
  
SQL to investigate:
SELECT data->>'error' as error_type, COUNT(*)
FROM debug_logs 
WHERE created_at > now() - interval '5 minutes'
AND data->>'error' IS NOT NULL
GROUP BY data->>'error';
```

### ❌ Stuck Locks
```
Symptom: Some users' syncs are frozen
Action:
  1. Find stuck locks
  2. Manually unlock if > 5 minutes old
  
SQL to find:
SELECT user_id, sync_lock_at FROM user_settings
WHERE sync_in_progress = true 
AND sync_lock_at < now() - interval '5 minutes';

SQL to fix (one at a time):
UPDATE user_settings 
SET sync_in_progress=false, sync_lock_at=NULL 
WHERE user_id='[USER_ID]';
```

---

## ✅ Success Checklist (After 10 minutes)

- [ ] Queue count is decreasing (or near 0)
- [ ] Ghost tasks count > 0 and growing
- [ ] Real tasks count > 0 and growing
- [ ] Error rate < 5%
- [ ] No stuck locks (sync_in_progress = false for all users)
- [ ] No 500 errors in logs
- [ ] WORKER_DONE events appearing in debug_logs
- [ ] No user complaints in monitoring

---

## 📊 Key Metrics Dashboard

Create a quick dashboard view by bookmarking this SQL:

```sql
SELECT 
  'Queue: ' || (SELECT COUNT(*) FROM sync_queue WHERE status='pending') as metric1,
  'Done: ' || (SELECT COUNT(*) FROM sync_queue WHERE status='done') as metric2,
  'Ghosts: ' || (SELECT COUNT(*) FROM tasks WHERE status='ignored' AND title='[IGNORED_EMAIL]') as metric3,
  'Real: ' || (SELECT COUNT(*) FROM tasks WHERE status='pending' AND title != '[IGNORED_EMAIL]') as metric4,
  'Errors: ' || (SELECT COUNT(*) FROM debug_logs WHERE created_at > now() - interval '5 minutes' AND data->>'error' IS NOT NULL) as metric5;
```

---

## 🎯 Expected Sequence (First 10 Minutes)

```
T+0 min:     Deployment complete
             ✅ Queue: 20 Pending | Done: 0 | Ghosts: 0 | Real: 0

T+1 min:     Background worker picks up first jobs
             ✅ Queue: 15 | Done: 5 | Ghosts: 5 | Real: 2

T+3 min:     Multiple batches processed
             ✅ Queue: 5 | Done: 15 | Ghosts: 30 | Real: 18

T+5 min:     Queue nearly drained
             ✅ Queue: 0-2 | Done: 18-20 | Ghosts: 45 | Real: 35

T+10 min:    Stable state
             ✅ Queue: 0 | Done: 20 | Ghosts: 60+ | Real: 50+
```

---

## 🔴 Red Flags (Stop and Investigate)

- [ ] Queue not decreasing after 5 minutes
- [ ] Ghost tasks never created after 3 minutes
- [ ] Error rate > 20% at any point
- [ ] Multiple 500 errors in logs
- [ ] Users report sync still frozen
- [ ] sync_in_progress = true for all users

---

## 💡 Pro Tips

1. **Use Supabase SQL Editor** for real-time monitoring
2. **Set up a timer** for 2-min intervals
3. **Keep browser tab open** to all 4 queries
4. **Don't panic** - system stabilizes after ~10 min
5. **Note timestamps** if you spot issues

---

## 📞 Quick Help

**Still seeing problems after 15 minutes?**

Check this escalation order:
1. → Look at Edge Function logs (sync)
2. → Check debug_logs for error types
3. → Verify database connectivity
4. → Check API key status
5. → Review background_worker logs

---

**You're doing great! Monitor for 10 more minutes and report status. 🚀**
