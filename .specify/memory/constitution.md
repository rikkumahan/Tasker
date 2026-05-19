<!-- 
Sync Impact Report
- Version change: [TEMPLATE] -> v1.0.0
- List of modified principles:
  - Added: I. Zero-Trust Privacy Shield (PII Engine)
  - Added: II. Deduplicated Async Queueing
  - Added: III. Strict Visual Aesthetics
  - Added: IV. Regression Testing & Evals
  - Added: V. Non-Blocking Background Sync
- Added sections: Architecture and Security Standards, Spec-Driven Development Workflow
- Templates requiring updates:
  - .specify/templates/plan-template.md: ✅ updated
  - .specify/templates/spec-template.md: ✅ updated
  - .specify/templates/tasks-template.md: ✅ updated
- Follow-up TODOs: None
-->

# Tasker Constitution

## Core Principles

### I. Zero-Trust Privacy Shield (PII Engine)
All sensitive user data (credentials, JWTs, PAN, Aadhaar, GSTIN, and custom secrets) must be redacted or masked at the edge using the 3-stage privacy engine (regex pre-pass, Arcjet entropy check, and rehydration layer) before any external API/LLM calls. High-entropy tokens in the 3.5-4.5 entropy range must be logged to debug_logs for async review.

### II. Deduplicated Async Queueing
Email processing must be decoupled from fetching. Emails are stored as raw records in `raw_emails` and processed. If an email contains no actionable tasks, a lightweight "Ghost Task" with status `ignored` must be created to prevent infinite pagination loops and duplicate processing.

### III. Strict Visual Aesthetics
The frontend user interface must strictly adhere to the warm minimalist copper/navy theme, modern typography (Google Fonts), and smooth micro-animations. No raw/default styling or inline hacks unless explicitly requested. Tailwind CSS is avoided unless specified.

### IV. Regression Testing & Evals
Code changes affecting the privacy engine or task parsing must be verified using the automated test suites (e.g., `run_deep_test.mjs`, `pii_evals.json`) to maintain 100% accuracy before deployment.

### V. Non-Blocking Background Sync
Synchronization must run in the background (using Supabase background_worker) and never block user interactions or pollute the active task view. The frontend must filter out non-pending/ignored tasks.

## Architecture and Security Standards
The backend is built as Supabase Edge Functions using Deno and TypeScript. No direct exposure of database admin keys to clients. Use Supabase RLS policies to enforce tenant isolation.

## Spec-Driven Development Workflow
All major features and bug fixes must follow the Spec-Driven Development flow: Constitution -> Specification -> Implementation Plan -> Discrete Tasks -> Execution & Verification. All planning documents must be approved before writing code.

## Governance
Any modifications to the constitution require an incremental version bump (MAJOR.MINOR.PATCH) and updates to all dependent templates.

**Version**: 1.0.0 | **Ratified**: 2026-05-20 | **Last Amended**: 2026-05-20
