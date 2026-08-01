# TaskerAI E2E Test Cases (Maestro, Android)

Manual test plan driving the Maestro flows. Each case maps to a flow file in
`e2e/`. Status reflects whether a Maestro flow exists and has been run
against a real device.

## Auth

| # | Case | Flow | Status |
|---|------|------|--------|
| A1 | Sign in with Google (new session, "Use another account" path) | `login.yaml` | written, not yet run end-to-end |
| A2 | Sign out from ProfileSheet returns to Welcome/Connect screen | manual (used to reset state) | verified manually |
| A3 | Re-launch app with persisted session skips login, lands on Today | `tab-navigation.yaml` (implicit) | verified |

## Navigation

| # | Case | Flow | Status |
|---|------|------|--------|
| N1 | Tap through all 5 tabs (Today, Tasks, Waiting, Projects, People), each shows distinguishing subtitle | `tab-navigation.yaml` | passing |
| N2 | Profile avatar ("RM") opens ProfileSheet with Force Sync / Settings / Sign Out / Delete Account | manual | verified |

## Today tab

| # | Case | Status |
|---|------|--------|
| T1 | Daily brief renders greeting + action item / waiting / unread counts | verified |
| T2 | "Sync" button triggers a sync (no crash, spinner or completion state) | not yet run |
| T3 | "Brief me" button regenerates the daily brief | not yet run |
| T4 | "Refresh" on Daily Brief card updates counts | not yet run |
| T5 | Tapping a Top Priority item ("Reply →" / "Review →") opens detail | not yet run |

## Tasks tab

| # | Case | Status |
|---|------|--------|
| K1 | Tasks tab loads list, subtitle "All actionable items from your threads" visible | passing (assert only, via N1) |
| K2 | Empty state renders correctly when no tasks | not yet run |
| K3 | Tapping a task opens task detail | not yet run |
| K4 | Marking a task complete updates state/list | not yet run |

## Waiting tab

| # | Case | Status |
|---|------|--------|
| W1 | Waiting tab loads, subtitle "Threads requiring your response" visible | passing (assert only, via N1) |
| W2 | Empty state "All caught up! No threads awaiting your response." renders when count is 0 | verified (screenshot) |
| W3 | Waiting item (when present) opens thread detail | not yet run — need seeded data |

## Projects tab

| # | Case | Status |
|---|------|--------|
| P1 | Projects tab loads, subtitle "Your active context tracks" visible | passing (assert only, via N1) |
| P2 | Tapping a project opens project detail | not yet run |

## People tab

| # | Case | Status |
|---|------|--------|
| PP1 | People tab loads, subtitle "Contacts from your threads" visible | passing (assert only, via N1) |
| PP2 | Tapping a contact opens contact detail / their threads | not yet run |

## Destructive actions (NOT automated — manual/guarded only)

| # | Case | Status |
|---|------|--------|
| D1 | Delete Account flow (confirmation dialog, actually deletes) | intentionally excluded from automated flows |

## How to run

```bash
cd TaskerAI
npm run test:e2e
```

Requires `e2e/.env.local` with `EMAIL` / `PASSWORD` for a disposable test
Google account (2FA off), and a connected Android device with Expo Go
running the dev server.
