import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runLouvain, GraphRAGStore, ENTITY_TYPES, EMBEDDED_ENTITY_TYPES, parseSenderHeader, parseGraphTriplets } from "../_shared/graph.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// ISSUE-2 (e2e/ISSUES.md): raw `From:` headers with a quoted display name (RFC 5322 allows this,
// and Gmail commonly produces it for names containing [ ] or other special chars) were storing the
// literal surrounding quotes as the contact's name. Covers the quoted/unquoted/no-angle-brackets paths.
Deno.test("parseSenderHeader strips surrounding quotes from a quoted display name", () => {
  const { name, email } = parseSenderHeader('"Bh - Seethanagaram [Union Bank Of India]" <actual@email.com>');
  if (name !== "Bh - Seethanagaram [Union Bank Of India]") {
    throw new Error(`Expected quotes stripped, got: ${JSON.stringify(name)}`);
  }
  if (email !== "actual@email.com") {
    throw new Error(`Expected email parsed, got: ${JSON.stringify(email)}`);
  }
});

Deno.test("parseSenderHeader leaves an unquoted display name untouched", () => {
  const { name, email } = parseSenderHeader("John Smith <john@example.com>");
  if (name !== "John Smith") {
    throw new Error(`Expected unquoted name unchanged, got: ${JSON.stringify(name)}`);
  }
  if (email !== "john@example.com") {
    throw new Error(`Expected email parsed, got: ${JSON.stringify(email)}`);
  }
});

Deno.test("parseSenderHeader falls back to the local-part when there are no angle brackets", () => {
  const { name, email } = parseSenderHeader("jane.doe@example.com");
  if (name !== "jane.doe") {
    throw new Error(`Expected local-part fallback, got: ${JSON.stringify(name)}`);
  }
  if (email !== "jane.doe@example.com") {
    throw new Error(`Expected email to equal the raw sender string, got: ${JSON.stringify(email)}`);
  }
});

// e2e/ISSUES.md ISSUE-3: project descriptions ending in a corrupted fragment like
// `)\n## ("entity`. Root-caused to a pre-refactor triplet parser that used one greedy regex
// over the whole raw LLM response instead of splitting on "##" first, so a tuple's own closing
// ")" wasn't always treated as its terminator when followed by whitespace rather than "##"
// directly — the description swallowed the raw text of every following tuple. The current
// "##"-split parser can no longer produce this on its own, but these tests cover the
// defense-in-depth guard (RAW_TUPLE_LEAK) added to `parseEntityLine`/`parseRelationshipLine`
// so a description containing leaked tuple syntax is always dropped, not persisted.
Deno.test("parseGraphTriplets drops an entity whose description leaks raw tuple syntax", () => {
  // Simulates the shape of the corrupted rows found live in `projects.description`: a
  // truncated/malformed follow-on tuple whose text ended up inside a prior chunk.
  const raw = '("entity"|Daily Sync|EVENT|Daily Sync meeting, Rithvik, Tuesday 16 Jun 2026 2:15pm - 2:30pm, India Standard Time - Kolkata)\n## ("entity';
  const result = parseGraphTriplets(raw);
  if (result.entities.some((e) => e.description.includes("##") || e.description.includes('("entity'))) {
    throw new Error(`Leaked raw tuple syntax survived into a parsed description: ${JSON.stringify(result.entities)}`);
  }
});

Deno.test("parseGraphTriplets parses clean back-to-back entities without cross-contamination", () => {
  const raw = '("entity"|Maria|PERSON|Recipient asked to send the roadmap doc)\n##\n("entity"|Platform team|ORGANIZATION|Team that should receive the roadmap doc)';
  const result = parseGraphTriplets(raw);
  if (result.entities.length !== 2) {
    throw new Error(`Expected 2 clean entities, got ${result.entities.length}: ${JSON.stringify(result.entities)}`);
  }
  if (result.entities[0].description !== "Recipient asked to send the roadmap doc") {
    throw new Error(`First entity description corrupted: ${JSON.stringify(result.entities[0].description)}`);
  }
  if (result.droppedCount !== 0) {
    throw new Error(`Expected no drops for well-formed input, got ${result.droppedCount}`);
  }
});

// Guards the entity-embedding skip optimization: ingest_graphrag_payload (migration 017) only
// vector-matches PERSON/ORGANIZATION/TASK. If someone adds a new ENTITY_TYPE or changes which
// types the RPC vector-matches without updating this set, embeddings silently go to waste again
// (or get skipped for a type that now needs them) with no error to signal it.
Deno.test("EMBEDDED_ENTITY_TYPES matches the types ingest_graphrag_payload actually vector-matches", () => {
  const expected = new Set(["PERSON", "ORGANIZATION", "TASK"]);
  for (const t of ENTITY_TYPES) {
    const shouldEmbed = expected.has(t);
    if (EMBEDDED_ENTITY_TYPES.has(t) !== shouldEmbed) {
      throw new Error(`EMBEDDED_ENTITY_TYPES mismatch for ${t}: expected ${shouldEmbed}`);
    }
  }
});

// 1. Unit Test for Louvain clustering (offline, no DB or network dependency)
Deno.test("Louvain clustering partitions simple cliques correctly", () => {
  // Let's create two clear, disconnected cliques
  // Clique 1: A, B, C
  // Clique 2: D, E, F
  const nodes = ["A", "B", "C", "D", "E", "F"];
  const edges = [
    { source: "A", target: "B", weight: 1 },
    { source: "B", target: "C", weight: 1 },
    { source: "C", target: "A", weight: 1 },
    { source: "D", target: "E", weight: 1 },
    { source: "E", target: "F", weight: 1 },
    { source: "F", target: "D", weight: 1 }
  ];

  const partitions = runLouvain(nodes, edges);
  
  // A, B, C should share the same community
  console.log("[Louvain Test] Computed partitions:", partitions);
  const comm1 = partitions["A"];
  const comm2 = partitions["D"];

  if (!comm1 || !comm2) {
    throw new Error("Partitions should not be null or undefined");
  }

  if (partitions["B"] !== comm1 || partitions["C"] !== comm1) {
    throw new Error("A, B, C should be in the same community");
  }

  if (partitions["E"] !== comm2 || partitions["F"] !== comm2) {
    throw new Error("D, E, F should be in the same community");
  }

  if (comm1 === comm2) {
    throw new Error("The two cliques should be in different communities");
  }
  
  console.log("✅ Louvain clustering unit test passed!");
});

// 2. Integration Test for Graph Ingestion and Community building
Deno.test("Graph Ingestion and Louvain buildCommunities", async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log("⚠️ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Skipping DB integration test.");
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const store = new GraphRAGStore(supabase);

  // Generate a unique test user id
  const testUserId = "00000000-0000-0000-0000-000000000001";

  // Ingest mock email 1 (Project Apollo status update)
  const email1 = {
    message_id: "test_msg_apollo_01",
    subject: "Project Apollo Status Update",
    body: "Hi team, Alice here. I am currently assigned to Project Apollo and working on the database migrations. We are building the graph tables but currently blocked by Bob on API security reviews. Let's align in the weekly demo.",
    sender: "Alice Vance <alice.vance@tasker.local>",
    thread_id: "test_thread_apollo_abc",
    received_at: new Date().toISOString()
  };

  // Ingest mock email 2 (Dispute with Acme Corp)
  const email2 = {
    message_id: "test_msg_vendor_01",
    subject: "Urgent: Acme Corp Contract Dispute",
    body: "Hi John, Charlie from legal here. We have an active dispute with Acme Corp regarding the terms of service on their integration workspace. Charlie is collaborating with Alice to resolve this legal blocker immediately.",
    sender: "Charlie Lawson <charlie.lawson@tasker.local>",
    thread_id: "test_thread_vendor_xyz",
    received_at: new Date().toISOString()
  };

  console.log("[Test Ingest] Ingesting email 1...");
  await store.ingestEmailToGraph(email1, testUserId);

  console.log("[Test Ingest] Ingesting email 2...");
  await store.ingestEmailToGraph(email2, testUserId);

  // Assert that nodes and edges are populated in the DB
  const { data: contacts } = await supabase.from("contacts").select("id, name");
  const { data: edges } = await supabase.from("graph_edges").select("id");
  const { data: threads } = await supabase.from("threads").select("id, subject");

  console.log(`[Test Assert] Ingested contacts count: ${contacts?.length || 0}`);
  console.log(`[Test Assert] Ingested graph edges count: ${edges?.length || 0}`);
  console.log(`[Test Assert] Ingested threads count: ${threads?.length || 0}`);

  if (!contacts || contacts.length === 0) {
    throw new Error("No contacts were inserted during email ingestion");
  }
  if (!threads || threads.length === 0) {
    throw new Error("No email threads were inserted");
  }

  // 3. Rebuild Communities
  console.log("[Test Louvain] Rebuilding communities...");
  await store.buildCommunities();

  // Assert that community reports and membership records exist
  const { data: reports } = await supabase.from("community_reports").select("id, title, rating");
  const { data: members } = await supabase.from("community_members").select("id");

  console.log(`[Test Assert] Rebuilt community reports: ${reports?.length || 0}`);
  console.log(`[Test Assert] Rebuilt community members: ${members?.length || 0}`);

  if (reports && reports.length > 0) {
    console.log("[Test Assert] Sample Report:", reports[0]);
  } else {
    console.warn("⚠️ No community reports created. This can happen if Louvain groups are smaller than 2 nodes or if LLM API failed.");
  }

  console.log("✅ Graph Ingestion & Community Rebuild integration test complete!");
});
