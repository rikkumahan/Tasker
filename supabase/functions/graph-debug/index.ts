import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { GraphRAGExtractor } from "../_shared/graph.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing Auth" }), { status: 401, headers: corsHeaders });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify user JWT
    const tokenStr = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(tokenStr);
    if (authErr || !authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "extract-sample") {
      // ─────────────────────────────────────────────
      // TRIPLET EXTRACTION DRY-RUN
      // ─────────────────────────────────────────────
      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method must be POST" }), { status: 405, headers: corsHeaders });
      }

      const { text } = await req.json();
      if (!text) {
        return new Response(JSON.stringify({ error: "Text is required" }), { status: 400, headers: corsHeaders });
      }

      const extractor = new GraphRAGExtractor();
      const { entities, relationships } = await extractor.extractFromEmail(text, "Sample Dry Run");

      return new Response(JSON.stringify({
        entities: entities.map(e => ({ name: e.name, type: e.entityType, description: e.description })),
        relationships: relationships.map(r => ({ source: r.source, target: r.target, relation: r.relationType, description: r.description, strength: r.strength }))
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } else if (action === "inspect-node") {
      // ─────────────────────────────────────────────
      // INSPECT NODE CONNECTIONS
      // ─────────────────────────────────────────────
      const name = url.searchParams.get("name");
      const id = url.searchParams.get("id");

      if (!name && !id) {
        return new Response(JSON.stringify({ error: "Either name or id parameter is required" }), { status: 400, headers: corsHeaders });
      }

      let entity: any = null;
      let type = "unknown";

      if (id) {
        // Search across all tables by ID
        const [contactRes, projectRes, threadRes, taskRes] = await Promise.all([
          supabaseAdmin.from("contacts").select("*").eq("id", id).maybeSingle(),
          supabaseAdmin.from("projects").select("*").eq("id", id).maybeSingle(),
          supabaseAdmin.from("threads").select("*").eq("id", id).maybeSingle(),
          supabaseAdmin.from("tasks").select("*").eq("id", id).maybeSingle()
        ]);

        if (contactRes.data) {
          entity = contactRes.data;
          type = "CONTACT";
        } else if (projectRes.data) {
          entity = projectRes.data;
          type = "PROJECT";
        } else if (threadRes.data) {
          entity = threadRes.data;
          type = "THREAD";
        } else if (taskRes.data) {
          entity = taskRes.data;
          type = "TASK";
        }
      } else if (name) {
        // Search by name/subject/title
        const [contactRes, projectRes, threadRes, taskRes] = await Promise.all([
          supabaseAdmin.from("contacts").select("*").ilike("name", name).limit(1),
          supabaseAdmin.from("projects").select("*").ilike("name", name).limit(1),
          supabaseAdmin.from("threads").select("*").ilike("subject", name).limit(1),
          supabaseAdmin.from("tasks").select("*").ilike("title", name).limit(1)
        ]);

        if (contactRes.data && contactRes.data.length > 0) {
          entity = contactRes.data[0];
          type = "CONTACT";
        } else if (projectRes.data && projectRes.data.length > 0) {
          entity = projectRes.data[0];
          type = "PROJECT";
        } else if (threadRes.data && threadRes.data.length > 0) {
          entity = threadRes.data[0];
          type = "THREAD";
        } else if (taskRes.data && taskRes.data.length > 0) {
          entity = taskRes.data[0];
          type = "TASK";
        }
      }

      if (!entity) {
        return new Response(JSON.stringify({ error: "Node not found" }), { status: 404, headers: corsHeaders });
      }

      // Fetch all edges connected to this node
      const { data: edges } = await supabaseAdmin
        .from("graph_edges")
        .select("*")
        .or(`source_id.eq.${entity.id},target_id.eq.${entity.id}`);

      // Map edges to full connection details
      const connections: any[] = [];
      const neighborIds = (edges || []).map((e: any) => e.source_id === entity.id ? e.target_id : e.source_id);

      // Load neighbor details in parallel
      const [nContacts, nProjects, nThreads, nTasks] = await Promise.all([
        supabaseAdmin.from("contacts").select("id, name").in("id", neighborIds),
        supabaseAdmin.from("projects").select("id, name").in("id", neighborIds),
        supabaseAdmin.from("threads").select("id, subject").in("id", neighborIds),
        supabaseAdmin.from("tasks").select("id, title").in("id", neighborIds)
      ]);

      const idToNameMap = new Map<string, string>();
      const idToTypeMap = new Map<string, string>();

      (nContacts.data || []).forEach((c: any) => { idToNameMap.set(c.id, c.name); idToTypeMap.set(c.id, "CONTACT"); });
      (nProjects.data || []).forEach((p: any) => { idToNameMap.set(p.id, p.name); idToTypeMap.set(p.id, "PROJECT"); });
      (nThreads.data || []).forEach((t: any) => { idToNameMap.set(t.id, t.subject); idToTypeMap.set(t.id, "THREAD"); });
      (nTasks.data || []).forEach((t: any) => { idToNameMap.set(t.id, t.title); idToTypeMap.set(t.id, "TASK"); });

      (edges || []).forEach((e: any) => {
        const isSource = e.source_id === entity.id;
        const neighborId = isSource ? e.target_id : e.source_id;
        connections.push({
          edge_id: e.id,
          target_name: idToNameMap.get(neighborId) || neighborId,
          target_type: idToTypeMap.get(neighborId) || (isSource ? e.target_type : e.source_type),
          relationship_type: e.relationship_type,
          description: e.description,
          direction: isSource ? "outgoing" : "incoming"
        });
      });

      return new Response(JSON.stringify({
        entity: {
          id: entity.id,
          name: entity.name || entity.subject || entity.title,
          type,
          organization: entity.organization || null,
          bio_summary: entity.bio_summary || entity.semantic_summary || entity.summary || null
        },
        connections
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } else {
      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: corsHeaders });
    }

  } catch (err: any) {
    console.error("[GraphDebug] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
