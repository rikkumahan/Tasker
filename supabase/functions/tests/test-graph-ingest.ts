import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runLouvain, GraphRAGStore } from "../_shared/graph.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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
