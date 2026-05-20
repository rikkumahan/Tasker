# Research: Industry Action Log

**Phase**: 0 — Outline & Research
**Branch**: `001-industry-action-log`
**Date**: 2026-05-20

---

## Decision 1: LLM Schema Extension Feasibility

**Question**: Can Llama 4 Scout reliably extract the extended action insight schema (`action_type`, `impact_level`, `sender_organization`, `escalation_risk`, `suggested_reply_draft`) in a single prompt pass within existing token limits?

**Decision**: Yes — extend the existing single-pass extraction prompt with the new schema fields.

**Rationale**: The existing prompt already instructs the model to return complex nested JSON (title, summary, deadline, warnings, category, source_email_id). Adding 5 new fields increases the per-email output by approximately 200–300 tokens. Llama 4 Scout supports a 16k context window with 10-email batches, leaving significant headroom. Structured JSON output via Groq is well-supported and the model reliably follows schema instructions when examples are included.

**Alternatives Considered**:
- Two-pass extraction (separate call for action insights): Rejected — doubles LLM cost and latency, violates constitution principle V (non-blocking sync).
- Separate edge function for enrichment: Rejected — introduces a new async layer and architectural complexity out of scope for this feature.

---

## Decision 2: Database Migration Strategy

**Question**: How do we safely add 5 new columns to the live `tasks` table without downtime or breaking existing rows?

**Decision**: `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS` with `DEFAULT NULL` for all new columns, executed as a Supabase migration.

**Rationale**: All new columns are nullable. Existing rows automatically receive NULL values for new columns. Frontend and backend code handles NULL gracefully (no rendering if null, no DB error on insert). The `IF NOT EXISTS` guard makes the migration idempotent and safe to re-run.

**Alternatives Considered**:
- Create a new `action_insights` table with a FK to `tasks`: Rejected — over-engineered for this phase, breaks existing Supabase Realtime subscription which targets the `tasks` table directly.
- Rename `tasks` to `action_log`: Rejected — breaks all existing FK references, RLS policies, and frontend queries across the entire codebase.

---

## Decision 3: Suggested Reply Draft Storage

**Question**: How do we store structured, multi-option reply drafts per action card?

**Decision**: JSONB column `suggested_reply_draft` with schema: `{ "options": [{ "label": "Approve", "text": "..." }, { "label": "Clarify", "text": "..." }] }`.

**Rationale**: JSONB is already used in Tasker for `warnings` (array) and `secrets` (object). Supabase handles JSONB natively with full indexing support. The nested structure cleanly represents 2–3 options without additional tables. The frontend can iterate `options` and render each as a copy button.

**Alternatives Considered**:
- Three separate columns (`draft_option_1`, `draft_option_2`, `draft_option_3`): Rejected — brittle, not extensible, ugly schema.
- Separate `reply_drafts` table: Rejected — unnecessary join overhead for a feature that renders inside a single card.

---

## Decision 4: Project / Client Cluster Grouping

**Question**: How do we group Action Cards by project or client context without adding a new `clusters` table?

**Decision**: Use the `sender_organization` field as the primary cluster key. The LLM is instructed to normalize organization names consistently (e.g., always "Stripe" not "Stripe Inc." or "stripe.com"). The frontend groups cards by this field using a simple `reduce` operation.

**Rationale**: A separate `clusters` table adds relational complexity without significant benefit at this stage. Since `sender_organization` is LLM-extracted and normalized in the prompt, consistency is high enough to drive grouping. Cards without an organization fall into an "Other" cluster.

**Alternatives Considered**:
- Separate `cluster_id` FK column: Deferred to Phase 2 when Knowledge Graph is implemented.
- Client-side fuzzy grouping: Rejected — inconsistent results across page loads.

---

## Decision 5: Corporate Onboarding Calibration

**Question**: What questions must the onboarding collect to produce a corporate-quality extraction profile?

**Decision**: Update the onboarding prompt in `synthesize_profile/index.ts` to collect: (1) organizational role and seniority, (2) key clients or stakeholder names, (3) active project names, (4) what types of email actions the user most needs to track, (5) which senders should always surface as High impact.

**Rationale**: The current onboarding collects generic identity and inbox noise/signal preferences. For a corporate professional, the LLM needs to know role context (e.g., account manager vs. engineering lead) to correctly weight action types. Knowing key clients enables organization-level priority boosting.

**Alternatives Considered**:
- Keep existing onboarding unchanged: Rejected — the existing profile produces generic categories, not corporate action types.
- Multi-step onboarding wizard in the frontend: Deferred to Phase 2. For now, the conversational AI onboarding is extended.

---

## All NEEDS CLARIFICATION Resolved

No open clarifications remain. All decisions above are final and implementable.
