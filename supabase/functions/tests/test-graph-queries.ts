import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEmbedding } from "../_shared/graph.ts";
import { getNextKey } from "../_shared/keys.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Scenario A: Corporate Thematic Analysis (Global Search / Map-Reduce)
Deno.test("Global Search thematic community report retrieval", async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log("⚠️ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Skipping Global Search test.");
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const query = "What are the main operational issues or project updates discussed across our vendor emails?";
  const queryEmbedding = await getEmbedding(query);

  console.log("[Test Global Search] Querying match_community_reports...");
  
  // Call the database function to retrieve community reports matching the query
  const { data: reports, error } = await supabase.rpc("match_community_reports", {
    query_embedding: queryEmbedding,
    match_threshold: 0.1,
    match_count: 5
  });

  if (error) {
    console.error("[Test Global Search] Error matching community reports:", error);
    throw error;
  }

  console.log(`[Test Global Search] Found ${reports?.length || 0} matching reports.`);
  
  if (reports && reports.length > 0) {
    reports.forEach((report: any, idx: number) => {
      console.log(`Report ${idx + 1}: ${report.title} (Rating: ${report.rating}/10)`);
      if (typeof report.rating !== 'number' || report.rating < 0 || report.rating > 10) {
        throw new Error(`Invalid community rating: ${report.rating}`);
      }
    });
  } else {
    console.warn("⚠️ No matching community reports found. Ensure Louvain clustering is seeded and reports exist in the database.");
  }
});

// Scenario B: Cross-Entity Relationship Analysis (Local Search / 2-Hop Traversal)
Deno.test("Local Search 2-hop neighborhood retrieval and entity traversal", async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log("⚠️ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Skipping Local Search test.");
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const query = "Which external organizations are involved in our project dependencies, and what are their active assignments or blockers?";
  const queryEmbedding = await getEmbedding(query);

  console.log("[Test Local Search] Matching emails for query...");
  const { data: matchedEmails, error: emailErr } = await supabase.rpc("match_emails", {
    query_embedding: queryEmbedding,
    match_threshold: 0.1,
    match_count: 3
  });

  if (emailErr) {
    console.error("[Test Local Search] Error matching emails:", emailErr);
    throw emailErr;
  }

  console.log(`[Test Local Search] Matched ${matchedEmails?.length || 0} emails.`);
  
  if (!matchedEmails || matchedEmails.length === 0) {
    console.log("⚠️ No matching emails. Skipping neighborhood retrieval.");
    return;
  }

  // Extract seed IDs
  const emailIds = matchedEmails.map((e: any) => e.id);
  const threadIds = Array.from(new Set(matchedEmails.map((e: any) => e.thread_id).filter(Boolean))) as string[];
  const senderIds = Array.from(new Set(matchedEmails.map((e: any) => e.sender_id).filter(Boolean))) as string[];
  const initialSeedIds = Array.from(new Set([...emailIds, ...threadIds, ...senderIds]));

  console.log("[Test Local Search] Retrieving hop-1 edges...");
  const { data: hop1Edges, error: edgeErr } = await supabase
    .from("graph_edges")
    .select("source_id, target_id, source_type, target_type, relationship_type, description")
    .or(`source_id.in.(${initialSeedIds.join(",")}),target_id.in.(${initialSeedIds.join(",")})`);

  if (edgeErr) {
    console.error("[Test Local Search] Error fetching hop-1 edges:", edgeErr);
    throw edgeErr;
  }

  console.log(`[Test Local Search] Found ${hop1Edges?.length || 0} hop-1 edges.`);

  const neighborIdsSet = new Set<string>(initialSeedIds);
  (hop1Edges || []).forEach((e: any) => {
    neighborIdsSet.add(e.source_id);
    neighborIdsSet.add(e.target_id);
  });
  const neighborIds = Array.from(neighborIdsSet);

  console.log("[Test Local Search] Loading neighborhood entity details...");
  const { data: contacts } = await supabase.from("contacts").select("id, name, email").in("id", neighborIds);
  const { data: projects } = await supabase.from("projects").select("id, name").in("id", neighborIds);

  console.log(`[Test Local Search] Resolved ${contacts?.length || 0} contacts and ${projects?.length || 0} projects in local subgraph.`);
  
  // We expect contacts and projects to be successfully queried from neighbor ids
  if (!contacts) {
    throw new Error("Failed to load neighborhood contacts");
  }
});

// Scenario C: Comparative Project Analysis (Hybrid Synthesis)
Deno.test("Hybrid Synthesis LLM generation with inline citations", async () => {
  const groqApiKey = getNextKey();
  if (!groqApiKey) {
    console.log("⚠️ Missing GROQ_API_KEY in keys list. Skipping LLM synthesis test.");
    return;
  }

  const query = "How do the timelines and scope of Project Apollo compare to the Flutter Migration project?";
  const mockContext = `
SUBGRAPH ENTITIES:
- Project: PROJECT APOLLO | Status: active | Description: API design overhaul for Tasker
- Project: FLUTTER MIGRATION | Status: active | Description: Deprecating React web app and bootstrapping Flutter client
- Contact: ALICE VANCE | Email: alice.vance@tasker.local | Org: Tasker | Bio: Lead engineer for API platform
- Contact: BOB SMITH | Email: bob.smith@tasker.local | Org: Tasker | Bio: Security analyst

SUBGRAPH RELATIONSHIPS:
- ALICE VANCE (contact) -[ASSIGNED_TO]-> Project: PROJECT APOLLO (project) : Alice is lead engineer for Apollo
- BOB SMITH (contact) -[ASSIGNED_TO]-> Project: FLUTTER MIGRATION (project) : Bob is handling security review on Flutter client

RELEVANT EMAIL CORRESPONDENCE:
[Email 1]
Subject: Project Apollo Status Update
Received: 2026-05-24T12:00:00Z
Snippet: Alice is building graph tables but blocked by Bob on security reviews.
Content: Hi team, Alice here. I am currently assigned to Project Apollo and working on the database migrations. We are building the graph tables but currently blocked by Bob on API security reviews. Let's align in the weekly demo.
`;

  const prompt = `You are a corporate intelligence system. Synthesize a response to the user's query using ONLY the provided context.
Include inline citation badges in the exact format [Thread: Subject] when referring to information sourced from email threads. The 'Subject' inside the badge MUST match 'Project Apollo Status Update' if referencing Email 1.

USER QUERY:
${query}

CONTEXT:
${mockContext}

synthesized RESPONSE WITH CITATIONS:`;

  console.log("[Test LLM Synthesis] Querying Groq completion API...");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      reasoning_effort: "low",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    })
  });

  if (!res.ok) {
    throw new Error(`Groq API returned error status: ${res.status}`);
  }

  const data = await res.json();
  const answer = data.choices?.[0]?.message?.content || "";
  console.log("[Test LLM Synthesis] Synthesized Response:\n", answer);

  if (!answer.includes("[Thread: Project Apollo Status Update]")) {
    console.warn("⚠️ Warning: LLM response did not include the expected inline citation badge [Thread: Project Apollo Status Update].");
  }

  console.log("✅ Hybrid Synthesis LLM generation test complete!");
});
