# Feature Specification: Industry Action Log

**Feature Branch**: `001-industry-action-log`

**Created**: 2026-05-20

**Status**: Draft

**Input**: Transition Tasker from a generic email task categorizer into an Industry Action Log for corporate professionals — extracting structured action insights from emails so busy professionals never miss what requires their attention, decision, or response.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — View Action Log Instead of Task List (Priority: P1)

A corporate professional opens Tasker at the start of their workday. Instead of seeing a flat list of categorized tasks, they see a structured **Action Log** — a prioritized list of items that require their personal attention, grouped by client or project context. Each item shows what type of action is needed (approve, reply, attend, unblock), how urgent it is, who sent it and from which organization, and what the risk is of leaving it unaddressed.

**Why this priority**: This is the core experience shift. Everything else builds on this. A professional who sees one clean, prioritized action log instead of 160 unread emails immediately understands the product's value.

**Independent Test**: Can be tested by triggering a manual inbox sync and verifying that action cards render with impact level, action type, sender organization, and escalation risk fields populated correctly.

**Acceptance Scenarios**:

1. **Given** the user has emails in their inbox, **When** they open Tasker and sync, **Then** each email that requires action appears as an Action Card — not a generic task — with a visible impact level badge (High / Medium / Low), action type label, and sender's organization name.
2. **Given** an email requires an approval decision, **When** Tasker processes it, **Then** the Action Card shows action type as "Approval Required" and impact level is set based on the sender's seniority and urgency cues in the email body.
3. **Given** multiple action items exist, **When** the user views the Action Log, **Then** items are grouped by project or client context and sorted by impact level — High items appear first.
4. **Given** an email carries a consequence if ignored (e.g., a contract deadline, a blocked team), **When** the card is displayed, **Then** an escalation risk note is visible beneath the action summary.

---

### User Story 2 — One-Click Reply Draft Access (Priority: P2)

A corporate professional opens an Action Card for an email that requires a reply. Instead of having to open their email client, search for the thread, read the context, and compose a reply from scratch, they see 2–3 pre-drafted response options directly inside the Action Card. They select the most appropriate draft, copy it, and use it to reply — reducing the time-to-response from minutes to seconds.

**Why this priority**: Seeing the action is step one. Resolving it quickly is step two. This feature closes the loop between insight and execution, which is Tasker's core differentiation from a standard task manager.

**Independent Test**: Can be tested by verifying that an Action Card for a reply-required email includes at least 2 pre-generated response options that are contextually relevant to the email content and not generic placeholders.

**Acceptance Scenarios**:

1. **Given** an email requiring a reply has been extracted, **When** the user expands the Action Card, **Then** they see a "Suggested Drafts" section with 2–3 response options labelled by intent (e.g., Approve / Clarify / Delegate).
2. **Given** a draft option is displayed, **When** the user clicks "Copy Draft", **Then** the draft text is copied to clipboard and a brief confirmation is shown.
3. **Given** the email is highly formal or senior-level, **When** drafts are generated, **Then** all draft options use appropriately professional language matching the sender's tone.

---

### User Story 3 — Related Email Clustering by Project Context (Priority: P2)

A corporate professional is managing 4 active projects simultaneously. Instead of seeing a flat list of actions from all projects mixed together, they see their Action Log grouped into named project or client clusters — so all emails related to "Project Zeus" appear together, and all emails from "Stripe" appear together, regardless of the email subject line or which thread they originated from.

**Why this priority**: Context switching between projects is one of the highest cognitive costs for managers. Grouping by context instead of by time or subject line dramatically reduces the mental overhead of picking up a project mid-day.

**Independent Test**: Can be tested by verifying that two emails with different subject lines but referencing the same client or project name are grouped under the same cluster in the Action Log.

**Acceptance Scenarios**:

1. **Given** two emails from the same sender organization arrive in different threads, **When** Tasker processes them, **Then** both Action Cards appear under the same organization cluster in the Action Log.
2. **Given** a user has completed a project and its emails are older than 30 days with no new activity, **When** they view the Action Log, **Then** that project cluster is collapsed by default but still accessible.
3. **Given** a new email arrives about an existing active cluster, **When** the sync processes it, **Then** the new Action Card is appended to the correct cluster without creating a duplicate cluster.

---

### User Story 4 — Onboarding Calibrated for Corporate Context (Priority: P3)

A new corporate professional signs up for Tasker. During onboarding, the AI asks questions appropriate to their organizational role — who their key clients and stakeholders are, what types of decisions they typically make via email, and which senders should always surface at the top. The onboarding output is a corporate professional profile, not a generic task preference.

**Why this priority**: The onboarding profile directly determines extraction quality. A poorly calibrated profile produces generic action items. A well-calibrated corporate profile produces highly relevant, persona-aware action insights.

**Independent Test**: Can be tested by verifying that the onboarding conversation asks at least one question about organizational role, one about key clients or stakeholders, and one about what types of email actions the user most needs to track.

**Acceptance Scenarios**:

1. **Given** a new user completes onboarding, **When** their profile is saved, **Then** the profile includes their organizational role, key client or stakeholder names, and at least one custom extraction rule.
2. **Given** a user identifies themselves as a manager, **When** Tasker extracts action items from their inbox, **Then** delegation-type emails are consistently surfaced as high-priority action items.

---

### Edge Cases

- What happens when an email contains no identifiable action and is not promotional spam? It should be silently filed to a low-priority "For Your Awareness" cluster rather than discarded or forced into a wrong action type.
- What happens when the LLM cannot determine sender organization from the email? The organization field is left blank gracefully — no placeholder text, no error shown.
- What happens when an email generates a very long escalation risk description? The risk text should be truncated to 2 sentences maximum in the card view, with full text accessible on expand.
- What happens when two emails about the same project arrive simultaneously during a sync? Both must be processed independently and assigned to the same cluster without collision.
- What happens if the user has no emails requiring action? The Action Log displays a clean empty state — no task-like empty state copy from the old experience.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST classify every extracted email action into one of the following action types: `Approval Required`, `Reply Needed`, `Blocker`, `Event / Calendar`, `Delegated Tracking`, or `For Your Awareness`.
- **FR-002**: The system MUST assign an impact level (`High`, `Medium`, or `Low`) to every Action Card based on sender seniority signals, urgency language in the email body, and the user's stored persona profile.
- **FR-003**: The system MUST extract the sender's organization name from the email headers or email signature and attach it to the Action Card.
- **FR-004**: The system MUST generate an escalation risk description for any Action Card where the email contains consequences of non-response (e.g., contract deadlines, team blockers, client escalations).
- **FR-005**: The system MUST generate 2–3 contextually relevant reply draft options for all Action Cards of type `Reply Needed` or `Approval Required`.
- **FR-006**: The system MUST group Action Cards by client or project cluster based on sender organization and contextual signals in the email body.
- **FR-007**: The system MUST sort Action Cards within each cluster by impact level, with `High` items appearing first.
- **FR-008**: The onboarding conversation MUST collect the user's organizational role, key clients or stakeholders, and preferred action extraction priorities before the first sync.
- **FR-009**: The system MUST continue to apply the existing Zero-Trust Privacy Shield (3-stage PII pipeline) to all emails before any action insight extraction occurs.
- **FR-010**: The existing sync pipeline (manual sync + background worker) MUST be reused without architectural changes — only the extraction prompt and data model output are modified.

### Key Entities

- **Action Card**: Represents a single actionable insight extracted from one email. Attributes: title, action type, impact level, sender name, sender organization, summary, deadline, escalation risk, suggested reply drafts, source email ID, project/client cluster, status.
- **Project / Client Cluster**: A named grouping of Action Cards that share a common organizational context. Attributes: cluster name (e.g., client company or project name), action count, highest impact level, last activity timestamp.
- **Corporate User Profile**: The user's persona stored in settings. Attributes: organizational role, key stakeholders, active projects, extraction preferences, preferred communication style.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A corporate professional can identify their top 3 most urgent actions within 30 seconds of opening the app — without reading a single raw email.
- **SC-002**: 90% of emails that require a human decision or response are classified with the correct action type on first extraction.
- **SC-003**: Action Cards for emails with escalation consequences include a non-empty escalation risk field in 85% of applicable cases.
- **SC-004**: A user can copy a pre-drafted reply and send it from their email client within 60 seconds of opening an Action Card.
- **SC-005**: Emails from the same client or project are grouped into the same cluster with 95% accuracy across a standard inbox sample.
- **SC-006**: The full sync-to-display cycle (email arrives → action card visible in UI) completes within the existing sync latency bounds — no regression introduced.

---

## Assumptions

- The existing Supabase Edge Function infrastructure (sync, background worker, webhook ingest) is reused without architectural changes.
- The `tasks` database table will be extended with new columns for `action_type`, `impact_level`, `sender_organization`, `escalation_risk`, and `suggested_reply_draft` — no table rename is performed.
- The existing Zero-Trust PII pipeline in `_shared/stages.ts` continues to run on all emails before extraction — no exceptions.
- The LLM (Llama 4 Scout via Groq) is capable of returning the extended action insight schema within the existing prompt constraints.
- The frontend runs on the existing Vite/React stack — no framework change is required.
- Mobile support is out of scope for this feature version.
- The Commitment Drift, Ghost Blocker Mapping, and Sentiment Escalation features are out of scope for this version — they are planned as Phase 2.
- The user's existing tasks in the database are not migrated — the new schema applies to all newly synced emails going forward.
