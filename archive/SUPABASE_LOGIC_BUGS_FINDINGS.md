# Tasker logic-bug findings — edge functions, database, and TaskerAI frontend

Findings from the `code-logic-catcher` and `db-auditor` subagents. Scope: provable behavioral defects only — no style/readability/over-engineering findings (those live in `CODE_REVIEW_FINDINGS.md`). Numbering is continuous across sections in the order findings were discovered.

**Coverage:** `supabase/functions/` (full, self-checked inventory), the live database (full, self-checked inventory), and `TaskerAI/` (`app/`, `components/`, `store/`, `lib/`, `hooks/`, root entry points — full, self-checked inventory; `e2e/`/`android/`/`ios/` out of scope as test scaffolding/native platform code). `execution/` and `directives/` were checked and excluded deliberately: `execution/` is a stale, superseded migration history (last touched 2026-05-25, overlapping version numbers with the actively-developed `supabase/migrations/`) with zero references from any live code; `directives/` are markdown SOPs meant to be read by an AI assistant, not application logic — neither has anything for a code-logic hunt to trace.

## Edge Functions (`supabase/functions/`)

### 1. 🔴 Critical — cross-tenant data leak (IDOR)

**`supabase/functions/graph-debug/index.ts`, lines 64-269**

`Deno.serve` only requires `authenticateUser(req, ...)` to succeed — i.e. *any* logged-in Tasker user, not an admin. Five of the six action handlers then query global tables with **no `user_id` filter at all**:

- `handleStats` (64-103): counts `contacts`/`projects`/`threads`/`emails`/`graph_edges`/`community_reports`/`community_members` across **all users**.
- `handleListCommunities` (105-121): selects from `community_reports` with no `eq("user_id", ...)` — returns every user's community report titles/summaries/ratings.
- `handleNeighborhood` (141-157) / `handleTimeline` (159-171): call `get_entity_neighborhood`/`get_entity_timeline` RPCs via the **service-role** client with only a caller-supplied `id`/`hops`/`limit` — no `user_id` passed.
- `handleInspectNode` (186-269): looks up `contacts`/`projects`/`threads`/`tasks` **by `id` or `name`** with `ilike`, again with no `user_id` scoping — lets one user pull another user's contact bio, org, thread subjects, task titles, and graph edges.

Contrast with `handleRebuildCommunities` (123-139) in the *same file*, which correctly does `store.buildCommunities(user.id)` and filters by `.eq("user_id", user.id)` — proving per-user isolation was the intended design, just not applied to the other five handlers.

**Correction (from the follow-up database audit, finding #9):** `handleNeighborhood`/`handleTimeline` were re-verified by directly calling the live RPCs. `get_entity_neighborhood`/`get_entity_timeline` have no default for `p_user_id` and PostgREST rejects the exact call shape these two handlers use (`function ... does not exist`) — so **these two are currently broken (return a 500), not silently leaking**. `handleStats`, `handleListCommunities`, and `handleInspectNode` remain confirmed, currently-live leaks.

**Expected:** every handler scopes reads to the authenticated caller's own data.
**Actual:** `handleStats`/`handleListCommunities`/`handleInspectNode` leak every user's contacts, projects, threads, tasks, and community intelligence to any other authenticated user; `handleNeighborhood`/`handleTimeline` are broken rather than leaking, but one careless fix away from becoming a live leak too (see finding #9 — they'd inherit the same missing backstop).
**Fix:** thread `user.id` into every query/RPC in `graph-debug/index.ts` (`.eq("user_id", user.id)` on table queries; add a `p_user_id` param to `get_entity_neighborhood`/`get_entity_timeline` and filter server-side).

**Status:** ✅ Fixed (code) — `handleStats`/`handleListCommunities`/`handleInspectNode` in `supabase/functions/graph-debug/index.ts` now `.eq("user_id", user.id)` (or equivalent) on every query, confirmed by diff against the pre-fix version. `handleNeighborhood`/`handleTimeline` intentionally left untouched — they're currently broken (500), not leaking, and adding a `p_user_id` param requires migrating `get_entity_neighborhood`/`get_entity_timeline` themselves (not done this pass, tracked as follow-up). **Live cross-tenant verification still needed post-deploy** — code fix confirmed by inspection, but proving it end-to-end requires two real authenticated sessions, which weren't available in this pass.

### 2. 🟠 PII gap — phone/email/name in URLs not redacted outside meeting domains

**`supabase/functions/_shared/pii.ts`, lines 101-131**

The exemption comment says it should apply "ONLY on true meeting hostnames," and `GENERIC_API_KEY` is correctly gated that way. The PHONE/EMAIL/NAME lines have no such gate:

```js
const safeDetections = urlDetection.detections.filter(d =>
  !d.type.startsWith("PHONE") &&
  !d.type.startsWith("EMAIL") &&
  !d.type.startsWith("NAME") &&
  !(isMeetingDomain && d.type === "GENERIC_API_KEY")
);
```

`includePhones: true` is enabled and `PHONE_US`/`PHONE_UK`/etc. are in the active `patterns` whitelist, so this is live. Concrete input: `"Visit https://tracking.example.com/deliver?contact=5551234567 for status."` — the phone number is restored verbatim into the redacted text.

**Expected:** phone numbers inside non-meeting URLs get redacted like everywhere else.
**Actual:** phone numbers embedded in any URL are never redacted, leaking into the LLM prompt and any persisted redacted text.
**Fix:** gate the PHONE branch the same way GENERIC_API_KEY is gated: `!(isMeetingDomain && d.type.startsWith("PHONE"))`.

### 3. 🟠 PII gap — URL-prefix collision corrupts/discards redaction

**`supabase/functions/_shared/pii.ts`, lines 134-141**

If a shorter matched URL is a literal prefix of a longer one appearing later in the text, the first `replaceAll` corrupts the longer URL's occurrence before it gets its own redaction pass, and the fully-redacted version of the longer URL is computed but never spliced back in — its raw tail leaks in plain text.

**Expected:** every extracted URL is safely redacted and restored intact.
**Actual:** prefix collisions silently corrupt/truncate the longer URL and discard its computed redaction.
**Fix:** process URLs longest-first (sort `uniqueUrls` by length descending), or replace by matched index positions instead of string content.

### 4. 🟠 PII gap — dead signature-stripping regex

**`supabase/functions/_shared/utils.ts`, lines 67-86**

The delimiter-blanking `replace` runs first and destroys the exact `-{2,}`/`_{2,}` pattern the subsequent `sigIdx` search looks for, so `if (sigIdx > 0)` is always false and the signature block is never truncated.

**Expected:** content after a `--`/`__` signature delimiter is dropped before being sent to the LLM.
**Actual:** only the delimiter line itself is blanked; the entire signature block (names, titles, phone numbers, addresses) still flows into extraction.
**Fix:** run the `sigIdx` search *before* the delimiter-blanking replace, or fold both into one pass.

### 5. 🟡 Dead guardrail

**`supabase/functions/sync/index.ts`, lines 18-19, 406, 520, 524**

`MAX_CONSECUTIVE_SKIPS`/`DEDUP_THRESHOLD` are declared and `consecutiveSkips` is tracked, but neither constant is ever read/compared anywhere in the file.

**Expected (per comment):** after 3 consecutive skipped threads, some fallback/guardrail behavior kicks in.
**Actual:** no such behavior exists; the tracked state is inert.
**Fix:** implement the guardrail or remove the misleading dead constants/counter.

### 6. 🟠 HIGH — `authenticateUser` never verifies the JWT signature

**`supabase/functions/_shared/auth.ts`, lines 12-47**

The "fast path" base64-decodes the JWT payload and trusts `payload.sub` as identity, never checking the signature (`parts[2]`) against the JWT secret. Any three-part token with a valid-base64 middle segment containing a `sub` field is accepted. This is the sole authorization gate for `query/index.ts`, `api/index.ts`, and (duplicated inline) `synthesize_profile/index.ts`, and is behind the finding #1 IDOR.

**Caveat:** `supabase/config.toml` defaults these functions to `verify_jwt = true` at the gateway, so a forged-signature token is currently rejected before this code runs — not live-exploitable today. But the app layer performs zero independent verification, and the team has toggled `--no-verify-jwt` per-function outside `config.toml` before (for `sync`), so this is one deploy-flag flip from becoming exploitable with no backstop. **See finding #9 — the database provides no independent backstop either**, since these functions run under the RLS-bypassing service-role key.

**Expected:** the shared auth helper independently verifies the JWT signature.
**Actual:** the fast path trusts an unverified payload; verification only happens today because of an external, undocumented gateway setting.
**Fix:** verify the signature in `authenticateUser` itself (e.g. `jose`/`djwt` HS256 against `SUPABASE_JWT_SECRET`); delete the duplicate unsafe copy in `synthesize_profile/index.ts`.

**Status:** ✅ Fixed, corrected once post-deploy — first version only implemented HS256 verification against `SUPABASE_JWT_SECRET`. Post-deploy verification (checking the project's actual `Project Settings > JWT Keys` and the public `/auth/v1/.well-known/jwks.json` endpoint) revealed this project's **current** signing key is ES256/ECC P-256 — HS256 is only the *previous* key, kept solely to verify tokens issued before rotation. The first version silently no-op'd for every real (ES256) user token, falling back to `auth.getUser()` every time — not a security regression, but the independent verification wasn't actually verifying anything live. Corrected: `supabase/functions/_shared/auth.ts` now verifies ES256 via the project's JWKS endpoint (cached, keyed by `kid`, native `crypto.subtle` ECDSA) as the primary path, with HS256/`SUPABASE_JWT_SECRET` kept as a fallback for any not-yet-expired legacy-signed tokens. `SUPABASE_JWT_SECRET` is no longer required for the fix to be effective — only needed if you want the legacy-key fallback path covered too. `synthesize_profile/index.ts`'s duplicate unverified decode block deleted, now calls `authenticateUser()`. Regression tests: `supabase/functions/tests/test-auth.ts` (forged HS256 signature, forged ES256 with untrusted `kid`, and `alg:none` rejection).

### 7. 🟡 MEDIUM — `delete-account` CORS header mismatch causes a false failure after the account is already deleted

**`supabase/functions/delete-account/index.ts`, lines 7, 45-53**

Only the OPTIONS preflight branch passes `req` to `getCorsHeaders()`; both real-response branches don't, so any client whose origin isn't the hardcoded prod URL/`ALLOWED_ORIGIN` fallback gets a false CORS rejection on a call that already deleted their account server-side.

**Expected:** the actual response's CORS header matches the preflight's.
**Actual:** the account/data is already deleted, but the browser rejects the response as a CORS violation before the frontend ever sees success.
**Fix:** pass `req` to both `getCorsHeaders()` calls (or hoist `const corsHeaders = getCorsHeaders(req)` once, as `query/index.ts`/`labels/index.ts`/`synthesize_profile/index.ts` already do).

### 8. ⚪ LOW — `webhook_ingest` has no verification a request came from Google Pub/Sub

**`supabase/functions/webhook_ingest/index.ts`, entire handler**

`verify_jwt = false` is set for this function and the handler performs no check of any kind (confirmed via grep — zero matches for token/secret/Authorization checks). Any unauthenticated POST with a well-formed payload can force an on-demand sync for a guessed user, burning the shared Groq key pool.

**Expected:** the handler verifies the request originates from the registered Pub/Sub push subscription.
**Actual:** no verification code exists.
**Fix:** add Pub/Sub OIDC token validation or a shared-secret check.
**Confidence note:** low severity/confidence — can't confirm from the repo alone whether IAM restricts the invocation URL upstream.

### Checked, no provable bug found (Edge Functions)

- **`_shared/llm.ts`** — mentally executed `callLLM` for `maxAttempts` = 1, 2, 3+ (backoff via `retry-after` header vs. exponential fallback); attempt-counter/loop-exit ordering holds.
- **`_shared/actions.ts`** — traced `ActionReconciler.reconcile`'s `duplicate`/`update`/`promote`/`dedupe`/`create` branches and confidence clamping at boundary values 0, 0.35, 1; every mutation is `.eq("user_id", userId)`-scoped.
- **`_shared/graph.ts`** — traced `parseGraphTriplets` on empty/malformed/dangling-relationship inputs; `resolveContact`/`resolveProject` traced through email/name/embedding-match/insert, all `user_id`-scoped; `runLouvain`'s single-aggregation-pass design is an intentional simplification, not a bug.
- **`_shared/keys.ts`** — traced `getNextKey()` round-robin across 1/2/4 configured keys including empty env vars; wraps correctly.
- **`_shared/oauth.ts`** — traced `refreshGmailToken` success, `invalid_grant`, and other non-OK responses.
- **`_shared/cors.ts`** — traced origin matching for listed/unlisted/localhost/no-origin requests; the file's own logic is correct — finding #7's bug is in a caller's misuse of the default no-arg case.
- **`webhook_ingest/index.ts`** — traced the Pub/Sub base64 decode/padding and branch logic; no defect in the ingestion path itself (separate auth-gap noted as finding #8).
- **`background_worker/index.ts`** — traced the claim/success/catchup-requeue/failure-with-backoff/dead-letter-after-3-strikes paths; retry counter and backoff math check out.
- **`labels/index.ts`** — uses `supabaseAdmin.auth.getUser(tokenStr)` directly (real signature verification, not the vulnerable fast-path helper); CORS correctly threaded via `req` throughout (contrast with finding #7).
- **`mobile-auth-bridge/index.ts`** — scheme allow-list traced; a lower-confidence open-redirect concern noted but not confirmable from the repo alone, not filed.
- **`api/index.ts`** — traced as consistently `user_id`-scoped downstream of `authenticateUser` (upstream issue is finding #6).
- **`query/index.ts`** — traced empty-state handling and 2-hop neighborhood `.in()` queries, consistently `user_id`-scoped (upstream issue is finding #6).
- **`synthesize_profile/index.ts`** — onboarding/chat-mode branching and JSON-extraction fallback traced correctly; auth logic is a byte-for-byte duplicate of finding #6, not a separate bug.
- **`_shared/stages.ts`** — hardcodes the old Groq model but is unreachable dead code (never imported by any `Deno.serve` entrypoint).

## Database

### 9. 🔴 Critical (structural) — RLS is not a backstop for the service-role edge functions

**`supabase/functions/graph-debug/index.ts:11-14`, `query/index.ts:14-17`, `api/index.ts:39-42`, `synthesize_profile/index.ts:20-23`**

All 13 `public` application tables have `rls_enabled: true` with correctly-scoped `auth.uid() = user_id` policies (verified via `pg_policies`). But every one of these four functions constructs its Supabase client with the **service-role key**:

```ts
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  (Deno.env.get("MY_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
);
```

Verified directly: `select rolname, rolbypassrls from pg_roles where rolname='service_role'` → `rolbypassrls = true`. Postgres skips RLS evaluation entirely for this role — the well-configured policies never run against these functions' queries, correct or not.

**Expected:** RLS provides defense-in-depth even if app-layer `user_id` filtering has a gap.
**Actual:** RLS provides **zero** protection for `graph-debug`/`query`/`api`/`synthesize_profile` — app-layer `.eq("user_id", ...)` is the *entire* security model for these functions. This is the reason findings #1 and #6 are as serious as they are: there is no second line of defense behind them. RLS is real protection only for direct PostgREST/client-SDK access using the anon/authenticated key (confirmed those grants are correctly gated).
**Fix:** either switch these functions to per-request authenticated clients (so RLS applies) instead of service-role, or treat app-layer `user_id` scoping as the sole enforcement point and audit it with the same rigor as a security boundary (which is what findings #1 and #6 are already doing).

**Status:** 🔲 Deferred — took the second option (app-layer scoping, audited/fixed in #1 and #6) rather than the architecture switch, to keep this pass's blast radius small (redeploying 4 functions' client construction is a bigger, riskier change than closing the actual leaks). RLS is still decorative for these 4 functions. Revisit switching to per-request authenticated clients as a follow-up hardening pass, not blocking.

### 10. 🟠 MEDIUM — 6 RPCs have mutable `search_path` (search-path hijack surface)

`get_entity_neighborhood`, `get_entity_timeline`, `wipe_user_data`, `find_path_between_entities`, `get_onboarding_queue_position`, `vault_store_gmail_token` are all `SECURITY DEFINER` with `proconfig: null` (no pinned `search_path`), confirmed via `pg_proc`. Most other `SECURITY DEFINER` functions in the project (`assert_user_scope`, `check_duplicate_action_item`, `claim_next_job`, `get_action_insights`, `match_*`, `ingest_gmail_webhook`, etc.) correctly set `search_path=public`. Notably, these six are exactly the RPCs at the center of the IDOR/auth findings above.

**Expected:** all `SECURITY DEFINER` functions pin `search_path=public`.
**Actual:** these six don't, leaving a (lower-severity, no demonstrated privilege-escalation vector) search-path-hijack surface.
**Fix:** add `SET search_path = public` to each function definition.

### 11. 🟡 MEDIUM — migration history doesn't reconcile with the repo

`supabase/migrations/` contains files `011`-`021` (two both prefixed `012`). The live project's `list_migrations` shows 16 applied entries, including `022_add_starred_threads`, `023_update_user_profile_default`, four separate applications of `024_create_active_threads_view`, and one entry named `extend_graph_context_2hop` — **none of these have a corresponding file in the repo**. Confirmed live and real (`threads.is_starred` exists, `active_threads` view exists). Conversely, `019_wipe_user_data_rpc.sql` and `021_queue_debounce.sql` exist as files but have **no corresponding applied-migration entry** — yet their functions (`wipe_user_data`, debounce-aware `ingest_gmail_webhook`) exist live.

**Expected:** the repo's migration files and the live applied-migration history reconcile in both directions.
**Actual:** rebuilding the DB from the repo alone would miss real, live schema; the repo has files whose tracking entries don't exist under their expected names.
**Fix:** reconcile — commit the missing migration files (`022`-`024`, `extend_graph_context_2hop`) and/or re-sync the migration history table.
**Related, minor:** `021_queue_debounce.sql` defines `ingest_gmail_webhook` via two consecutive `CREATE OR REPLACE FUNCTION` statements — the first is an incomplete stub, immediately overwritten by the second. Harmless in the end state (second wins) but dead/confusing scaffolding in a tracked file.

### 12. ⚪ LOW — `tasks` table is fully provisioned but dead

`tasks` (RLS enabled, 4 CRUD policies, 6 indexes, 3 FKs) has 0 rows and no live writer — its only writer was `_shared/stages.ts`, already confirmed unreachable dead code. The live task-tracking table is `action_items` (111 rows). Only `query/index.ts` and `graph-debug/index.ts` still `SELECT` from `tasks`.

**Expected:** provisioned tables are in active use.
**Actual:** `tasks` is a superseded/legacy table still fully wired in schema and RLS but doing nothing.
**Fix:** drop the table (after confirming no external consumer) or document why it's kept.
**Related, minor:** `tasks.source_email_id` has a bare `UNIQUE (source_email_id)` index, unlike `emails`/`contacts`'s correctly per-user composite uniqueness — not currently exploitable (source values are UUIDs) but an architectural inconsistency in an otherwise-unused table.

### 13. 🟡 Performance advisors (Supabase-authoritative, not independently re-derived)

- **8 unindexed FK columns**: `action_items.assignee_contact_id/email_id/thread_id`, `community_members.user_id`, `community_reports.user_id`, `emails.sender_id/thread_id`, `tasks.assignee_id/project_id`, `threads.project_id`, `user_settings.gmail_token_secret_id`.
- **`auth_rls_initplan` WARN** on `action_items`, `contacts`, `projects`, `threads`, `emails`, `community_reports`, `community_members`, `graph_edges` — these use bare `auth.uid()` in policies (re-evaluated per row) instead of `(select auth.uid())`; `tasks`/`user_settings`/`raw_emails`/`debug_logs`/`sync_queue` already use the optimized form.
- **5 unused indexes**: `idx_threads_user_is_read`, `contacts_embedding_idx`, `community_reports_embedding_idx`, `action_items_user_status_deadline_idx`, `community_members_community_idx`/`node_idx`.

**Fix:** add the missing FK indexes; rewrite the 8 flagged RLS policies to use `(select auth.uid())`; re-evaluate the unused indexes for removal once traffic patterns are confirmed.

### 16. 🔴 Critical — `get_related_graph_context` has no auth check at all; callable with just the public anon key, no login required

**Live DB function (no tracked migration file — see drift note below)**

No `PERFORM assert_user_scope(...)` anywhere in the live function body, unlike all 9 sibling `get_*`/`match_*`/`check_*` RPCs. The *tracked* source, `supabase/migrations/017_action_context_retrieval.sql:303-344`, **does** call `PERFORM assert_user_scope(p_user_id);` (line 322) and uses a simple 1-hop CTE. The **live** version instead uses a `WITH RECURSIVE hop` 2-hop CTE with the guard removed. `list_migrations` shows an applied migration `extend_graph_context_2hop` (version `20260607033722`) that must have introduced this change — but no file matching that migration exists anywhere in `supabase/migrations/` (same drift pattern as finding #11). A security-relevant change — deleting the one guard clause protecting the function — shipped entirely out-of-band, invisible to code review.

**Exploitability confirmed:** `has_function_privilege('anon', <oid>, 'EXECUTE')` = `true`. The function is `SECURITY DEFINER` (bypasses RLS on `graph_edges`/`contacts`/`projects`/`threads`/`action_items`) and never checks `auth.uid()`. Anyone holding only the public anon key (shipped in `TaskerAI/.env`/client bundle — no login required) can call `get_related_graph_context` with an arbitrary `p_user_id`/`p_thread_id` and read another user's graph neighborhood — contact names, project names, thread subjects, action-item descriptions. This is more severe than finding #1: that IDOR at least required a valid authenticated session; this one doesn't.

**Expected:** every `SECURITY DEFINER` RPC that takes a `p_user_id` enforces it via `assert_user_scope`, as all its siblings do.
**Actual:** the guard existed in the tracked source and was silently dropped by an untracked migration.
**Fix:** add `PERFORM assert_user_scope(p_user_id);` back (restore the tracked-source behavior), and commit the missing `extend_graph_context_2hop` migration file to close the drift.

**Status:** ✅ Fixed (staged) — `supabase/migrations/20260717120100_restore_graph_context_user_scope.sql` re-creates the live 2-hop function with the guard restored (verified against the live `pg_get_functiondef` output before writing it, so the 2-hop logic itself is preserved exactly). Not yet applied to the live DB — needs `apply_migration`/`supabase db push`, see deploy checklist.

### 17. 🟠 High — job-queue primitives (`claim_next_job`, `reset_stalled_jobs`, `reset_stuck_queue_jobs`) are EXECUTE-granted to `anon`

`has_function_privilege('anon', <oid>, 'EXECUTE')` = `true` for all three. None takes or checks a caller identity — they're meant to be called only by `background_worker` (service role) / `pg_cron` (confirmed: `cron.job` jobid 3 calls `reset_stuck_queue_jobs()` on a `*/10 * * * *` schedule). `sync_queue` has RLS enabled but `relforcerowsecurity=false`, so RLS provides no backstop for a `SECURITY DEFINER` function executing as table owner — the missing in-function check is the only gate, and there isn't one.

**Concrete impact:** an anonymous caller (anon key, no session) can call `claim_next_job()` directly, steal a real job via the same `FOR UPDATE SKIP LOCKED` claim used by the legitimate worker, and receive back `id`/`user_id`/`retry_count` — a direct cross-tenant `user_id` leak to an unauthenticated caller. Looped, this permanently starves the sync pipeline for every user. `reset_stalled_jobs()`/`reset_stuck_queue_jobs()` let anon force mass status resets on `sync_queue` at will (thrash/DoS).

**Expected:** internal queue-worker RPCs are reachable only by `service_role`.
**Actual:** `anon` and `authenticated` both have EXECUTE.
**Fix:** `REVOKE EXECUTE ON FUNCTION claim_next_job(), reset_stalled_jobs(), reset_stuck_queue_jobs() FROM anon, authenticated;`

**Status:** ✅ Fixed (staged) — `supabase/migrations/20260717120000_revoke_anon_queue_rpcs.sql`. RED re-confirmed live via `has_function_privilege('anon', ..., 'EXECUTE')` on 2026-07-17 before writing the fix (all 3 returned `true`). Not yet applied to the live DB, see deploy checklist.

### 18. 🟡 Medium — `reset_stalled_jobs` measures staleness from `created_at`, not `updated_at`; can resurrect a job that just started processing

```sql
UPDATE sync_queue SET status = 'pending'
WHERE status = 'processing'
AND created_at < NOW() - INTERVAL '5 minutes';
```

`claim_next_job()` sets `status='processing', updated_at=now()` at claim time but never touches `created_at`. Concrete trace: a job enqueued at `T`, sits `pending` for 6 minutes under load, gets claimed at `T+6min`. One second later, `reset_stalled_jobs()`'s condition (`created_at(T) < now()-5min`) is true even though the job has been processing for 1 second — it flips back to `pending` while a real worker may still be actively working it.

**Contrast:** `reset_stuck_queue_jobs` (the one actually wired into the cron job, `supabase/migrations/018_repair_webhook_queue_worker.sql:5-25`) correctly uses `updated_at`, tracking time-since-claim rather than time-since-creation — the fixed version.

**Drift context:** `reset_stalled_jobs` has zero occurrences in `supabase/migrations/*.sql` and zero call sites in `supabase/functions/` — untracked, dead from the app's perspective, but per finding #17 directly callable by anyone with the anon key, so live/reachable regardless.

**Expected:** staleness is measured from when a job started processing.
**Actual:** measured from when it was originally created, causing false-positive resurrection under queue backlog.
**Fix:** drop the untracked `reset_stalled_jobs` (superseded by `reset_stuck_queue_jobs`), or fix the column to `updated_at` and commit it to a migration.

### 19. ⚪ Low — `get_sender_context` uses `INNER JOIN contacts` where sibling `get_thread_context` uses `LEFT JOIN` for the identical relationship

Both key off the same nullable FK (`emails.sender_id`, confirmed `is_nullable = YES`). Live data currently has 0 rows with `sender_id IS NULL` (0/444), so not provably live today — but the inconsistency is real: an email ingested with an unresolved sender would silently drop from `get_sender_context`'s results while still appearing via `get_thread_context`.

**Fix:** change to `LEFT JOIN contacts` in `get_sender_context` for consistency, or explicitly enforce `sender_id` non-null.

### Checked, no provable issue found (RPCs)

- **`assert_user_scope`** — traced role/uid logic directly: `service_role` bypass only fires when the JWT role claim literally equals `service_role`; otherwise requires `auth.uid() = p_user_id` and raises otherwise. Traced anon-only, authenticated-wrong-uid, and authenticated-matching cases — correctly implemented. The gap is that it's *not called* where it should be (findings #16, #17), not a flaw in the function itself.
- **`match_action_items`, `match_contacts`, `match_emails`, `match_community_reports`** — all four call `assert_user_scope(p_user_id)` and independently filter `WHERE x.user_id = p_user_id` alongside vector similarity; traced the `similarity == match_threshold` boundary (inclusive, correct) and `embedding IS NULL` exclusion. No cross-tenant leak possible even via direct PostgREST call.
- **`get_action_insights`** — traced the join fan-out and `GROUP BY`; every join leg `user_id`-scoped, `assert_user_scope` gate present.
- **`get_pending_deadlines`** — gate present; `is_overdue`/`days_remaining` boundary math traced at `deadline == today` and `deadline < today` — correct.
- **`get_thread_context`** — gate present; `LEFT JOIN contacts` (sender optional) vs. `JOIN threads` (thread membership mandatory) is intentional for the RPC's stated purpose.
- **`check_duplicate_action_item`** — gate present; `sim_threshold` boundary (inclusive) and best-match `ORDER BY`/`LIMIT 1` traced correctly.
- **`claim_next_job`** — concurrency-traced: `FOR UPDATE SKIP LOCKED` correctly prevents two concurrent callers from claiming the same row. The primitive itself is sound; the authorization gap around it is finding #17.
- **`refresh_thread_action_projection`** — gate present; urgency ladder (`URGENT`/`HIGH`/`MEDIUM`/`LOW`) boundary-traced at `deadline == today`, `today+2`, `today+3` — internally consistent.
- **`refresh_thread_action_projection_from_action_item`** — trigger function; despite an anon EXECUTE grant at the ACL level, Postgres rejects direct invocation of trigger-typed functions outside trigger context, so the grant is inert. `INSERT`/`UPDATE`/`DELETE`/cross-thread-move branches traced correctly.
- **`reset_stuck_queue_jobs`** — query logic itself confirmed correct (uses `updated_at`, matches tracked migration `018` verbatim). Only issue is the anon EXECUTE grant (finding #17), not the logic.

**Self-check:** all 16 named RPCs accounted for above (findings #16-19, or in the checked-clean list). `get_advisors(security)` was pulled but its `function_search_path_mutable` lints don't cover any of these 16 (all already pin `search_path=public`) — the anon-EXECUTE-grant and dropped-guard issues are advisor blind spots this pass caught manually; advisors don't diff live function bodies against tracked migration source or reason about grant appropriateness.

### Checked, no provable issue found (Database)

- **RLS presence/policies** on all 13 public tables — every table has `rls_enabled=true`; all except `sync_queue` (intentionally INSERT-only + service-role) have complete CRUD policies scoped `auth.uid() = user_id`.
- **`sync_queue`** missing SELECT/UPDATE/DELETE policy for regular users — confirmed no frontend/edge-function code queries it as anything but service-role; not a functional gap today.
- **`active_threads`/`user_settings_decrypted` views** — both correctly built `WITH (security_invoker = true)`, confirmed via `pg_class.reloptions`; RLS on base tables correctly applies when queried directly.
- **`anon`/`authenticated` grants** on those views — both roles hold CRUD grants (Supabase's standard default-grant pattern), but `auth.uid()` is NULL for unauthenticated sessions, so the underlying policy blocks all rows.
- **`api/index.ts` ownership-chain queries** — `handleThreadDetail`/`handleFeed`/`handleRawEmail` traced: `threads` fetch always `.eq('id', thread_id).eq('user_id', user.id)` first, subsequent queries key off the already-validated `thread_id` — a closed trust chain (still under the finding #9 service-role caveat, not a distinct bug).
- **Contacts/emails per-user uniqueness** — `contacts_user_email_key UNIQUE(user_id, email)`, `emails_user_message_id_key UNIQUE(user_id, message_id)` — correctly scoped.
- **Extensions** — only `vector`, `pg_net`, `pgcrypto`, `uuid-ossp`, `wrappers`, `pg_stat_statements`, `pg_cron`, `hypopg`, `index_advisor` are installed; no unused installed extensions.
- **System schemas** (`auth.*`, `storage.*`, `vault.*`, `realtime.*`) — surveyed, posture matches Supabase-managed defaults; `vault.secrets` intentionally has no RLS, gated instead via `vault_store_gmail_token`/`vault.decrypted_secrets`.
- **`debug_logs`** — RLS enabled, SELECT-only user policy; all writes go through service-role code, consistent with audit-log design.

## Frontend (`TaskerAI/`)

### 14. 🟠 HIGH — `toggleStar` (and dead-but-live-code `markRead`) revert wipes out concurrent state instead of reverting only the failed field

**`TaskerAI/store/appStore.js:167-213`**

```js
toggleStar: async (threadId) => {
  const { threads } = get();               // snapshot BEFORE optimistic update
  ...
  set({ threads: threads.map(...) });       // optimistic update
  try {
    const { error } = await supabase.from('threads').update({ is_starred: nextStarred }).eq('id', threadId);
    if (error) throw error;
  } catch (err) {
    set({ threads: threads.map(...) });      // reverts using the STALE pre-update snapshot
  }
},
```

`markRead` has the identical shape but is currently unreachable (zero call sites); `toggleStar` is live from `PriorityRow` in `DashboardCards.js`, wired up in `app/(tabs)/index.js`, `app/(tabs)/waiting.js`, and `components/TaskList.js`.

**Concrete scenario:** user stars T1 → optimistic update sets `[T1'(starred:true), T2]` → while the Supabase `update` is in flight, a realtime sync lands T3, replacing store state with `[T1', T2, T3]` → T1's star update then fails → the `catch` block reverts using the *original* `threads` snapshot captured before any of this (`[T1, T2]`), overwriting the store and silently deleting T3.

**Expected:** a failed optimistic update reverts only the target thread's field, leaving concurrent changes intact.
**Actual:** the revert replaces the entire `threads` array with a pre-optimistic-update snapshot, discarding anything that arrived during the `await` window.
**Fix:** revert against `get().threads` (current state) at catch time, not the entry-time snapshot:
```js
} catch (err) {
  set({ threads: get().threads.map(t => t.id === threadId ? { ...t, is_starred: !nextStarred } : t) });
}
```
Same fix applies to `markRead`, worth fixing alongside even though currently unreachable.

### 15. 🟡 MEDIUM — onboarding progress bar and stage checklist can visibly contradict each other on a zero-thread sync

**`TaskerAI/app/(onboarding)/progress.js:15-21` vs `30-31`**

```js
function getStageIndex(progress) {
  const { threads_done = 0, threads_total = 1 } = progress;   // default only applies when field is undefined, not 0
  const pct = threads_done / threads_total;
  if (pct < 0.33) return 0;
  if (pct < 0.66) return 1;
  return 2;
}
...
const pct = threads_total > 0 ? threads_done / threads_total : 0;   // correctly guarded here
```

If `onboardingProgress` is `{ threads_done: 0, threads_total: 0 }` — a real payload shape (`TaskerAI/store/authStore.js:313-319` seeds exactly this immediately after wizard completion, before the first poll returns real numbers) — the outer, correctly-guarded `pct` renders the bar at 0%, but `getStageIndex` computes `0/0 = NaN`, and `NaN < 0.33`/`NaN < 0.66` both evaluate false, falling through to `return 2` — the *last* stage. Result: the bar shows 0% while "Fetching emails" and "Filtering noise" render as checked off.

**Independently confirmed twice**: found first via frontend trace (`code-logic-catcher` on `TaskerAI/`), then reconfirmed via `db-auditor` tracing the same bug from the `user_settings.onboarding_progress` seeding side — good cross-validation.

**Expected:** progress bar and stage checklist agree.
**Actual:** for the immediate post-wizard-completion window, the last stage renders as active/done while the bar shows 0%.
**Fix:** apply the same `threads_total > 0 ? ... : 0` guard inside `getStageIndex` (or reuse the already-computed outer `pct` instead of recomputing).

### Additional, lower-confidence observations (evidence-backed, not filed as proven bugs)

- **`TaskerAI/store/authStore.js:231-288` (`checkSyncHealth`) vs `172-229` (`bootstrapUser`) — asymmetric error-path guard reset.** `bootstrapUser`'s catch resets `_bootstrapTriggered: false` on failure (allowing retry); `checkSyncHealth`'s catch doesn't reset `_initialSyncDone` the same way. Not currently reachable via any retry path in the app today, but would silently make a future "retry" affordance a permanent no-op.
- **Nav-badge count vs page-badge count mismatch for "Waiting".** `app/(tabs)/_layout.js`/`components/web/Sidebar.js` compute the badge as unread-only reply threads; `app/(tabs)/waiting.js`'s in-page header badge counts all reply threads (read or not). Internally consistent between the two nav surfaces, but disagrees with the page's own header — e.g. sidebar shows "1" while the page says "3 threads requiring your response." Not filed as a defect since the intended semantic ("needs attention" vs "total waiting") isn't established anywhere — a product decision, not clearly a bug.

### Checked, no provable bug found (Frontend)

**`TaskerAI/lib/`, `TaskerAI/hooks/`, and root entry points** (7 files: `lib/brand.js`, `lib/supabase.js`, `hooks/useBreakpoint.js`, `hooks/useOnboardingPolling.js`, `hooks/useTabBarPadding.js`, `App.js`, `index.js`) — the remaining gap identified after the first frontend pass only globbed `app/`/`components`/`store/`. No provable defects found. Notable:

- **`lib/supabase.js`** — decoded the actual `EXPO_PUBLIC_SUPABASE_ANON_KEY` JWT shipped in `TaskerAI/.env`: payload confirms `"role":"anon"`, not a leaked service-role key — verifies the assumption `db-auditor` made in finding #9. `detectSessionInUrl: Platform.OS === 'web'` traced against both the web PKCE-redirect flow and native's explicit `handleOAuthCallback` deep-link handling — no gap, no double-handling.
- **`hooks/useOnboardingPolling.js`** — traced in depth against `authStore.js`'s poll lifecycle for races (mount-mid-poll, cleanup-on-unmount vs. cleanup-on-completion, stale closures, leave-and-return without restart) and React StrictMode double-invoke (not used anywhere in this codebase, confirmed via grep). No independent defect — the only related bug is the already-documented finding #15, which lives in `progress.js`, not this hook.
- **`hooks/useTabBarPadding.js`** — traced against all 5 consumers, no unit mismatch. Lower-confidence, unprovable-without-runtime-measurement observation: `app/(tabs)/_layout.js` never sets an explicit tab-bar `height`, so the real rendered height comes from React Navigation's platform default rather than this hook's hardcoded `56` — flagged for awareness, not filed as a bug.
- **`App.js`/`index.js`** — confirmed dead: `package.json`'s `"main": "expo-router/entry"` means Expo Router supplies its own entry and neither of these unmodified `create-expo-app` scaffold files is ever imported/executed. Not a defect (nothing in them is wrong), but worth knowing so they're not mistaken for the live entry point during future debugging.

**Prior pass** — full 35-file inventory of `TaskerAI/{app,components,store}/**/*.{js,jsx,ts,tsx}` evaluated (excludes deprecated `frontend/` per `CLAUDE.md`):

- `app/(tabs)/_layout.web.js` — trivial passthrough, no logic.
- `components/mockData.js` — pure static data.
- `app/(auth)/_layout.js`, `app/(onboarding)/_layout.js` — bare wrappers, no branches.
- `app/(onboarding)/step-lookback.js` — traced preset/custom toggle and numeric-input handling; only a cosmetic display/state divergence, not a functional break.
- `app/(onboarding)/step-tracking.js` — traced add/remove toggle for empty and populated arrays; correct both directions.
- `components/onboarding/ServiceCard.js`, `WizardCheckRow.js`, `WizardHeader.js`, `WizardTile.js` — pure presentational, boundary props traced, no defect.
- `app/(onboarding)/step-sources.js` — traced label toggles, cache short-circuit, error-swallow (minor, already logged in `CODE_REVIEW_FINDINGS.md`); `handleStart` correctly defers navigation to the layout guard.
- `app/(auth)/auth-callback.js`, `login.js` — traced OAuth URL branches (PKCE vs implicit vs neither); error paths correct.
- `components/PeopleGrid.js` — traced search/filter and modal state; no defect.
- `app/(tabs)/_layout.js`, `_layout.web.js`, `projects.js`, `people.js`, `tasks.js`, `waiting.js` — traced loading/empty/populated branches and refresh wiring against `appStore.fetchAll`'s contract.
- `components/web/WebShell.js` — pure composition, no logic.
- `app/_layout.js`, `_layout.web.js` — traced the nav-guard `useEffect` for all four auth/wizard states on both mobile and web, including the web-only OAuth-hash/search guard; internally consistent.
- `components/AIPanel.js` — traced the drawer/sheet visible/active/localItem state machine through mount→show→hide→unmount; no stale-closure issue.
- `components/Icons.js`, `components/Theme.js` — static definitions, no logic.
- `components/ProfileSheet.js`, `components/web/Sidebar.js` — traced `handleSync`/`handleDeleteAccount` async flows including the double-invoke guard and platform-specific confirm/cancel branches; correct on both.
- `components/web/TaskDetailPanel.js` — confirmed dead stub, matches prior finding.
- `components/TaskList.js` — traced search/filter/count `useMemo`s; no defect in the live path.
- `components/UnifiedPageHeader.js` — traced mobile/web branch and initials computation for null/single/multi-name cases.
- `app/(tabs)/index.js` — traced `priorities`/`waitingOn`/`metrics` derivations and sync/refresh handlers (the `dateString`/`waitingOver24h` bugs here are already confirmed in `CODE_REVIEW_FINDINGS.md`, not re-derived); no additional defect beyond the badge-mismatch observation above.
- `components/DashboardCards.js` — traced `PriorityRow`'s stop-propagation wiring, `DailyBriefHero`'s fallback, list rendering with 0/1/many items — no defect.
