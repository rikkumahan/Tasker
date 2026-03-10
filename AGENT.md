# Agent Instructions

> This file is mirrored across CLAUDE.md, AGENTS.md, and GEMINI.md so the same instructions load in any AI environment.

You operate within a 3-layer architecture that separates concerns to maximize reliability. LLMs are probabilistic, whereas most business logic is deterministic and requires consistency. This system fixes that mismatch.

## The 3-Layer Architecture

**Layer 1: Directive (What to do)**
- Basically just SOPs written in Markdown, live in `directives/`
- Define the goals, inputs, tools/scripts/workflows to use, outputs, and edge cases
- Natural language instructions, like you'd give a mid-level employee

**Layer 2: Orchestration (Decision making)**
- This is you. Your job: intelligent routing.
- Read directives, trigger execution (scripts or n8n workflows) in the right order, handle errors, ask for clarification, update directives with learnings
- You're the glue between intent and execution. E.g. you don't try scraping websites yourself — you read `directives/fetch_and_understand.md` and trigger the relevant n8n workflow or script

**Layer 3: Execution (Doing the work)**
- Two execution mechanisms depending on the task:
  1. **n8n Workflows** — for automation, scheduled tasks, multi-step pipelines (Gmail → LLM → Supabase). Workflow JSONs live in `execution/n8n_workflows/`
  2. **Python Scripts** — for one-off data processing, local file operations, or tasks not suited to n8n. Live in `execution/`
- Environment variables, API tokens in `.env`
- Supabase is the persistent data layer (replaces `.tmp/` JSON for tasks that need cross-device access)

**Why this works:** if you do everything yourself, errors compound. 90% accuracy per step = 59% success over 5 steps. The solution is push complexity into deterministic automation (n8n) and code (Python). That way you just focus on decision-making.

## Execution Decision Guide

| Task type | Use |
|---|---|
| Scheduled / triggered automation | n8n workflow |
| Multi-step pipeline (email → LLM → DB) | n8n workflow |
| One-off data processing | Python script |
| Local file operations | Python script |
| Persistent cross-device data | Supabase |
| Intermediate temp files | `.tmp/` |

## Operating Principles

**1. Check for tools first**
Before creating anything, check `execution/n8n_workflows/` and `execution/` per your directive. Only create new workflows/scripts if none exist.

**2. Prefer n8n for pipelines**
If a task involves triggers, schedules, or chaining external services, use n8n. Export workflow JSONs to `execution/n8n_workflows/` for version control.

**3. Self-anneal when things break**
- Read error message and stack trace
- Fix the workflow/script and test it again (unless it uses paid tokens/credits — check with user first)
- Update the directive with what you learned (API limits, timing, edge cases)

**4. Update directives as you learn**
Directives are living documents. When you discover API constraints, better approaches, or common errors — update the directive. Don't create or overwrite directives without asking unless explicitly told to.

## Self-annealing loop

Errors are learning opportunities. When something breaks:
1. Fix it
2. Update the tool (workflow or script)
3. Test it, make sure it works
4. Update directive to include new flow
5. System is now stronger

## File Organization

**Directory structure:**
- `.tmp/` — Intermediate files needed during processing. Never commit, always regenerated.
- `execution/` — Python scripts for one-off or local tasks
- `execution/n8n_workflows/` — Exported n8n workflow JSONs (version controlled)
- `directives/` — SOPs in Markdown (the instruction set)
- `frontend/` — Static dashboard files (HTML, CSS, JS)
- `.env` — Environment variables and API keys
- `credentials.json`, `token.json` — Google OAuth credentials (in `.gitignore`)

**Data persistence:**
- **Cross-device / shared data** → Supabase (tasks, state that the dashboard reads)
- **Intermediate processing** → `.tmp/`
- **Deliverables** → Google Sheets, Slides, or other cloud outputs

**Key principle:** Local files are only for processing. Shared data lives in Supabase. Deliverables live in cloud services. Everything in `.tmp/` can be deleted and regenerated.

## n8n Workflow Guidelines

- Always export workflow JSON after building/modifying in n8n UI → save to `execution/n8n_workflows/<name>.json`
- Document each workflow's trigger, nodes, and expected outputs in the corresponding directive
- For webhook-triggered workflows, document the webhook URL in the directive
- Test workflows using n8n's manual trigger before enabling the schedule

## Summary

You sit between human intent (directives) and deterministic execution (n8n workflows + Python scripts). Read instructions, make decisions, trigger the right tool, handle errors, continuously improve the system.

Be pragmatic. Be reliable. Self-anneal.

## Ralph Persistence & Learnings

When running in an autonomous loop (like Ralph), it is critical to capture learnings after each iteration.

**1. Update this file (AGENT.md/AGENTS.md)**
After discovering patterns, gotchas, or codebase conventions:
- Add them to the relevant section or a new "Learnings" section.
- Future iterations and human developers rely on this persistent memory.

**2. Update progress.txt**
When using the Ralph loop, ensure you append concise summaries of progress and discovered context to `scripts/ralph/progress.txt`. This provides the narrative link between iterations.
