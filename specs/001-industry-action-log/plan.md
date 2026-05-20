# Implementation Plan: Industry Action Log

**Branch**: `001-industry-action-log` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-industry-action-log/spec.md`

---

## Summary

Transition Tasker from a generic email task categorizer into a corporate-grade **Industry Action Log**. The application will extract structured action insights from incoming emails — including action type, impact level, sender organization, escalation risk, and pre-drafted reply options — and render them as prioritized Action Cards grouped by project or client context. All changes are additive: the existing sync infrastructure, PII pipeline, and database table are extended, not replaced.

---

## Technical Context

**Language/Version**: TypeScript (Deno runtime) for Edge Functions; JavaScript/JSX (React 18) for frontend

**Primary Dependencies**: Supabase JS v2, Groq API (Llama 4 Scout — `meta-llama/llama-4-scout-17b-16e-instruct`), Arcjet Redact WASM, date-fns, lucide-react

**Storage**: PostgreSQL via Supabase — `tasks` table extended with 5 new nullable columns; `user_settings` profile updated to support corporate persona

**Testing**: Existing `pii_evals.json` + `run_deep_test.mjs` for PII regression; manual browser verification for UI; Supabase `debug_logs` for LLM output auditing

**Target Platform**: Supabase Edge Runtime (Deno) + Vite/React SPA

**Project Type**: Web service (Edge Functions) + SPA frontend

**Performance Goals**: No regression in existing sync latency baseline; action card render < 100ms from data load

**Constraints**: Backward-compatible schema migration (existing rows get NULL for new columns); no architectural changes to sync pipeline; all new columns nullable

**Scale/Scope**: Multi-user via Supabase RLS; existing 180 RPM LLM pool capacity unchanged

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| **I. Zero-Trust Privacy Shield** | PASS | FR-009 mandates the 3-stage PII pipeline runs on ALL emails before extraction. No exceptions introduced. |
| **II. Deduplicated Async Queueing** | PASS | FR-010 mandates reuse of existing sync pipeline. Ghost Tasks pattern and raw_emails dedup remain intact. |
| **III. Strict Visual Aesthetics** | PASS | Action Card redesign enforced to use copper/navy theme, Google Fonts, and micro-animations. No inline hacks. |
| **IV. Regression Testing** | PASS | `pii_evals.json` must be re-run after any change to `stages.ts`. Logged as a mandatory task gate. |
| **V. Non-Blocking Background Sync** | PASS | background_worker delegates to sync unchanged. No blocking calls introduced in the frontend. |

All gates pass. Proceeding to Phase 1.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-industry-action-log/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── llm-output-schema.md
│   ├── db-schema.md
│   └── frontend-props.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (speckit-tasks)
```

### Source Code (repository root)

```text
supabase/functions/
├── _shared/
│   └── stages.ts          # MODIFY: extractRawTasks prompt + output mapping
├── sync/
│   └── index.ts           # MODIFY: persist new fields to DB
└── synthesize_profile/
    └── index.ts           # MODIFY: corporate onboarding prompts

frontend/src/
├── App.jsx                # MODIFY: ActionCard component + Action Log layout
└── index.css              # MODIFY: new visual tokens (impact badges, action chips)
```

---

## Verification Plan

### Automated Tests
1. Run `node run_deep_test.mjs` after modifying `stages.ts` — must maintain 16/16 PII accuracy
2. Trigger a manual sync via the frontend sync button and inspect `debug_logs` for `TASK_CATEGORIZED` events with new fields populated
3. Query Supabase: `SELECT action_type, impact_level, sender_organization FROM tasks WHERE user_id = '<id>' LIMIT 10` — verify non-null values appear

### Manual Verification
1. Open the app in a browser — verify header reads "Action Log" not "My Tasks"
2. Expand an Action Card — verify impact badge, action type chip, sender org, and escalation risk render correctly
3. Expand a card of type Reply Needed — verify Suggested Drafts section shows 2-3 options with Copy button
4. Verify emails from the same organization cluster together in the Action Log view
