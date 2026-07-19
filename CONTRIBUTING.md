# Contributing to Tasker

Thanks for your interest in contributing. This is a small project — keep changes focused and match the existing style.

## Local Setup

See the [Quick Start](README.md#quick-start) in the README for running the client and backend locally.

## Project Layout

- `TaskerAI/` — the active client (Expo Router + React Native). All new feature work happens here.
- `supabase/functions/` — Deno edge functions (the backend). Test locally with `supabase functions serve` before deploying.
- `docs/` — deep-dive guides; add one here if you're documenting a non-obvious subsystem.
- `archive/` — superseded code/docs, kept for history. Don't build on top of it.

## Making Changes

1. Fork the repo and create a branch off `main`.
2. Keep commits scoped to one logical change.
3. Run the relevant test suite before opening a PR:
   - Client: `cd TaskerAI && npm test`
   - E2E: `cd TaskerAI && npm run test:e2e` (requires Maestro)
4. Open a PR against `main` with a short description of what changed and why.

## Reporting Issues

Open a GitHub issue with steps to reproduce, expected vs. actual behavior, and relevant logs. For security issues, please avoid filing a public issue — see the maintainer's profile for a private contact.
