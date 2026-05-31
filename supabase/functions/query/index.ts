import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getEmbedding } from "../_shared/graph.ts";
import { authenticateUser, AuthenticatedUser } from "../_shared/auth.ts";
import { callLLM } from "../_shared/llm.ts";

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("MY_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
    );

    const user = await authenticateUser(req, supabaseAdmin);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { query, mode } = await req.json();
    if (!query) {
      return new Response(JSON.stringify({ error: "Query is required" }), { status: 400, headers: corsHeaders });
    }

    const selectedMode = mode === "global" ? "global" : "local";
    console.log(`[Query] Processing ${selectedMode} query: "${query}" for user ${user.id}`);

    const queryEmbedding = await getEmbedding(query);

    let result;
    if (selectedMode === "global") {
      result = await executeGlobalQuery(query, queryEmbedding, user, supabaseAdmin);
    } else {
      result = await executeLocalQuery(query, queryEmbedding, user, supabaseAdmin);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("[Query] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

// ─────────────────────────────────────────────
// GLOBAL QUERY ENGINE (Map-Reduce over Communities)
// ─────────────────────────────────────────────
async function executeGlobalQuery(query: string, queryEmbedding: number[], user: AuthenticatedUser, supabaseAdmin: SupabaseClient) {
  let { data: reports, error: rpcErr } = await supabaseAdmin.rpc("match_community_reports", {
    p_user_id: user.id,
    query_embedding: queryEmbedding,
    match_threshold: 0.2, 
    match_count: 8
  });

  if (rpcErr) {
    console.error("[Query] RPC match_community_reports failed:", rpcErr.message);
  }

  if (!reports || reports.length === 0) {
    console.log("[Query] No matching reports via similarity, pulling latest reports.");
    const { data: fallbackReports } = await supabaseAdmin
      .from("community_reports")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);
    reports = fallbackReports || [];
  }

  if (reports.length === 0) {
    return {
      answer: "No community clusters or reports are currently available in the graph. Please synchronize your email inbox first.",
      citations: []
    };
  }

  console.log(`[Query] Selected ${reports.length} community reports for Map step`);

  // Map Step
  const mapPromises = reports.map(async (report: any) => {
    const prompt = `You are a professional assistant. Answer the user's query using ONLY the provided community report.
If the report does not contain any information relevant to the query, answer exactly with the word "NO_INFO".
Do not elaborate or add generic knowledge.

USER QUERY:
${query}

COMMUNITY REPORT:
Title: ${report.title}
Summary: ${report.summary}
Urgency Rating: ${report.rating}/10 (${report.rating_explanation})
Findings: ${JSON.stringify(report.findings)}

RESPONSE:`;

    return await callLLM(prompt, { model: "meta-llama/llama-4-scout-17b-16e-instruct", temperature: 0.1 });
  });

  const mapResults = await Promise.all(mapPromises);
  const activeSummaries = mapResults.filter(r => r && r.trim() !== "" && r !== "NO_INFO");

  if (activeSummaries.length === 0) {
    return {
      answer: "I couldn't find any relevant business themes or project summaries matching your query in the communication history.",
      citations: []
    };
  }

  // Reduce Step
  const reducePrompt = `You are a helpful assistant. Synthesize the following partial summaries into a single cohesive, high-quality response answering the user's query.
Format your output beautifully using Markdown (bold text, section headers, bullet lists).
Do NOT mention "the provided summaries", "the community reports", or "the partial findings". Speak directly and authoritatively based on the corporate context.
If there are conflicting statuses or findings, highlight them clearly.

USER QUERY:
${query}

PARTIAL SUMMARIES:
${activeSummaries.join("\n\n---\n\n")}

CONSOLIDATED RESPONSE:`;

  let answer = await callLLM(reducePrompt, { model: "meta-llama/llama-4-scout-17b-16e-instruct", temperature: 0.3 });

  if (!answer) {
    answer = "Failed to synthesize a consolidated response. Please try again.";
  }

  return { answer, citations: [] };
}

// ─────────────────────────────────────────────
// LOCAL QUERY ENGINE (2-Hop Neighborhood Search)
// ─────────────────────────────────────────────
async function executeLocalQuery(query: string, queryEmbedding: number[], user: AuthenticatedUser, supabaseAdmin: SupabaseClient) {
  const { data: matchedEmails, error: emailErr } = await supabaseAdmin.rpc("match_emails", {
    p_user_id: user.id,
    query_embedding: queryEmbedding,
    match_threshold: 0.2,
    match_count: 5
  });

  if (emailErr || !matchedEmails || matchedEmails.length === 0) {
    console.log("[Query] No matching emails via vector search.");
    return {
      answer: "No relevant email communications found matching your query.",
      citations: []
    };
  }

  console.log(`[Query] Found ${matchedEmails.length} source emails. Resolving 2-hop neighborhood...`);

  const emailIds = matchedEmails.map((e: any) => e.id);
  const threadIds = Array.from(new Set(matchedEmails.map((e: any) => e.thread_id).filter(Boolean))) as string[];
  const senderIds = Array.from(new Set(matchedEmails.map((e: any) => e.sender_id).filter(Boolean))) as string[];

  const initialSeedIds = Array.from(new Set([...emailIds, ...threadIds, ...senderIds]));

  const { data: hop1Edges } = await supabaseAdmin
    .from("graph_edges")
    .select("source_id, target_id, source_type, target_type, relationship_type, description")
    .eq("user_id", user.id)
    .or(`source_id.in.(${initialSeedIds.join(",")}),target_id.in.(${initialSeedIds.join(",")})`);

  const neighborIdsSet = new Set<string>(initialSeedIds);
  (hop1Edges || []).forEach((e: any) => {
    neighborIdsSet.add(e.source_id);
    neighborIdsSet.add(e.target_id);
  });
  const neighborIds = Array.from(neighborIdsSet);

  let subgraphEdges: any[] = [];
  if (neighborIds.length > 0) {
    const { data: hop2Edges } = await supabaseAdmin
      .from("graph_edges")
      .select("source_id, target_id, source_type, target_type, relationship_type, description")
      .eq("user_id", user.id)
      .in("source_id", neighborIds)
      .in("target_id", neighborIds);
    subgraphEdges = hop2Edges || [];
  }

  const [contactsRes, projectsRes, threadsRes, tasksRes] = await Promise.all([
    supabaseAdmin.from("contacts").select("id, name, email, organization, bio_summary").eq("user_id", user.id).in("id", neighborIds),
    supabaseAdmin.from("projects").select("id, name, description, status").eq("user_id", user.id).in("id", neighborIds),
    supabaseAdmin.from("threads").select("id, gmail_thread_id, subject, semantic_summary, created_at").eq("user_id", user.id).in("id", neighborIds),
    supabaseAdmin.from("tasks").select("id, title, summary, status").eq("user_id", user.id).in("id", neighborIds)
  ]);

  const contacts = contactsRes.data || [];
  const projects = projectsRes.data || [];
  const threads = threadsRes.data || [];
  const tasks = tasksRes.data || [];

  const idToLabel = new Map<string, string>();
  contacts.forEach((c: any) => idToLabel.set(c.id, `${c.name} (${c.organization || "No Org"})`));
  projects.forEach((p: any) => idToLabel.set(p.id, `Project: ${p.name}`));
  threads.forEach((t: any) => idToLabel.set(t.id, `Thread: ${t.subject}`));
  tasks.forEach((t: any) => idToLabel.set(t.id, `Task: ${t.title}`));

  let subgraphText = "SUBGRAPH ENTITIES:\n";
  contacts.forEach((c: any) => { subgraphText += `- Contact: ${c.name} | Email: ${c.email} | Org: ${c.organization || "None"} | Bio: ${c.bio_summary || "None"}\n`; });
  projects.forEach((p: any) => { subgraphText += `- Project: ${p.name} | Status: ${p.status} | Description: ${p.description || "None"}\n`; });
  threads.forEach((t: any) => { subgraphText += `- Thread: ${t.subject} | Summary: ${t.semantic_summary || "None"}\n`; });
  tasks.forEach((t: any) => { subgraphText += `- Task: ${t.title} | Status: ${t.status} | Summary: ${t.summary || "None"}\n`; });

  subgraphText += "\nSUBGRAPH RELATIONSHIPS:\n";
  subgraphEdges.forEach((e: any) => {
    const srcLabel = idToLabel.get(e.source_id) || e.source_id;
    const tgtLabel = idToLabel.get(e.target_id) || e.target_id;
    subgraphText += `- ${srcLabel} (${e.source_type}) -[${e.relationship_type}]-> ${tgtLabel} (${e.target_type}) : ${e.description}\n`;
  });

  subgraphText += "\nRELEVANT EMAIL CORRESPONDENCE:\n";
  matchedEmails.forEach((email: any, index: number) => {
    subgraphText += `[Email ${index + 1}]\nSubject: ${email.subject}\nReceived: ${email.received_at}\nSnippet: ${email.snippet}\nContent: ${email.body}\n\n`;
  });

  const prompt = `You are a corporate intelligence system. Synthesize a detailed, highly accurate response to the user's query using ONLY the provided 2-hop neighborhood subgraph and relevant emails.
Include inline citation badges in the exact format [Thread: Subject] when referring to information sourced from email threads. The 'Subject' inside the badge MUST match the subject of one of the provided threads exactly.
Do not invent facts or mention documents not provided in the context.

USER QUERY:
${query}

CONTEXT SUBGRAPH & EMAILS:
${subgraphText}

synthesized RESPONSE WITH CITATIONS:`;

  let answer = await callLLM(prompt, { model: "meta-llama/llama-4-scout-17b-16e-instruct", temperature: 0.2 });

  if (!answer) {
    answer = "Failed to synthesize a local response. Please try again.";
  }

  const citationRegex = /\[Thread:\s*([^\]]+)\]/g;
  const foundSubjects = new Set<string>();
  let match;
  while ((match = citationRegex.exec(answer)) !== null) {
    foundSubjects.add(match[1].trim());
  }

  const citationsList: any[] = [];
  for (const subject of foundSubjects) {
    const matchedThread = threads.find((t: any) => t.subject.toLowerCase() === subject.toLowerCase());
    if (matchedThread) {
      const senderEdge = subgraphEdges.find((e: any) => e.target_id === matchedThread.id && e.source_type === "contact");
      let senderName = "Unknown";
      if (senderEdge) {
        const contactDetail = contacts.find((c: any) => c.id === senderEdge.source_id);
        if (contactDetail) {
          senderName = contactDetail.name || contactDetail.email;
        }
      }
      
      citationsList.push({
        type: "thread",
        subject: matchedThread.subject,
        gmail_thread_id: matchedThread.gmail_thread_id,
        snippet: matchedThread.semantic_summary || "",
        sender: senderName,
        date: matchedThread.created_at
      });
    }
  }

  return { answer, citations: citationsList };
}
