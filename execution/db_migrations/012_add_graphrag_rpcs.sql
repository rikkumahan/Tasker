-- Match contacts by vector similarity
CREATE OR REPLACE FUNCTION match_contacts(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (id uuid, email text, name text, organization text, bio_summary text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, email, name, organization, bio_summary,
         1 - (embedding <=> query_embedding) AS similarity
  FROM contacts
  WHERE 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Match emails by vector similarity
CREATE OR REPLACE FUNCTION match_emails(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (id uuid, message_id text, thread_id uuid, sender_id uuid,
               subject text, body text, snippet text, received_at timestamptz, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, message_id, thread_id, sender_id, subject, body, snippet, received_at,
         1 - (embedding <=> query_embedding) AS similarity
  FROM emails
  WHERE 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Match community reports by vector similarity
CREATE OR REPLACE FUNCTION match_community_reports(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (id uuid, title text, summary text, rating numeric,
               rating_explanation text, findings jsonb, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, title, summary, rating, rating_explanation, findings,
         1 - (embedding <=> query_embedding) AS similarity
  FROM community_reports
  WHERE 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Performance indexes for 2-hop graph traversal
CREATE INDEX IF NOT EXISTS graph_edges_source_idx ON graph_edges(source_id);
CREATE INDEX IF NOT EXISTS graph_edges_target_idx ON graph_edges(target_id);
