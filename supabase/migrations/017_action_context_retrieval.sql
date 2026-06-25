-- ============================================================
-- Migration: 017_action_context_retrieval
-- Description:
--   Adds canonical action_items storage and user-scoped retrieval
--   RPCs for action generation. Keeps threads.action_items as a
--   dashboard projection and avoids the legacy tasks table entirely.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Canonical action item store for the email intelligence system.
CREATE TABLE IF NOT EXISTS action_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id           uuid REFERENCES threads(id) ON DELETE CASCADE,
  email_id            uuid REFERENCES emails(id) ON DELETE SET NULL,
  description         text NOT NULL,
  description_key     text GENERATED ALWAYS AS (lower(btrim(description))) STORED,
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'candidate', 'done', 'duplicate', 'ignored')),
  direction           text NOT NULL DEFAULT 'inbox'
    CHECK (direction IN ('inbox', 'sent', 'unknown')),
  assigned_to         text,
  assignee_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  deadline            timestamptz,
  embedding           vector(384),
  confidence          numeric NOT NULL DEFAULT 0.75
    CHECK (confidence >= 0 AND confidence <= 1),
  evidence            jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_of        uuid REFERENCES action_items(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_items_embedding_idx
  ON action_items USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS action_items_user_status_deadline_idx
  ON action_items (user_id, status, deadline);
CREATE INDEX IF NOT EXISTS action_items_user_thread_idx
  ON action_items (user_id, thread_id);
CREATE INDEX IF NOT EXISTS action_items_user_email_idx
  ON action_items (user_id, email_id);
CREATE INDEX IF NOT EXISTS action_items_duplicate_idx
  ON action_items (duplicate_of) WHERE duplicate_of IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS action_items_user_thread_description_key
  ON action_items (user_id, thread_id, description_key);

ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own action items" ON action_items;
DROP POLICY IF EXISTS "Users can insert their own action items" ON action_items;
DROP POLICY IF EXISTS "Users can update their own action items" ON action_items;
DROP POLICY IF EXISTS "Users can delete their own action items" ON action_items;

CREATE POLICY "Users can view their own action items"
  ON action_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own action items"
  ON action_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own action items"
  ON action_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own action items"
  ON action_items FOR DELETE USING (auth.uid() = user_id);

-- Keep graph edges idempotent. Exact duplicate relationships are collapsed
-- before adding the uniqueness contract used by live graph ingestion.
WITH ranked_edges AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, source_id, target_id, source_type, target_type, relationship_type
           ORDER BY created_at DESC NULLS LAST, id DESC
         ) AS duplicate_rank
  FROM graph_edges
)
DELETE FROM graph_edges ge
USING ranked_edges re
WHERE ge.id = re.id
  AND re.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS graph_edges_user_edge_key
  ON graph_edges (user_id, source_id, target_id, source_type, target_type, relationship_type);

-- Utility guard for SECURITY DEFINER RPCs. Service-role Edge Function calls
-- have no end-user auth.uid(); client calls must match their own user id.
CREATE OR REPLACE FUNCTION assert_user_scope(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := current_setting('request.jwt.claim.role', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_uid uuid := auth.uid();
BEGIN
  IF (v_role IS NULL OR v_role = '') AND v_claims IS NOT NULL AND v_claims <> '' THEN
    BEGIN
      v_role := v_claims::jsonb->>'role';
    EXCEPTION WHEN others THEN
      v_role := NULL;
    END;
  END IF;

  IF v_role = 'service_role' THEN
    RETURN;
  END IF;

  IF v_uid IS NULL OR v_uid <> p_user_id THEN
    RAISE EXCEPTION 'p_user_id does not match authenticated user';
  END IF;
END;
$$;

-- Drop stale vector(1536) and non-user-scoped overloads, then recreate the
-- current GraphRAG vector RPCs with vector(384) and p_user_id.
DROP FUNCTION IF EXISTS match_contacts(vector(1536), float, int);
DROP FUNCTION IF EXISTS match_contacts(vector(384), float, int);
DROP FUNCTION IF EXISTS match_contacts(uuid, vector(1536), float, int);
DROP FUNCTION IF EXISTS match_emails(vector(1536), float, int);
DROP FUNCTION IF EXISTS match_emails(vector(384), float, int);
DROP FUNCTION IF EXISTS match_emails(uuid, vector(1536), float, int);
DROP FUNCTION IF EXISTS match_community_reports(vector(1536), float, int);
DROP FUNCTION IF EXISTS match_community_reports(vector(384), float, int);
DROP FUNCTION IF EXISTS match_community_reports(uuid, vector(1536), float, int);

CREATE OR REPLACE FUNCTION match_contacts(
  p_user_id        uuid,
  query_embedding  vector(384),
  match_threshold  float DEFAULT 0.85,
  match_count      int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  organization text,
  bio_summary text,
  similarity float
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_user_scope(p_user_id);
  RETURN QUERY
  SELECT c.id, c.email, c.name, c.organization, c.bio_summary,
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
  query_embedding  vector(384),
  match_threshold  float DEFAULT 0.2,
  match_count      int DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  message_id text,
  thread_id uuid,
  sender_id uuid,
  subject text,
  body text,
  snippet text,
  received_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_user_scope(p_user_id);
  RETURN QUERY
  SELECT e.id, e.message_id, e.thread_id, e.sender_id, e.subject, e.body,
         e.snippet, e.received_at,
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
  query_embedding  vector(384),
  match_threshold  float DEFAULT 0.2,
  match_count      int DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  title text,
  summary text,
  rating numeric,
  rating_explanation text,
  findings jsonb,
  similarity float
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_user_scope(p_user_id);
  RETURN QUERY
  SELECT cr.id, cr.title, cr.summary, cr.rating, cr.rating_explanation,
         cr.findings, 1 - (cr.embedding <=> query_embedding) AS similarity
  FROM community_reports cr
  WHERE cr.user_id = p_user_id
    AND cr.embedding IS NOT NULL
    AND 1 - (cr.embedding <=> query_embedding) >= match_threshold
  ORDER BY cr.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION get_thread_context(
  p_user_id uuid,
  p_thread_id uuid DEFAULT NULL,
  p_gmail_thread_id text DEFAULT NULL,
  limit_count int DEFAULT 20
)
RETURNS TABLE (
  email_id uuid,
  thread_id uuid,
  message_id text,
  sender_name text,
  sender_email text,
  subject text,
  snippet text,
  received_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_user_scope(p_user_id);
  RETURN QUERY
  SELECT e.id, e.thread_id, e.message_id, c.name, c.email, e.subject,
         e.snippet, e.received_at
  FROM emails e
  JOIN threads t ON t.id = e.thread_id AND t.user_id = p_user_id
  LEFT JOIN contacts c ON c.id = e.sender_id AND c.user_id = p_user_id
  WHERE e.user_id = p_user_id
    AND (p_thread_id IS NULL OR e.thread_id = p_thread_id)
    AND (p_gmail_thread_id IS NULL OR t.gmail_thread_id = p_gmail_thread_id)
  ORDER BY e.received_at ASC
  LIMIT limit_count;
END;
$$;

CREATE OR REPLACE FUNCTION get_sender_context(
  p_user_id uuid,
  p_sender_email text DEFAULT NULL,
  p_sender_id uuid DEFAULT NULL,
  limit_count int DEFAULT 20
)
RETURNS TABLE (
  email_id uuid,
  thread_id uuid,
  message_id text,
  subject text,
  snippet text,
  received_at timestamptz,
  direction text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_user_scope(p_user_id);
  RETURN QUERY
  SELECT e.id, e.thread_id, e.message_id, e.subject, e.snippet,
         e.received_at,
         CASE WHEN COALESCE(c.email, '') = COALESCE(p_sender_email, '') THEN 'inbox' ELSE 'unknown' END
  FROM emails e
  JOIN contacts c ON c.id = e.sender_id AND c.user_id = p_user_id
  WHERE e.user_id = p_user_id
    AND (p_sender_id IS NULL OR e.sender_id = p_sender_id)
    AND (p_sender_email IS NULL OR lower(c.email) = lower(p_sender_email))
  ORDER BY e.received_at DESC
  LIMIT limit_count;
END;
$$;

CREATE OR REPLACE FUNCTION get_related_graph_context(
  p_user_id uuid,
  p_thread_id uuid,
  max_results int DEFAULT 20
)
RETURNS TABLE (
  node_id uuid,
  node_type text,
  relationship_type text,
  direction text,
  description text,
  label text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_user_scope(p_user_id);
  RETURN QUERY
  WITH neighbors AS (
    SELECT ge.target_id AS node_id, ge.target_type AS node_type,
           ge.relationship_type, 'outbound'::text AS direction, ge.description
    FROM graph_edges ge
    WHERE ge.user_id = p_user_id AND ge.source_id = p_thread_id
    UNION ALL
    SELECT ge.source_id AS node_id, ge.source_type AS node_type,
           ge.relationship_type, 'inbound'::text AS direction, ge.description
    FROM graph_edges ge
    WHERE ge.user_id = p_user_id AND ge.target_id = p_thread_id
  )
  SELECT n.node_id, n.node_type, n.relationship_type, n.direction, n.description,
         COALESCE(c.name, p.name, t.subject, ai.description, 'Unknown') AS label
  FROM neighbors n
  LEFT JOIN contacts c ON n.node_type = 'contact' AND c.id = n.node_id AND c.user_id = p_user_id
  LEFT JOIN projects p ON n.node_type = 'project' AND p.id = n.node_id AND p.user_id = p_user_id
  LEFT JOIN threads t ON n.node_type = 'thread' AND t.id = n.node_id AND t.user_id = p_user_id
  LEFT JOIN action_items ai ON n.node_type = 'action_item' AND ai.id = n.node_id AND ai.user_id = p_user_id
  LIMIT max_results;
END;
$$;

CREATE OR REPLACE FUNCTION match_action_items(
  p_user_id uuid,
  query_embedding vector(384),
  match_threshold float DEFAULT 0.75,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  thread_id uuid,
  email_id uuid,
  description text,
  status text,
  deadline timestamptz,
  assigned_to text,
  confidence numeric,
  similarity float
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_user_scope(p_user_id);
  RETURN QUERY
  SELECT ai.id, ai.thread_id, ai.email_id, ai.description, ai.status,
         ai.deadline, ai.assigned_to, ai.confidence,
         1 - (ai.embedding <=> query_embedding) AS similarity
  FROM action_items ai
  WHERE ai.user_id = p_user_id
    AND ai.embedding IS NOT NULL
    AND 1 - (ai.embedding <=> query_embedding) >= match_threshold
  ORDER BY ai.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION check_duplicate_action_item(
  p_user_id uuid,
  task_vector vector(384),
  sim_threshold float DEFAULT 0.92
)
RETURNS TABLE (
  id uuid,
  original_action text,
  status text,
  thread_id uuid,
  similarity float
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_user_scope(p_user_id);
  RETURN QUERY
  SELECT ai.id, ai.description, ai.status, ai.thread_id,
         1 - (ai.embedding <=> task_vector) AS similarity
  FROM action_items ai
  WHERE ai.user_id = p_user_id
    AND ai.status IN ('pending', 'candidate')
    AND ai.embedding IS NOT NULL
    AND 1 - (ai.embedding <=> task_vector) >= sim_threshold
  ORDER BY ai.embedding <=> task_vector
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION get_pending_deadlines(p_user_id uuid)
RETURNS TABLE (
  action_id uuid,
  description text,
  deadline timestamptz,
  days_remaining int,
  assigned_to text,
  direction text,
  thread_subject text,
  gmail_thread_id text,
  is_overdue boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_user_scope(p_user_id);
  RETURN QUERY
  SELECT ai.id, ai.description, ai.deadline,
         (ai.deadline::date - current_date)::int,
         ai.assigned_to, ai.direction, t.subject, t.gmail_thread_id,
         ai.deadline::date < current_date
  FROM action_items ai
  LEFT JOIN threads t ON t.id = ai.thread_id AND t.user_id = p_user_id
  WHERE ai.user_id = p_user_id
    AND ai.status = 'pending'
    AND ai.deadline IS NOT NULL
  ORDER BY ai.deadline ASC;
END;
$$;

CREATE OR REPLACE FUNCTION get_action_insights(p_user_id uuid)
RETURNS TABLE (
  entity_name text,
  entity_type text,
  action_count bigint,
  actions jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_user_scope(p_user_id);
  RETURN QUERY
  SELECT COALESCE(p.name, c.name, t.subject, 'Unlinked') AS entity_name,
         COALESCE(ge.target_type, 'thread') AS entity_type,
         count(ai.id) AS action_count,
         jsonb_agg(jsonb_build_object(
           'id', ai.id,
           'description', ai.description,
           'deadline', ai.deadline,
           'assigned_to', ai.assigned_to,
           'direction', ai.direction,
           'status', ai.status,
           'thread_id', ai.thread_id
         ) ORDER BY ai.deadline ASC NULLS LAST) AS actions
  FROM action_items ai
  LEFT JOIN graph_edges ge
    ON ge.user_id = p_user_id
   AND ge.source_id = ai.thread_id
   AND ge.target_type IN ('project', 'contact')
  LEFT JOIN projects p ON ge.target_type = 'project' AND p.id = ge.target_id AND p.user_id = p_user_id
  LEFT JOIN contacts c ON ge.target_type = 'contact' AND c.id = ge.target_id AND c.user_id = p_user_id
  LEFT JOIN threads t ON t.id = ai.thread_id AND t.user_id = p_user_id
  WHERE ai.user_id = p_user_id
    AND ai.status = 'pending'
  GROUP BY COALESCE(p.name, c.name, t.subject, 'Unlinked'), COALESCE(ge.target_type, 'thread')
  ORDER BY count(ai.id) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_thread_action_projection(
  p_user_id uuid,
  p_thread_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_projection jsonb;
  v_urgency text;
  v_action_type text;
BEGIN
  PERFORM assert_user_scope(p_user_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ai.id,
    'task', ai.description,
    'assignee', ai.assigned_to,
    'deadline', ai.deadline,
    'status', ai.status,
    'confidence', ai.confidence
  ) ORDER BY ai.deadline ASC NULLS LAST, ai.created_at DESC), '[]'::jsonb)
  INTO v_projection
  FROM action_items ai
  WHERE ai.user_id = p_user_id
    AND ai.thread_id = p_thread_id
    AND ai.status IN ('pending', 'candidate');

  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM action_items ai
      WHERE ai.user_id = p_user_id AND ai.thread_id = p_thread_id
        AND ai.status = 'pending' AND ai.deadline::date < current_date
    ) THEN 'URGENT'
    WHEN EXISTS (
      SELECT 1 FROM action_items ai
      WHERE ai.user_id = p_user_id AND ai.thread_id = p_thread_id
        AND ai.status = 'pending' AND ai.deadline::date <= current_date + 2
    ) THEN 'HIGH'
    WHEN jsonb_array_length(v_projection) > 0 THEN 'MEDIUM'
    ELSE 'LOW'
  END INTO v_urgency;

  v_action_type := CASE WHEN jsonb_array_length(v_projection) > 0 THEN 'review' ELSE 'view' END;

  UPDATE threads
  SET action_items = v_projection,
      urgency = v_urgency,
      action_type = v_action_type
  WHERE id = p_thread_id AND user_id = p_user_id;

  RETURN v_projection;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_thread_action_projection_from_action_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_thread_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
    v_thread_id := OLD.thread_id;
  ELSE
    v_user_id := NEW.user_id;
    v_thread_id := NEW.thread_id;
  END IF;

  IF v_user_id IS NOT NULL AND v_thread_id IS NOT NULL THEN
    PERFORM refresh_thread_action_projection(v_user_id, v_thread_id);
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.thread_id IS DISTINCT FROM NEW.thread_id
     AND OLD.user_id IS NOT NULL
     AND OLD.thread_id IS NOT NULL THEN
    PERFORM refresh_thread_action_projection(OLD.user_id, OLD.thread_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill old dashboard JSON as non-active candidates. These rows are useful
-- as retrieval/reconciliation memory but will not create active pending work.
INSERT INTO action_items (
  user_id, thread_id, description, status, direction, assigned_to,
  confidence, evidence, created_at, updated_at
)
SELECT
  t.user_id,
  t.id,
  COALESCE(item.value->>'task', item.value->>'text', trim(both '"' from item.value::text)),
  'candidate',
  'unknown',
  item.value->>'assignee',
  0.35,
  jsonb_build_object(
    'source', 'threads.action_items_backfill',
    'thread_id', t.id,
    'gmail_thread_id', t.gmail_thread_id,
    'original', item.value
  ),
  now(),
  now()
FROM threads t
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.action_items, '[]'::jsonb)) AS item(value)
WHERE jsonb_typeof(COALESCE(t.action_items, '[]'::jsonb)) = 'array'
  AND COALESCE(item.value->>'task', item.value->>'text', trim(both '"' from item.value::text), '') <> ''
ON CONFLICT (user_id, thread_id, description_key) DO NOTHING;

DROP TRIGGER IF EXISTS action_items_refresh_thread_projection ON action_items;
CREATE TRIGGER action_items_refresh_thread_projection
AFTER INSERT OR UPDATE OR DELETE ON action_items
FOR EACH ROW
EXECUTE FUNCTION refresh_thread_action_projection_from_action_item();

-- Redefine graph ingestion so extracted TASK entities become action_items,
-- not legacy tasks rows.
CREATE OR REPLACE FUNCTION ingest_graphrag_payload(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread_id uuid;
  v_sender_id uuid;
  v_sender_email text;
  v_sender_name text;
  v_sender_emb vector(384);
  v_email_emb vector(384);
  v_email_id uuid;
  v_message_id text;
  v_entity jsonb;
  v_entity_id uuid;
  v_entity_name text;
  v_entity_type text;
  v_entity_email text;
  v_entity_emb vector(384);
  v_entity_desc text;
  v_rel jsonb;
  v_src_id uuid;
  v_tgt_id uuid;
  v_src_type text;
  v_tgt_type text;
  v_resolved jsonb := '{}'::jsonb;
  v_user_id uuid;
BEGIN
  v_user_id := (payload->>'user_id')::uuid;
  PERFORM assert_user_scope(v_user_id);
  v_message_id := payload->'email'->>'message_id';

  INSERT INTO threads (user_id, gmail_thread_id, subject, semantic_summary)
  VALUES (
    v_user_id,
    payload->'thread'->>'gmail_thread_id',
    payload->'thread'->>'subject',
    payload->'thread'->>'semantic_summary'
  )
  ON CONFLICT (user_id, gmail_thread_id) DO UPDATE
    SET subject = EXCLUDED.subject,
        semantic_summary = COALESCE(EXCLUDED.semantic_summary, threads.semantic_summary)
  RETURNING id INTO v_thread_id;

  v_sender_email := lower(trim(payload->'email'->>'sender_email'));
  v_sender_name := trim(payload->'email'->>'sender_name');
  v_sender_emb := (
    SELECT array_agg(val::float)::vector(384)
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(COALESCE(payload->'sender'->'embedding', payload->'email'->'embedding')) = 'array'
        THEN COALESCE(payload->'sender'->'embedding', payload->'email'->'embedding')
        ELSE '[]'::jsonb
      END
    ) AS val
  );
  v_email_emb := (
    SELECT array_agg(val::float)::vector(384)
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(payload->'email'->'embedding') = 'array'
        THEN payload->'email'->'embedding'
        ELSE '[]'::jsonb
      END
    ) AS val
  );

  IF v_sender_email IS NOT NULL AND v_sender_email <> '' THEN
    SELECT id INTO v_sender_id FROM contacts WHERE user_id = v_user_id AND email = v_sender_email LIMIT 1;
  END IF;
  IF v_sender_id IS NULL AND v_sender_name IS NOT NULL AND v_sender_name <> '' THEN
    SELECT id INTO v_sender_id FROM contacts WHERE user_id = v_user_id AND upper(name) = upper(v_sender_name) LIMIT 1;
  END IF;
  IF v_sender_id IS NULL AND v_sender_emb IS NOT NULL THEN
    SELECT id INTO v_sender_id
    FROM contacts
    WHERE user_id = v_user_id
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> v_sender_emb) >= 0.85
    ORDER BY embedding <=> v_sender_emb
    LIMIT 1;
  END IF;
  IF v_sender_id IS NULL THEN
    INSERT INTO contacts (user_id, email, name, bio_summary, embedding)
    VALUES (
      v_user_id,
      NULLIF(v_sender_email, ''),
      NULLIF(v_sender_name, ''),
      'Contact resolved from email communications. Name: ' || COALESCE(NULLIF(v_sender_name, ''), 'Unknown') || '.',
      v_sender_emb
    )
    ON CONFLICT (user_id, email) DO UPDATE SET name = COALESCE(EXCLUDED.name, contacts.name)
    RETURNING id INTO v_sender_id;
  END IF;

  IF v_sender_id IS NOT NULL AND v_sender_name IS NOT NULL AND v_sender_name <> '' THEN
    v_resolved := jsonb_set(v_resolved, ARRAY[upper(v_sender_name)],
      jsonb_build_object('id', v_sender_id, 'type', 'contact'));
  END IF;

  INSERT INTO emails (user_id, message_id, thread_id, sender_id, subject, body, snippet, received_at, embedding)
  VALUES (
    v_user_id,
    v_message_id,
    v_thread_id,
    v_sender_id,
    payload->'email'->>'subject',
    payload->'email'->>'body',
    payload->'email'->>'snippet',
    (payload->'email'->>'received_at')::timestamptz,
    v_email_emb
  )
  ON CONFLICT (user_id, message_id) DO UPDATE
    SET thread_id = EXCLUDED.thread_id,
        sender_id = EXCLUDED.sender_id,
        subject = EXCLUDED.subject,
        snippet = EXCLUDED.snippet,
        received_at = EXCLUDED.received_at,
        embedding = COALESCE(EXCLUDED.embedding, emails.embedding)
  RETURNING id INTO v_email_id;

  v_resolved := jsonb_set(v_resolved, ARRAY[upper(payload->'thread'->>'subject')],
    jsonb_build_object('id', v_thread_id, 'type', 'thread'));

  FOR v_entity IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'entities', '[]'::jsonb))
  LOOP
    v_entity_id := NULL;
    v_entity_name := trim(v_entity->>'name');
    v_entity_type := v_entity->>'type';
    v_entity_email := lower(trim(v_entity->>'email'));
    v_entity_desc := v_entity->>'description';
    v_entity_emb := (
      SELECT array_agg(val::float)::vector(384)
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(v_entity->'embedding') = 'array'
          THEN v_entity->'embedding'
          ELSE '[]'::jsonb
        END
      ) AS val
    );

    IF v_entity_name IS NULL OR v_entity_name = '' THEN
      CONTINUE;
    END IF;

    IF v_entity_type IN ('person', 'contact', 'organization') THEN
      IF v_entity_email IS NOT NULL AND v_entity_email <> '' THEN
        SELECT id INTO v_entity_id FROM contacts WHERE user_id = v_user_id AND email = v_entity_email LIMIT 1;
      END IF;
      IF v_entity_id IS NULL THEN
        SELECT id INTO v_entity_id FROM contacts WHERE user_id = v_user_id AND upper(name) = upper(v_entity_name) LIMIT 1;
      END IF;
      IF v_entity_id IS NULL AND v_entity_emb IS NOT NULL THEN
        SELECT id INTO v_entity_id FROM contacts
        WHERE user_id = v_user_id
          AND embedding IS NOT NULL
          AND 1 - (embedding <=> v_entity_emb) >= 0.85
        ORDER BY embedding <=> v_entity_emb
        LIMIT 1;
      END IF;
      IF v_entity_id IS NULL THEN
        INSERT INTO contacts (user_id, email, name, bio_summary, embedding)
        VALUES (v_user_id, NULLIF(v_entity_email, ''), v_entity_name, v_entity_desc, v_entity_emb)
        ON CONFLICT (user_id, email) DO UPDATE SET name = COALESCE(EXCLUDED.name, contacts.name)
        RETURNING id INTO v_entity_id;
      END IF;
      v_resolved := jsonb_set(v_resolved, ARRAY[upper(v_entity_name)],
        jsonb_build_object('id', v_entity_id, 'type', 'contact'));

    ELSIF v_entity_type IN ('project', 'topic', 'event', 'document', 'commitment') THEN
      SELECT id INTO v_entity_id FROM projects WHERE user_id = v_user_id AND upper(name) = upper(v_entity_name) LIMIT 1;
      IF v_entity_id IS NULL THEN
        INSERT INTO projects (user_id, name, description)
        VALUES (v_user_id, v_entity_name, v_entity_desc)
        ON CONFLICT (user_id, name) DO NOTHING
        RETURNING id INTO v_entity_id;
      END IF;
      IF v_entity_id IS NULL THEN
        SELECT id INTO v_entity_id FROM projects WHERE user_id = v_user_id AND upper(name) = upper(v_entity_name) LIMIT 1;
      END IF;
      v_resolved := jsonb_set(v_resolved, ARRAY[upper(v_entity_name)],
        jsonb_build_object('id', v_entity_id, 'type', 'project'));

    ELSIF v_entity_type = 'task' THEN
      INSERT INTO action_items (
        user_id, thread_id, email_id, description, status, direction,
        embedding, confidence, evidence
      )
      VALUES (
        v_user_id, v_thread_id, v_email_id, v_entity_name, 'candidate',
        COALESCE(payload->'email'->>'direction', 'unknown'),
        v_entity_emb, 0.45,
        jsonb_build_object(
          'source', 'graph_task_entity',
          'description', v_entity_desc,
          'message_id', v_message_id
        )
      )
      ON CONFLICT (user_id, thread_id, description_key) DO UPDATE
        SET evidence = action_items.evidence || EXCLUDED.evidence,
            updated_at = now()
      RETURNING id INTO v_entity_id;

      v_resolved := jsonb_set(v_resolved, ARRAY[upper(v_entity_name)],
        jsonb_build_object('id', v_entity_id, 'type', 'action_item'));
    END IF;
  END LOOP;

  IF v_sender_id IS NOT NULL AND v_thread_id IS NOT NULL THEN
    INSERT INTO graph_edges (user_id, source_id, target_id, source_type, target_type, relationship_type, description)
    VALUES (v_user_id, v_thread_id, v_sender_id, 'thread', 'contact', 'SENT_BY', 'Email thread sent by this contact')
    ON CONFLICT (user_id, source_id, target_id, source_type, target_type, relationship_type) DO UPDATE
      SET description = EXCLUDED.description;
  END IF;

  FOR v_rel IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'relationships', '[]'::jsonb))
  LOOP
    v_src_id := (v_resolved->upper(trim(v_rel->>'source_name'))->>'id')::uuid;
    v_tgt_id := (v_resolved->upper(trim(v_rel->>'target_name'))->>'id')::uuid;
    v_src_type := v_resolved->upper(trim(v_rel->>'source_name'))->>'type';
    v_tgt_type := v_resolved->upper(trim(v_rel->>'target_name'))->>'type';

    IF v_src_id IS NOT NULL AND v_tgt_id IS NOT NULL THEN
      INSERT INTO graph_edges (user_id, source_id, target_id, source_type, target_type, relationship_type, description)
      VALUES (v_user_id, v_src_id, v_tgt_id, v_src_type, v_tgt_type, v_rel->>'relation_type', v_rel->>'description')
      ON CONFLICT (user_id, source_id, target_id, source_type, target_type, relationship_type) DO UPDATE
        SET description = EXCLUDED.description;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'thread_id', v_thread_id,
    'email_id', v_email_id,
    'sender_id', v_sender_id,
    'entities_resolved', (SELECT jsonb_agg(key) FROM jsonb_object_keys(v_resolved) AS key)
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[ingest_graphrag_payload] Failed for message_id=%: %', v_message_id, SQLERRM;
  RETURN jsonb_build_object('error', SQLERRM, 'message_id', v_message_id);
END;
$$;
