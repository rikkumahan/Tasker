-- Finding #16 (SUPABASE_LOGIC_BUGS_FINDINGS.md): get_related_graph_context has no
-- auth check at all live — callable with just the public anon key, no login required.
-- The tracked source (017_action_context_retrieval.sql) called
-- `PERFORM assert_user_scope(p_user_id);`, but an untracked migration
-- ("extend_graph_context_2hop", applied live, no matching repo file — see finding #11)
-- introduced the current 2-hop recursive CTE and silently dropped that guard.
--
-- This restores the guard on top of the live 2-hop version (verified via
-- pg_get_functiondef against the live function on 2026-07-17) and, separately,
-- commits this migration itself to close part of the #11 drift for this function.

CREATE OR REPLACE FUNCTION public.get_related_graph_context(p_user_id uuid, p_thread_id uuid, max_results integer DEFAULT 20)
 RETURNS TABLE(node_id uuid, node_type text, relationship_type text, direction text, description text, label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM assert_user_scope(p_user_id);

  RETURN QUERY
  WITH RECURSIVE hop AS (
    -- Hop 1: direct outbound neighbors of the thread
    SELECT
      ge.target_id AS node_id,
      ge.target_type AS node_type,
      ge.relationship_type,
      'outbound'::text AS direction,
      ge.description,
      1 AS depth
    FROM graph_edges ge
    WHERE ge.user_id = p_user_id AND ge.source_id = p_thread_id

    UNION ALL

    -- Hop 1: direct inbound neighbors of the thread
    SELECT
      ge.source_id AS node_id,
      ge.source_type AS node_type,
      ge.relationship_type,
      'inbound'::text AS direction,
      ge.description,
      1 AS depth
    FROM graph_edges ge
    WHERE ge.user_id = p_user_id AND ge.target_id = p_thread_id

    UNION ALL

    -- Hop 2: neighbors of hop-1 neighbors (depth guard prevents cycles)
    SELECT
      ge2.target_id,
      ge2.target_type,
      ge2.relationship_type,
      'outbound'::text,
      ge2.description,
      h.depth + 1
    FROM graph_edges ge2
    INNER JOIN hop h ON ge2.source_id = h.node_id
    WHERE ge2.user_id = p_user_id AND h.depth < 2
  )
  SELECT DISTINCT ON (h.node_id)
    h.node_id,
    h.node_type,
    h.relationship_type,
    h.direction,
    h.description,
    COALESCE(c.name, p.name, t.subject, ai.description, 'Unknown') AS label
  FROM hop h
  LEFT JOIN contacts c ON h.node_type = 'contact' AND c.id = h.node_id AND c.user_id = p_user_id
  LEFT JOIN projects p ON h.node_type = 'project' AND p.id = h.node_id AND p.user_id = p_user_id
  LEFT JOIN threads t ON h.node_type = 'thread' AND t.id = h.node_id AND t.user_id = p_user_id
  LEFT JOIN action_items ai ON h.node_type = 'action_item' AND ai.id = h.node_id AND ai.user_id = p_user_id
  ORDER BY h.node_id, h.depth ASC
  LIMIT max_results;
END;
$function$;
