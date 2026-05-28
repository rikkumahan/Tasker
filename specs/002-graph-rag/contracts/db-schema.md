# DB Contract: Database DDL Schemas

This document contains the core SQL DDL commands applied in migration `011_add_graphrag_tables.sql` to initialize the database contract.

## DDL Schema Definitions

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text,
  organization text,
  bio_summary text,
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);

-- 2. Projects
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- 3. Threads
CREATE TABLE IF NOT EXISTS threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_thread_id text UNIQUE NOT NULL,
  subject text,
  semantic_summary text,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- 4. Emails
CREATE TABLE IF NOT EXISTS emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text UNIQUE NOT NULL,
  thread_id uuid REFERENCES threads(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES contacts(id) ON DELETE RESTRICT,
  subject text,
  body text,
  snippet text,
  received_at timestamptz NOT NULL,
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);

-- 5. Community Reports
CREATE TABLE IF NOT EXISTS community_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  summary text NOT NULL,
  rating numeric NOT NULL,
  rating_explanation text NOT NULL,
  findings jsonb NOT NULL,
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);

-- 6. Community Members
CREATE TABLE IF NOT EXISTS community_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid REFERENCES community_reports(id) ON DELETE CASCADE,
  node_id uuid NOT NULL,
  node_type text NOT NULL
);

-- 7. Graph Edges
CREATE TABLE IF NOT EXISTS graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  target_id uuid NOT NULL,
  source_type text NOT NULL,
  target_type text NOT NULL,
  relationship_type text NOT NULL,
  description text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Modify existing tasks table with foreign keys
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES contacts(id) ON DELETE SET NULL;

-- Indexing for semantic search
CREATE INDEX IF NOT EXISTS contacts_embedding_idx ON contacts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS emails_embedding_idx ON emails USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS community_reports_embedding_idx ON community_reports USING hnsw (embedding vector_cosine_ops);
```
