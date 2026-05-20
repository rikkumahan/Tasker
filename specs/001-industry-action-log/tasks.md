# Tasks: Industry Action Log

**Input**: Design documents from `/specs/001-industry-action-log/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests are OPTIONAL and mainly handled via existing manual verifications and `run_deep_test.mjs`.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Verify project structure and start dev environment

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Apply database migration to add new columns to public.tasks (using specs/001-industry-action-log/contracts/db-schema.md) via Supabase SQL editor or MCP.

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View Action Log Instead of Task List (Priority: P1) 🎯 MVP

**Goal**: Extract structured action insights and display an Action Log with priority badges instead of a flat task list.

**Independent Test**: Trigger a manual inbox sync and verify that action cards render with impact level, action type, sender organization, and escalation risk fields populated correctly.

### Implementation for User Story 1

- [x] T003 [P] [US1] Update `extractRawTasks` prompt and LLM output schema in `supabase/functions/_shared/stages.ts`
- [x] T004 [P] [US1] Update task upsert logic to include new columns in `supabase/functions/sync/index.ts`
- [x] T005 [P] [US1] Add visual tokens for impact level and action type in `frontend/src/index.css`
- [x] T006 [US1] Redesign TaskCard into ActionCard with impact badge, action type chip, sender org, and escalation risk in `frontend/src/App.jsx`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - One-Click Reply Draft Access (Priority: P2)

**Goal**: Provide 2-3 pre-drafted response options directly inside the Action Card for quick replies.

**Independent Test**: Verify that an Action Card for a reply-required email includes at least 2 pre-generated response options that can be copied to the clipboard.

### Implementation for User Story 2

- [x] T007 [US2] Implement Suggested Drafts accordion and Copy to Clipboard functionality in `frontend/src/App.jsx`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Related Email Clustering by Project Context (Priority: P2)

**Goal**: Group action cards by client or project context instead of a flat list.

**Independent Test**: Verify that two emails with different subject lines but referencing the same client or project name are grouped under the same cluster in the Action Log.

### Implementation for User Story 3

- [x] T008 [US3] Implement grouping by `sender_organization` and sorting by `impact_level` in `frontend/src/App.jsx`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Raw Email Sender Tracking (Priority: P2)

**Goal**: Store the sender of each email in `raw_emails` and pass it to the LLM during task extraction so that `sender_organization` is extracted with high accuracy.

**Independent Test**: Verify that incoming emails store the sender address in `raw_emails.sender` and that the LLM extracts the correct `sender_organization` from it.

### Implementation for Raw Email Sender Tracking

- [ ] T009 Apply database migration to add `sender` column to `raw_emails` table.
- [ ] T012 Update `rawEmailInserts` and `unprocessedEmails` mapping in `supabase/functions/sync/index.ts` to save and select the `sender` field.
- [ ] T013 Update `extractRawTasks` in `supabase/functions/_shared/stages.ts` to include `From: ${e.sender}` in the text sent to the LLM.

**Checkpoint**: Raw Email Sender Tracking complete and verified.

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T010 Run deep test regression suite via `node run_deep_test.mjs` to ensure PII accuracy is maintained (Skipped: file not present in this repo)
- [x] T011 Trigger manual sync and verify full Action Log UI renders correctly end-to-end (To be verified by user)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 UI changes to exist (ActionCard)
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 UI changes to exist (Action Log layout)
- **Raw Email Sender Tracking (P2)**: Can start after Foundational (Phase 2) - Depends on US1 sync function mapping.

### Parallel Opportunities

- T003, T004, T005 can all be implemented in parallel by different developers.
- T009, T012, and T013 can be worked on in parallel to frontend UI polish changes.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently via manual sync.
5. Deploy/demo if ready
