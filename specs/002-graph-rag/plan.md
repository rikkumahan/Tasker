# Implementation Plan: Context-Aware Corporate Email GraphRAG

**Branch**: `002-graph-rag` | **Date**: 2026-05-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-graph-rag/spec.md`

## Summary

Overhaul corporate email processing by ingesting emails into a PostgreSQL database and building a property graph of contacts, projects, threads, and tasks. Entities are extracted via a Deno-native `GraphRAGExtractor` with name resolution, clustered into topics using Modular Louvain clustering (`GraphRAGStore`), summarized by an LLM, and queried via a Deno `GraphRAGQueryEngine` (supporting local neighborhood queries and global map-reduce queries). Integrates this into the existing React application.

## Technical Context

**Language/Version**: Deno TypeScript (v1.x/v2.x) for backend edge functions, JavaScript (ES6+ / React 19 / Vite) for the existing web application.

**Primary Dependencies**: `@supabase/supabase-js`, `groq-sdk` (or raw fetch requests to Groq API), `date-fns`, `lucide-react`.

**Storage**: Supabase PostgreSQL with `pgvector` extension for email, contact, and community embeddings.

**Testing**: Deno native test runner (`Deno.test`), Playwright for frontend E2E compile tests.

**Target Platform**: Supabase Edge Functions (Deno host), Web Browser.

**Project Type**: Fullstack web service with Deno backend functions and React frontend.

**Performance Goals**:
- Extraction and entity resolution complete in <10 seconds per email thread.
- Local neighborhood search executes in <2 seconds.
- Global map-reduce search executes in <5 seconds.
- Modularity Louvain clustering groups 500+ nodes in under 1 second.

**Constraints**:
- Must not leak raw PII (emails are pre-redacted using `_shared/pii.ts`).
- Avoid Python networkx/graspologic dependencies.
- Keep the Deno function memory footprint under 256MB.

## Project Structure

### Documentation (this feature)

```text
specs/002-graph-rag/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Technology research on Leiden/Louvain & entity resolution
├── data-model.md        # Graph database schema details
├── quickstart.md        # Quickstart setup instructions for testing
├── contracts/
│   ├── llm-output-schema.md   # Triplets custom parsing schema
│   ├── db-schema.md           # SQL DDL schemas
│   └── frontend-props.md      # API request/response properties
└── checklists/
    └── requirements.md        # Spec validation checklist
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   └── 011_add_graphrag_tables.sql  # SQL Database migrations
└── functions/
    ├── _shared/
    │   ├── graph.ts     # GraphRAGExtractor & GraphRAGStore
    │   ├── pii.ts       # PII Redaction
    │   └── stages.ts    # Sync pipeline integrations
    ├── sync/
    │   └── index.ts     # Email sync & background clustering triggers
    ├── query/
    │   └── index.ts     # GraphRAGQueryEngine (local/global search)
    └── graph-debug/
        └── index.ts     # Diagnostic edge function endpoint

frontend/
├── src/
│   ├── App.jsx          # Tabbed UI layout, Graph Console, Citation Modals, Directories
│   ├── index.css        # Tab and console style variables
│   └── Auth.jsx         # User Authentication page
```

**Structure Decision**: Multi-directory structure leveraging Supabase Edge Functions for backend processing and the existing React `frontend/` directory for the web console dashboard.

## Proposed Changes

### Database Layer
- Apply SQL DDL migration `011_add_graphrag_tables.sql` to initialize `contacts`, `projects`, `threads`, `emails`, `graph_edges`, `community_reports`, and `community_members`.
- Set up HNSW cosine similarity indexes for quick search of embeddings.

### Backend Edge Functions
- Write `supabase/functions/_shared/graph.ts` containing:
  - `GraphRAGExtractor` class to parse emails into structured entity/relationship tuples.
  - `GraphRAGStore` class to resolve duplicate entities, execute modular modularity-based Louvain clustering, and write community reports.
- Update `supabase/functions/sync/index.ts` to hook up extraction and edge writing.
- Write `supabase/functions/query/index.ts` containing the `GraphRAGQueryEngine` supporting Local 2-hop search and Global Map-Reduce search.
- Write `supabase/functions/graph-debug/index.ts` to inspect extractions, list entities, and traverse localized subgraphs.

### Frontend Web Layer
- Update `App.jsx` to show three views: Tasks View, Graph Console (chat interface), and Contacts & Projects Directory.
- Implement inline citation extraction to turn `[Thread: XYZ]` tags into clickable badges that open details modals.
- Update `index.css` with dark bento styles and animations.

## Verification Plan

### Automated Tests
1. **Clustering & Graph Ingestion**: Run Deno test script `test-graph-ingest.ts` to verify entity deduplication and Louvain partitioning.
2. **Query Search**: Run Deno test script `test-graph-queries.ts` to execute Map-Reduce and local neighborhood queries.
3. **Frontend compilation**: Run `npm run build` in `frontend/` to confirm bundling compiles cleanly.

### Manual Verification
1. Inspect live DB tables using `supabase/db-debug` or Supabase CLI.
2. Run manual tests on `/graph-debug` diagnostic commands.
3. Verify that the UI displays biography summaries and clickable citations.
