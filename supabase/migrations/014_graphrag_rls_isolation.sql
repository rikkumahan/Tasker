-- ============================================================
-- Migration: 014_graphrag_rls_isolation
-- Description: Adds user_id to all GraphRAG tables to enforce
--              strict multi-tenancy and privacy isolation.
--              Updates unique constraints to be user-scoped.
--              Enables and configures RLS for all graph tables.
--              Updates RPCs to strictly filter by user_id.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. DELETE EXISTING DATA (to prevent constraint violations)
-- ─────────────────────────────────────────────
TRUNCATE TABLE graph_edges CASCADE;
TRUNCATE TABLE community_members CASCADE;
TRUNCATE TABLE community_reports CASCADE;
TRUNCATE TABLE emails CASCADE;
TRUNCATE TABLE threads CASCADE;
TRUNCATE TABLE projects CASCADE;
TRUNCATE TABLE contacts CASCADE;

-- ─────────────────────────────────────────────
-- 2. ADD user_id COLUMNS
-- ─────────────────────────────────────────────
ALTER TABLE contacts ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE threads ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE emails ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE community_reports ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE graph_edges ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE community_members ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────
-- 3. UPDATE UNIQUE CONSTRAINTS
-- ─────────────────────────────────────────────
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_email_key;
ALTER TABLE contacts ADD CONSTRAINT contacts_user_email_key UNIQUE (user_id, email);

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_name_key;
ALTER TABLE projects ADD CONSTRAINT projects_user_name_key UNIQUE (user_id, name);

ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_gmail_thread_id_key;
ALTER TABLE threads ADD CONSTRAINT threads_user_gmail_thread_id_key UNIQUE (user_id, gmail_thread_id);

ALTER TABLE emails DROP CONSTRAINT IF EXISTS emails_message_id_key;
ALTER TABLE emails ADD CONSTRAINT emails_user_message_id_key UNIQUE (user_id, message_id);

-- ─────────────────────────────────────────────
-- 4. ENABLE ROW LEVEL SECURITY (RLS)
-- ─────────────────────────────────────────────
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- 5. DROP INSECURE "TRUE" POLICIES
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow authenticated SELECT on contacts" ON contacts;
DROP POLICY IF EXISTS "Allow authenticated ALL on contacts" ON contacts;
DROP POLICY IF EXISTS "Allow authenticated SELECT on projects" ON projects;
DROP POLICY IF EXISTS "Allow authenticated ALL on projects" ON projects;
DROP POLICY IF EXISTS "Allow authenticated SELECT on threads" ON threads;
DROP POLICY IF EXISTS "Allow authenticated ALL on threads" ON threads;
DROP POLICY IF EXISTS "Allow authenticated SELECT on emails" ON emails;
DROP POLICY IF EXISTS "Allow authenticated ALL on emails" ON emails;
DROP POLICY IF EXISTS "Allow authenticated SELECT on community_reports" ON community_reports;
DROP POLICY IF EXISTS "Allow authenticated ALL on community_reports" ON community_reports;
DROP POLICY IF EXISTS "Allow authenticated SELECT on community_members" ON community_members;
DROP POLICY IF EXISTS "Allow authenticated ALL on community_members" ON community_members;
DROP POLICY IF EXISTS "Allow authenticated SELECT on graph_edges" ON graph_edges;
DROP POLICY IF EXISTS "Allow authenticated ALL on graph_edges" ON graph_edges;

-- ─────────────────────────────────────────────
-- 6. CREATE STRICT MULTI-TENANCY POLICIES
-- ─────────────────────────────────────────────
CREATE POLICY "Users can view their own contacts" ON contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own contacts" ON contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own contacts" ON contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own contacts" ON contacts FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own projects" ON projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own projects" ON projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own projects" ON projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own projects" ON projects FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own threads" ON threads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own threads" ON threads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own threads" ON threads FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own threads" ON threads FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own emails" ON emails FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own emails" ON emails FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own emails" ON emails FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own emails" ON emails FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own community reports" ON community_reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own community reports" ON community_reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own community reports" ON community_reports FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own community reports" ON community_reports FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own community members" ON community_members FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own community members" ON community_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own community members" ON community_members FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own community members" ON community_members FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own graph edges" ON graph_edges FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own graph edges" ON graph_edges FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own graph edges" ON graph_edges FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own graph edges" ON graph_edges FOR DELETE USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 7. UPDATE RPCs TO SCOPE TO USER
-- Drop existing first because parameter signatures are changing
-- ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS match_contacts(vector(1536), float, int);
DROP FUNCTION IF EXISTS match_emails(vector(1536), float, int);
DROP FUNCTION IF EXISTS match_community_reports(vector(1536), float, int);
DROP FUNCTION IF EXISTS get_entity_neighborhood(uuid, int, int);
DROP FUNCTION IF EXISTS find_path_between_entities(uuid, uuid);
DROP FUNCTION IF EXISTS get_entity_timeline(uuid, int);

CREATE OR REPLACE FUNCTION match_contacts(
  p_user_id        uuid,
  query_embedding  vector(1536),
  match_threshold  float    DEFAULT 0.85,
  match_count      int      DEFAULT 5
)
RETURNS TABLE (
  id            uuid,
  email         text,
  name          text,
  organization  text,
  bio_summary   text,
  similarity    float
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.email, c.name, c.organization, c.bio_summary,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM contacts c
  WHERE c.user_id = p_user_id
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_emails(
  p_user_id        uuid,
  query_embedding  vector(1536),
  match_threshold  float   DEFAULT 0.2,
  match_count      int     DEFAULT 5
)
RETURNS TABLE (
  id          uuid,
  message_id  text,
  thread_id   uuid,
  sender_id   uuid,
  subject     text,
  body        text,
  snippet     text,
  received_at timestamptz,
  similarity  float
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.message_id, e.thread_id, e.sender_id, e.subject, e.body, e.snippet, e.received_at,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM emails e
  WHERE e.user_id = p_user_id
    AND e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) >= match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_community_reports(
  p_user_id        uuid,
  query_embedding  vector(1536),
  match_threshold  float   DEFAULT 0.2,
  match_count      int     DEFAULT 8
)
RETURNS TABLE (
  id                  uuid,
  title               text,
  summary             text,
  rating              numeric,
  rating_explanation  text,
  findings            jsonb,
  similarity          float
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cr.id, cr.title, cr.summary, cr.rating, cr.rating_explanation, cr.findings,
    1 - (cr.embedding <=> query_embedding) AS similarity
  FROM community_reports cr
  WHERE cr.user_id = p_user_id
    AND cr.embedding IS NOT NULL
    AND 1 - (cr.embedding <=> query_embedding) >= match_threshold
  ORDER BY cr.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION get_entity_neighborhood(
  p_user_id       uuid,
  seed_node_id    uuid,
  max_hops        int  DEFAULT 1,
  max_neighbors   int  DEFAULT 20
)
RETURNS TABLE (
  node_id           uuid,
  node_type         text,
  relationship_type text,
  direction         text,
  description       text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  -- Outbound edges
  SELECT
    ge.target_id        AS node_id,
    ge.target_type      AS node_type,
    ge.relationship_type,
    'outbound'::text    AS direction,
    ge.description
  FROM graph_edges ge
  WHERE ge.user_id = p_user_id AND ge.source_id = seed_node_id
  UNION ALL
  -- Inbound edges
  SELECT
    ge.source_id        AS node_id,
    ge.source_type      AS node_type,
    ge.relationship_type,
    'inbound'::text     AS direction,
    ge.description
  FROM graph_edges ge
  WHERE ge.user_id = p_user_id AND ge.target_id = seed_node_id
  LIMIT max_neighbors;
END;
$$;

CREATE OR REPLACE FUNCTION find_path_between_entities(
  p_user_id       uuid,
  source_node_id  uuid,
  target_node_id  uuid
)
RETURNS TABLE (
  hop             int,
  node_id         uuid,
  node_type       text,
  relationship_type text,
  description     text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE path_cte AS (
    SELECT
      1                     AS hop,
      ge.target_id          AS node_id,
      ge.target_type        AS node_type,
      ge.relationship_type,
      ge.description,
      ARRAY[source_node_id, ge.target_id] AS visited
    FROM graph_edges ge
    WHERE ge.user_id = p_user_id AND ge.source_id = source_node_id

    UNION ALL

    SELECT
      p.hop + 1,
      ge.target_id,
      ge.target_type,
      ge.relationship_type,
      ge.description,
      p.visited || ge.target_id
    FROM path_cte p
    JOIN graph_edges ge ON ge.source_id = p.node_id AND ge.user_id = p_user_id
    WHERE p.hop < 2
      AND NOT (ge.target_id = ANY(p.visited))
  )
  SELECT p.hop, p.node_id, p.node_type, p.relationship_type, p.description
  FROM path_cte p
  WHERE p.node_id = target_node_id
  ORDER BY p.hop
  LIMIT 10;
END;
$$;

CREATE OR REPLACE FUNCTION get_entity_timeline(
  p_user_id   uuid,
  entity_id   uuid,
  limit_rows  int  DEFAULT 20
)
RETURNS TABLE (
  edge_id           uuid,
  relationship_type text,
  direction         text,
  counterpart_id    uuid,
  counterpart_type  text,
  description       text,
  created_at        timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ge.id               AS edge_id,
    ge.relationship_type,
    CASE WHEN ge.source_id = entity_id THEN 'outbound' ELSE 'inbound' END AS direction,
    CASE WHEN ge.source_id = entity_id THEN ge.target_id ELSE ge.source_id END AS counterpart_id,
    CASE WHEN ge.source_id = entity_id THEN ge.target_type ELSE ge.source_type END AS counterpart_type,
    ge.description,
    ge.created_at
  FROM graph_edges ge
  WHERE ge.user_id = p_user_id AND (ge.source_id = entity_id OR ge.target_id = entity_id)
  ORDER BY ge.created_at DESC
  LIMIT limit_rows;
END;
$$;
