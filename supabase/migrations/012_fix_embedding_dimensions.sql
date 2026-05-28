-- ============================================================
-- Migration: 012_fix_embedding_dimensions
-- Description:
--   1. Changes all vector columns from vector(1536) to vector(384)
--      to match the actual output of gte-small (384 dims).
--      Existing data is NULLed — it was zero-padded garbage from
--      the old code and cannot be cast. Next sync regenerates correctly.
--   2. Removes the NOT NULL constraint on contacts.email so that
--      contacts resolved purely by name (no email in header) can be
--      stored without collision. SQL UNIQUE allows multiple NULLs.
--   3. Updates match_* RPC signatures to use vector(384).
-- ============================================================

-- ─────────────────────────────────────────────
-- STEP 1: Drop HNSW indexes (required before ALTER COLUMN TYPE)
-- ─────────────────────────────────────────────
DROP INDEX IF EXISTS contacts_embedding_idx;
DROP INDEX IF EXISTS emails_embedding_idx;
DROP INDEX IF EXISTS community_reports_embedding_idx;

-- ─────────────────────────────────────────────
-- STEP 2: Change vector columns to 384 dims
-- USING NULL intentionally clears existing zero-padded vectors
-- ─────────────────────────────────────────────
ALTER TABLE contacts
  ALTER COLUMN embedding TYPE vector(384) USING NULL;

ALTER TABLE emails
  ALTER COLUMN embedding TYPE vector(384) USING NULL;

ALTER TABLE community_reports
  ALTER COLUMN embedding TYPE vector(384) USING NULL;

-- ─────────────────────────────────────────────
-- STEP 3: Fix contacts.email — remove NOT NULL, keep UNIQUE
-- Allows contacts resolved purely by name (no email address found)
-- NULL is not equal to NULL in SQL, so multiple NULLs are valid under UNIQUE
-- ─────────────────────────────────────────────
ALTER TABLE contacts
  ALTER COLUMN email DROP NOT NULL;

-- ─────────────────────────────────────────────
-- STEP 4: Recreate HNSW indexes at 384 dims
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS contacts_embedding_idx
  ON contacts USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS emails_embedding_idx
  ON emails USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS community_reports_embedding_idx
  ON community_reports USING hnsw (embedding vector_cosine_ops);

-- ─────────────────────────────────────────────
-- STEP 5: Redefine match_contacts to use vector(384)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_contacts(
  query_embedding  vector(384),
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
    c.id,
    c.email,
    c.name,
    c.organization,
    c.bio_summary,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM contacts c
  WHERE c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ─────────────────────────────────────────────
-- STEP 6: Redefine match_emails to use vector(384)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_emails(
  query_embedding  vector(384),
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
    e.id,
    e.message_id,
    e.thread_id,
    e.sender_id,
    e.subject,
    e.body,
    e.snippet,
    e.received_at,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM emails e
  WHERE e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) >= match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ─────────────────────────────────────────────
-- STEP 7: Redefine match_community_reports to use vector(384)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_community_reports(
  query_embedding  vector(384),
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
    cr.id,
    cr.title,
    cr.summary,
    cr.rating,
    cr.rating_explanation,
    cr.findings,
    1 - (cr.embedding <=> query_embedding) AS similarity
  FROM community_reports cr
  WHERE cr.embedding IS NOT NULL
    AND 1 - (cr.embedding <=> query_embedding) >= match_threshold
  ORDER BY cr.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
