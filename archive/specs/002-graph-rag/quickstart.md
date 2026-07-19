# Quickstart: GraphRAG Pipeline Setup

Follow these steps to initialize, configure, and verify the Context-Aware Property Graph and GraphRAG Pipeline in your local development environment.

## 1. Database Migrations

Apply the SQL migration to create the relational property graph schema:

```bash
# Apply migrations locally
supabase db reset
```

Verify that the tables (`contacts`, `projects`, `threads`, `emails`, `graph_edges`, `community_reports`, `community_members`) are created in the database.

---

## 2. Environment Configuration

Ensure your local `.env` (or Supabase secrets) contains your Groq API Key:

```text
GROQ_API_KEY=gsk_your_actual_groq_api_key_here
```

---

## 3. Seed Graph & Run Clustering

Run the Deno test script to sync mock emails, extract graph nodes/edges, and execute the Louvain community clustering partitioning:

```bash
# Run ingestion test
deno test --allow-net --allow-env supabase/functions/tests/test-graph-ingest.ts
```

This script will:
1. Insert mock emails (e.g., Project Apollo discussion threads, Acme Corp blockers).
2. Call the `GraphRAGExtractor` to parse triplets.
3. Call `GraphRAGStore.buildCommunities()` to run Louvain clustering and write community reports to the DB.

---

## 4. Run Search Queries

Verify the query engine resolves Local and Global Map-Reduce search queries successfully:

```bash
# Run search engine tests
deno test --allow-net --allow-env supabase/functions/tests/test-graph-queries.ts
```

This verifies:
- Cosine similarity pre-filtering selects the correct community reports.
- Map-reduce aggregates details into a clear consolidated response.
- Local search retrieves 2-hop subgraphs and formats citation tags.

---

## 5. Launch the React Web Client

Start the React development server:

```bash
cd frontend
npm install
npm run dev
```

Open your browser, login to Tasker, and navigate to the **Graph Console** tab to query the GraphRAG chat interface.
