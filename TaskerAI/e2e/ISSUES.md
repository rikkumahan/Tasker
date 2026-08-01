# TaskerAI E2E — Issues Found

Issues found while manually walking through screens on a real Android device
(Expo Go) during E2E test-case authoring. Not bugs found via code review —
these are things observed live on-screen.

Device: Realme RMX3842, Android, Expo Go (SDK 54), host.exp.exponent.

---

## ISSUE-1: Task card action button clipped off-screen when sender name is long

**Screen:** Tasks tab, task list item
**Task:** "BANK DETAILS REQUIRED FOR 3rd YEAR FEE PAYMENT" (sender: `"Bh - Seethanagaram [Union Bank Of India]"`)

The sender/subtitle text on this card is unusually long, and it pushes the
priority badge and the "View →" action button off the right edge of the
screen. Confirmed via view hierarchy (`inspect_screen`), not just visually:

- On normal cards (e.g. "Don't choke"), the priority badge is ~114px wide
  (`[481,1563][595,1624]`) and the "View →" button is a separate clickable
  element with visible bounds (`[783,1553][984,1633]`).
- On this card, the priority badge is squeezed to 32px wide at the very edge
  (`[1000,1841][1032,1902]`, text bounds only 8px wide — effectively
  unreadable), and **there is no "View →" clickable element in the tree at
  all** — it's not just visually clipped, it isn't rendered/tappable.
- The card's `content-desc` (accessibility label) still lists `"...Low, View
  →"`, so the button is expected to exist — it's a rendering/layout bug, not
  intentionally hidden.

**Likely cause:** the row layout (sender name + priority badge + action
button) doesn't wrap/truncate the sender name, so a long sender string
overflows and squeezes siblings out of the flex row.

**Impact:** users can't act on a task if its sender/subject text is long
enough — no way to tap into it from the list (may still be reachable by
tapping the card body itself, not verified).

**Suggested fix area:** `TaskerAI/components/TaskList.js` — sender name text
should `numberOfLines={1}` + `ellipsizeMode` with a fixed/flex-shrink-0 width
reserved for the badge + action button, not the reverse.

## ISSUE-2: Raw email header artifacts (literal quotes) shown as contact/sender name

**Screens:** Tasks tab (task card) AND People tab (contact list) — confirmed in both
**Severity:** medium — systemic across the People list, not isolated

On the Tasks tab, sender displays as the literal string `"Bh - Seethanagaram
[Union Bank Of India]"` — including the surrounding double quotes and square
brackets. Every other card in the same list shows a clean sender name (e.g.
`animesh_kumar`, `Heroku Notifications`, `Vinh Giang`).

Confirmed the same pattern independently on the **People** tab, where it's
not a one-off: 2 of the first 6 contacts in the list have literal quote
marks baked into the displayed name:
- `"Bh - Seethanagaram [Union Bank O..."` (truncated in list view)
- `"Dan Barahona, APIsec University"`

...while other contacts in the same list (`animesh_kumar`, `Christine
Bevilacqua`, `Elytespark Innovations`, `Heroku Notifications`) show clean
names. This looks like an unparsed/unsanitized `From:` header display-name
(common when a header is `"Display Name" <email@x.com>` and the quotes
aren't stripped before storing the contact's display name).

**Suggested fix area:** wherever the `From` header display name is parsed
and persisted as a contact/person name (likely `supabase/functions/_shared/`
sync/extraction code, and wherever the `people`/contacts table is
populated) — strip surrounding quotes before storing/displaying.

## ISSUE-3: Project descriptions leak raw LLM/graph-extraction output (truncated JSON or prompt fragment)

**Screen:** Projects tab, project card description text
**Severity:** high — systemic, not a one-off (confirmed on 2 of 4 visible projects)

Two of the four project cards end their description with a corrupted
fragment `)\n## ("entity`:

- "Daily Sync - Rithvik": `"Daily Sync meeting, Rithvik, Tuesday 16 Jun 2026
  2:15pm - 2:30pm, India Standard Time - Kolkata)\n## (\"entity"`
- "TASKER": `"task management project)\n## (\"entity"`

Confirmed via view hierarchy text (`inspect_screen`), not a screenshot
rendering artifact — the actual TextView content contains this. The pattern
(`)`, a markdown `##` heading marker, and an opening `("entity`) strongly
suggests raw output from the graph/entity-extraction LLM call is being
truncated mid-response and stored/displayed as-is instead of being parsed,
or a prompt/response boundary is being sliced at a fixed character count
that lands inside the next JSON/markdown block.

The other two projects ("IBM certification", "IBM Internship 2026") have
clean, properly-formed one-sentence descriptions — so this isn't every
project, but it's not rare either (2/4 in one small sample).

**Impact:** garbage/broken text visible directly in the main Projects list
UI — this is a data-quality bug in the extraction pipeline surfacing
directly to end users, not just a display glitch.

**Suggested fix area:** the graph/project-description generation path in
`supabase/functions/_shared/graph.ts` or wherever project descriptions are
synthesized from LLM output — check for truncation of the LLM response
before JSON-parsing/storing the description field, and validate the field
doesn't contain unparsed markdown/JSON before persisting.

---

## ISSUE-4: Onboarding "Building your workspace…" loader can hang indefinitely on 0%

**Screen:** `app/(onboarding)/progress.js`
**Severity:** high
**Reported as:** GitHub issue #4 ("i1") — screenshot showed the loader stuck
at "Fetching emails" / 0% complete, with report text: "1. Loader 2. Correct
overall backend integration with the frontend in this particular case. 3.
Apply the 5 WHY PRINCIPLE."

**Verified — root cause traced (5 Why), shared with ISSUE-5:**

1. **Why does the loader hang?** The user's `sync_queue` job for
   continued/catchup email processing never gets picked up by
   `background_worker`.
2. **Why doesn't `background_worker` pick it up?** The *reactive* trigger
   that's supposed to wake it immediately after enqueue
   (`supabase/functions/sync/index.ts:275-277`, and the equivalent in
   `webhook_ingest/index.ts:60-61`) is fire-and-forget —
   `supabaseAdmin.functions.invoke("background_worker", {...}).catch(e =>
   console.warn(...))` — any transient failure (cold start, network blip) is
   silently swallowed. No retry, no user-visible error.
3. **Why isn't a missed reactive trigger a problem?** It shouldn't be — there's
   a 10-minute cron failsafe (`tasker-queue-pulse`, see ISSUE-5) specifically
   designed to catch exactly this case and re-fire the worker.
4. **Why doesn't the failsafe catch it?** It's broken — see ISSUE-5, the cron
   job's HTTP call to `background_worker` returns 401 on every single
   invocation, confirmed live in Supabase Logs.
5. **Root cause:** the one retry/self-healing path for a stuck onboarding
   sync is non-functional, so any transient failure of the initial reactive
   trigger leaves the user stuck on this screen with no recovery until app
   restart (which re-triggers `bootstrapUser`/`checkSyncHealth`, not a queue
   drain) or manual intervention.

**Suggested fix area:** fix ISSUE-5 first (it's the actual break); this
screen's own logic is not implicated.

---

## ISSUE-5: `background_worker` edge function returns 401 on every cron-triggered invocation

**Screen:** N/A — backend, but the direct cause of ISSUE-4's stuck loader
**Severity:** critical
**Reported as:** GitHub issue #5 ("i2") — Supabase Logs screenshot showed 5
consecutive `POST 401` entries against
`.../functions/v1/background_worker`, exactly 10 minutes apart
(10:10, 10:20, 10:30, 10:40, 10:50).

**Verified — root cause traced (5 Why):**

1. **Why 401?** The Supabase API gateway rejects the request before
   `background_worker`'s own code (which performs no auth check itself —
   see its file comment: "Draining the queue is completely safe to trigger
   externally... requires zero parameters") ever runs.
2. **Why does the gateway reject it?** `background_worker` is not listed in
   `supabase/config.toml`'s `verify_jwt = false` exemptions (only
   `webhook_ingest` and `delete-account` are) — so it defaults to requiring
   a valid, signed JWT in the `Authorization` header.
3. **Why is there no valid JWT on this request?** Pulled the live cron job
   definition directly from the database (`cron.job`, jobid 3, name
   `tasker-queue-pulse`, schedule `*/10 * * * *`):
   ```sql
   SELECT net.http_post(
     url     := 'https://esngoeuhtpdzyfttofyu.supabase.co/functions/v1/background_worker',
     headers := jsonb_build_object('Content-Type', 'application/json'),
     body    := '{}'::jsonb
   )
   WHERE EXISTS (SELECT 1 FROM sync_queue WHERE status = 'pending' LIMIT 1);
   ```
   The `headers` object sets only `Content-Type` — no `Authorization`, no
   `apikey`. Every invocation of this cron job is guaranteed to 401.
4. **Why does this matter more than a generic missing header?** The
   `WHERE EXISTS (...)` clause means this job only fires when there's
   actually a pending backlog — i.e. it only tries to run in exactly the
   scenario where the queue needs rescuing. The one mechanism designed to
   self-heal a stuck queue is broken specifically when it's needed.
5. **Root cause:** `background_worker`'s "safe to call externally, no auth
   needed" design intent (stated in its own code) was never reconciled with
   deployment reality — it needed either `verify_jwt = false` added to
   `config.toml` for this function, or the cron's `net.http_post` call
   needed a service-role `Authorization`/`apikey` header (matching how
   `webhook_ingest`'s own reactive trigger correctly authenticates via
   `supabaseAdmin.functions.invoke(...)`, which uses the service-role key
   configured on that client). Neither happened.

**Suggested fix area:** `supabase/migrations/` — update the
`tasker-queue-pulse` cron job's `net.http_post` call to include
`'apikey': '<service-role-key>', 'Authorization': 'Bearer <service-role-key>'`
in `headers` (pull the key via Vault/`current_setting`, don't hardcode it in
a migration file), **or** add `[functions.background_worker]
verify_jwt = false` to `supabase/config.toml` to match the function's own
stated design intent.

**Status:** ✅ Fixed (staged) — took the `verify_jwt = false` route (simpler,
no secret handling needed in a migration, matches the existing
`webhook_ingest`/`delete-account` pattern). RED confirmed live 2026-07-17:
called `background_worker` with the cron job's exact header shape
(`Content-Type` only) and got `401 UNAUTHORIZED_NO_AUTH_HEADER`. Fix staged
in `supabase/config.toml`; needs
`npx supabase functions deploy background_worker --project-ref esngoeuhtpdzyfttofyu --no-verify-jwt`
to go live (redeploy needed — `config.toml` alone doesn't change the
already-deployed function). Regression test:
`supabase/functions/tests/test-background-worker-auth.ts`. This also closes
ISSUE-4 — no separate fix needed there.

---

## ISSUE-6: Multi-user data exposure — two independent, compounding causes

**Screens:** reported on mobile (persistent) and web (momentary — "states
loaded and displayed the same [as another user's]... something is missing")
**Severity:** critical
**Reported as:** GitHub issue #6 ("i3", critical) — "Multi-user data
exposure bug. (This is not a simple-to-leave bug, which leads to an overall
architectural fault)... APPLY 5 WHY PRINCIPLE."

**Verified — this is two separate, compounding bugs, not one:**

**Layer 1 — backend (already root-caused and documented in
`SUPABASE_LOGIC_BUGS_FINDINGS.md`):** any authenticated user can read
another user's contacts/projects/threads/tasks/community data via
`graph-debug/index.ts`'s unscoped handlers (finding #1), and — worse —
`get_related_graph_context` can be called by *anyone holding the public
anon key, no login required at all* (finding #16), because its
`assert_user_scope` guard was silently dropped by an untracked migration.
Root cause there: `graph-debug`/`query`/`api`/`synthesize_profile` all use
the service-role Supabase client, which bypasses RLS entirely (finding #9)
— app-layer `user_id` filtering is the *only* protection, and in these
cases it's missing.

**Layer 2 — frontend (new, verified this session): stale cross-account
client state.** Traced via 5 Why:

1. **Why would a user briefly see another user's data on the same device?**
   `useAppStore` (`TaskerAI/store/appStore.js`) — `threads`, `contacts`,
   `projects`, `tasks`, etc. — is never cleared when the signed-in user
   changes.
2. **Why isn't it cleared?** `authStore.js`'s `onAuthStateChange` handler
   (line 52-56) resets its *own* store's fields (`wizardStep`, session) on
   `SIGNED_OUT`, but never calls into the separate `useAppStore` to clear
   its arrays — the two Zustand stores are independent and nothing bridges
   them on sign-out or sign-in.
3. **Why does it eventually show the right data, then?** Both
   `app/(tabs)/_layout.js:48` and `app/_layout.web.js:43` call `fetchAll()`
   in a `useEffect` keyed on `[session, ...]`, so a session change does
   trigger a refetch that overwrites the stale arrays with the new user's
   data.
4. **Why is there a visible gap at all?** `fetchAll()` is async. Between the
   session changing (React re-render with the new `session`) and that fetch
   resolving, the UI renders the *previous* user's already-cached arrays
   under the *new* user's now-authenticated identity — this is exactly the
   "instant" flash reported on web. On mobile, this window can be longer
   (slower network/cold start) or, if a given screen never remounts, may not
   self-correct without a manual pull-to-refresh.
5. **Root cause:** `useAppStore` was built as a fetch-and-cache store with no
   lifecycle hook tied to identity — it implicitly assumes one continuous
   session per app lifetime. No code path calls a `reset()`/clear on
   `SIGNED_OUT` or before a new user's `fetchAll()` starts.

**Status:** ✅ Fixed (frontend layer only) — added `reset()` to `useAppStore`
(`TaskerAI/store/appStore.js`) clearing `threads`/`contacts`/`projects`/
`userSettings`/`loading`/`refreshing`/`error`/`_lastFetchedAt` back to their
initial values, and wired it into `authStore.js`'s `onAuthStateChange` on
`SIGNED_OUT`; covered by `TaskerAI/store/__tests__/appStore.test.js` and
`TaskerAI/store/__tests__/authStore.test.js`. Backend layer (finding #1, #6,
#9, #16 in `SUPABASE_LOGIC_BUGS_FINDINGS.md`) is unfixed here.

**Why this matches "not a simple-to-leave bug... architectural fault":**
these two layers are independent — fixing one does not fix the other. The
backend layer leaks data to *any* authenticated (or, per finding #16,
*unauthenticated*) user regardless of what's cached on their device; the
frontend layer leaks data across account switches on a *single* device
regardless of whether the backend is fixed. Both need fixing.

**Suggested fix area:**
- Backend: apply the fixes already specified in `SUPABASE_LOGIC_BUGS_FINDINGS.md` findings #1, #6, #9, #16.
- Frontend: add a `reset()` action to `useAppStore` that clears
  `threads`/`contacts`/`projects`/`tasks`/etc back to their initial empty
  state, and call it from `authStore.js`'s `onAuthStateChange` handler on
  `SIGNED_OUT` (and/or immediately before the `fetchAll()` triggered by a
  new `SIGNED_IN` session), so no screen can render stale data under a
  different user's identity even for an instant.

---

*GitHub issue #7 ("i4 (Happy)") — "task read/unread" — is a feature request,
not a bug found via E2E testing, and isn't included above.*
