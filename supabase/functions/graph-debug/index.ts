import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { GraphRAGExtractor, GraphRAGStore } from "../_shared/graph.ts";
import { authenticateUser, AuthenticatedUser } from "../_shared/auth.ts";

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

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    let result;
    switch (action) {
      case "stats":
        result = await handleStats(user, supabaseAdmin);
        break;
      case "list-communities":
        result = await handleListCommunities(user, supabaseAdmin);
        break;
      case "rebuild-communities":
        if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method must be POST" }), { status: 405, headers: corsHeaders });
        result = await handleRebuildCommunities(user, supabaseAdmin);
        break;
      case "neighborhood":
        // NOTE: currently returns a 500 — get_entity_neighborhood has no p_user_id param yet.
        // Not a live leak (finding #1's correction), but don't add scoping here until the RPC
        // itself is migrated to accept/filter by p_user_id — a mismatched param would just be a
        // different flavor of broken. Tracked, not silently left broken by accident.
        result = await handleNeighborhood(url, supabaseAdmin);
        break;
      case "timeline":
        // Same caveat as "neighborhood" above — get_entity_timeline has no p_user_id param yet.
        result = await handleTimeline(url, supabaseAdmin);
        break;
      case "extract-sample":
        if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method must be POST" }), { status: 405, headers: corsHeaders });
        result = await handleExtractSample(req);
        break;
      case "inspect-node":
        result = await handleInspectNode(user, url, supabaseAdmin);
        break;
      default:
        return new Response(JSON.stringify({
          error: "Invalid action",
          available_actions: ["stats", "list-communities", "rebuild-communities", "neighborhood", "timeline", "extract-sample", "inspect-node"]
        }), { status: 400, headers: corsHeaders });
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[GraphDebug] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

async function handleStats(user: AuthenticatedUser, supabaseAdmin: SupabaseClient) {
  const [
    { count: contactsCount },
    { count: projectsCount },
    { count: threadsCount },
    { count: emailsCount },
    { count: edgesCount },
    { count: communitiesCount },
    { count: membersCount }
  ] = await Promise.all([
    supabaseAdmin.from("contacts").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabaseAdmin.from("projects").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabaseAdmin.from("threads").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabaseAdmin.from("emails").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabaseAdmin.from("graph_edges").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabaseAdmin.from("community_reports").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabaseAdmin.from("community_members").select("*", { count: "exact", head: true }).eq("user_id", user.id)
  ]);

  const { data: edgeTypes } = await supabaseAdmin.from("graph_edges").select("relationship_type").eq("user_id", user.id).limit(500);
  const typeCount: Record<string, number> = {};
  (edgeTypes || []).forEach((e: any) => { typeCount[e.relationship_type] = (typeCount[e.relationship_type] || 0) + 1; });
  const topRelationships = Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([rel, count]) => ({ relationship_type: rel, count }));

  return {
    graph_stats: {
      contacts: contactsCount ?? 0,
      projects: projectsCount ?? 0,
      threads: threadsCount ?? 0,
      emails: emailsCount ?? 0,
      graph_edges: edgesCount ?? 0,
      community_reports: communitiesCount ?? 0,
      community_members: membersCount ?? 0
    },
    top_relationships: topRelationships
  };
}

async function handleListCommunities(user: AuthenticatedUser, supabaseAdmin: SupabaseClient) {
  const { data: reports, error } = await supabaseAdmin
    .from("community_reports")
    .select("id, title, summary, rating, rating_explanation, created_at, community_members(count)")
    .eq("user_id", user.id)
    .order("rating", { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);

  const enriched = (reports || []).map((r: any) => ({
    ...r,
    member_count: r.community_members?.[0]?.count ?? 0,
    community_members: undefined 
  }));

  return { communities: enriched };
}

async function handleRebuildCommunities(user: AuthenticatedUser, supabaseAdmin: SupabaseClient) {
  const store = new GraphRAGStore(supabaseAdmin);
  const t0 = Date.now();
  await store.buildCommunities(user.id);
  const elapsed = Date.now() - t0;

  const { count } = await supabaseAdmin
    .from("community_reports")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  return {
    message: "Community rebuild complete",
    elapsed_ms: elapsed,
    community_count: count ?? 0
  };
}

async function handleNeighborhood(url: URL, supabaseAdmin: SupabaseClient) {
  const nodeId = url.searchParams.get("id");
  const rawHops = parseInt(url.searchParams.get("hops") || "1", 10);
  const hops = isNaN(rawHops) || rawHops < 1 ? 1 : Math.min(rawHops, 5);

  if (!nodeId) throw new Error("id parameter is required");

  const { data: neighbors, error } = await supabaseAdmin.rpc("get_entity_neighborhood", {
    seed_node_id: nodeId,
    max_hops: hops,
    max_neighbors: 50
  });

  if (error) throw new Error(error.message);

  return { seed_id: nodeId, hops, neighbors: neighbors || [] };
}

async function handleTimeline(url: URL, supabaseAdmin: SupabaseClient) {
  const entityId = url.searchParams.get("id");
  if (!entityId) throw new Error("id parameter is required");

  const { data: timeline, error } = await supabaseAdmin.rpc("get_entity_timeline", {
    entity_id: entityId,
    limit_rows: 30
  });

  if (error) throw new Error(error.message);

  return { entity_id: entityId, timeline: timeline || [] };
}

async function handleExtractSample(req: Request) {
  const { text } = await req.json();
  if (!text) throw new Error("Text is required");

  const extractor = new GraphRAGExtractor();
  const { entities, relationships } = await extractor.extractFromEmail(text, "Sample Dry Run");

  return {
    entities: entities.map(e => ({ name: e.name, type: e.entityType, description: e.description })),
    relationships: relationships.map(r => ({ source: r.source, target: r.target, relation: r.relationType, description: r.description, strength: r.strength }))
  };
}

async function handleInspectNode(user: AuthenticatedUser, url: URL, supabaseAdmin: SupabaseClient) {
  const name = url.searchParams.get("name");
  const id = url.searchParams.get("id");

  if (!name && !id) throw new Error("Either name or id parameter is required");

  let entity: any = null;
  let type = "unknown";

  if (id) {
    const [contactRes, projectRes, threadRes, taskRes] = await Promise.all([
      supabaseAdmin.from("contacts").select("*").eq("id", id).eq("user_id", user.id).maybeSingle(),
      supabaseAdmin.from("projects").select("*").eq("id", id).eq("user_id", user.id).maybeSingle(),
      supabaseAdmin.from("threads").select("*").eq("id", id).eq("user_id", user.id).maybeSingle(),
      supabaseAdmin.from("tasks").select("*").eq("id", id).eq("user_id", user.id).maybeSingle()
    ]);

    if (contactRes.data) { entity = contactRes.data; type = "CONTACT"; }
    else if (projectRes.data) { entity = projectRes.data; type = "PROJECT"; }
    else if (threadRes.data) { entity = threadRes.data; type = "THREAD"; }
    else if (taskRes.data) { entity = taskRes.data; type = "TASK"; }
  } else if (name) {
    const [contactRes, projectRes, threadRes, taskRes] = await Promise.all([
      supabaseAdmin.from("contacts").select("*").ilike("name", name).eq("user_id", user.id).limit(1),
      supabaseAdmin.from("projects").select("*").ilike("name", name).eq("user_id", user.id).limit(1),
      supabaseAdmin.from("threads").select("*").ilike("subject", name).eq("user_id", user.id).limit(1),
      supabaseAdmin.from("tasks").select("*").ilike("title", name).eq("user_id", user.id).limit(1)
    ]);

    if (contactRes.data?.length) { entity = contactRes.data[0]; type = "CONTACT"; }
    else if (projectRes.data?.length) { entity = projectRes.data[0]; type = "PROJECT"; }
    else if (threadRes.data?.length) { entity = threadRes.data[0]; type = "THREAD"; }
    else if (taskRes.data?.length) { entity = taskRes.data[0]; type = "TASK"; }
  }

  if (!entity) throw new Error("Node not found");

  const { data: edges } = await supabaseAdmin
    .from("graph_edges")
    .select("*")
    .eq("user_id", user.id)
    .or(`source_id.eq.${entity.id},target_id.eq.${entity.id}`);

  const neighborIds = (edges || []).map((e: any) => e.source_id === entity.id ? e.target_id : e.source_id);

  const [nContacts, nProjects, nThreads, nTasks] = neighborIds.length === 0
    ? [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]
    : await Promise.all([
        supabaseAdmin.from("contacts").select("id, name").in("id", neighborIds).eq("user_id", user.id),
        supabaseAdmin.from("projects").select("id, name").in("id", neighborIds).eq("user_id", user.id),
        supabaseAdmin.from("threads").select("id, subject").in("id", neighborIds).eq("user_id", user.id),
        supabaseAdmin.from("tasks").select("id, title").in("id", neighborIds).eq("user_id", user.id)
      ]);

  const idToNameMap = new Map<string, string>();
  const idToTypeMap = new Map<string, string>();
  (nContacts.data || []).forEach((c: any) => { idToNameMap.set(c.id, c.name); idToTypeMap.set(c.id, "CONTACT"); });
  (nProjects.data || []).forEach((p: any) => { idToNameMap.set(p.id, p.name); idToTypeMap.set(p.id, "PROJECT"); });
  (nThreads.data || []).forEach((t: any) => { idToNameMap.set(t.id, t.subject); idToTypeMap.set(t.id, "THREAD"); });
  (nTasks.data || []).forEach((t: any) => { idToNameMap.set(t.id, t.title); idToTypeMap.set(t.id, "TASK"); });

  const connections = (edges || []).map((e: any) => {
    const isSource = e.source_id === entity.id;
    const neighborId = isSource ? e.target_id : e.source_id;
    return {
      edge_id: e.id,
      target_name: idToNameMap.get(neighborId) || neighborId,
      target_type: idToTypeMap.get(neighborId) || (isSource ? e.target_type : e.source_type),
      relationship_type: e.relationship_type,
      description: e.description,
      direction: isSource ? "outgoing" : "incoming"
    };
  });

  return {
    entity: {
      id: entity.id,
      name: entity.name || entity.subject || entity.title,
      type,
      organization: entity.organization || null,
      bio_summary: entity.bio_summary || entity.semantic_summary || entity.summary || null
    },
    connections
  };
}
