-- ============================================================
-- Migration: 013_ingest_graphrag_rpc
-- Description: Adds a single bulk ingestion RPC function
--              `ingest_graphrag_payload` that replaces the N+1
--              database query pattern in GraphRAGStore.ingestEmailToGraph.
--
-- Before: ~10-15 separate DB round trips per email (from Edge Function)
-- After:  1 single DB call per email. All resolution runs in Postgres.
-- ============================================================

CREATE OR REPLACE FUNCTION ingest_graphrag_payload(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- Thread
  v_thread_id       uuid;

  -- Sender (contact)
  v_sender_id       uuid;
  v_sender_email    text;
  v_sender_name     text;
  v_sender_emb      vector(1536);

  -- Email
  v_email_id        uuid;
  v_message_id      text;

  -- Entity loop vars
  v_entity          jsonb;
  v_entity_id       uuid;
  v_entity_name     text;
  v_entity_type     text;
  v_entity_email    text;
  v_entity_emb      vector(1536);
  v_entity_desc     text;

  -- Relationship loop vars
  v_rel             jsonb;
  v_src_id          uuid;
  v_tgt_id          uuid;
  v_src_type        text;
  v_tgt_type        text;

  -- In-memory name → {id, type} map stored as jsonb
  v_resolved        jsonb := '{}'::jsonb;
  v_user_id         uuid;

BEGIN
  v_user_id    := (payload->>'user_id')::uuid;
  v_message_id := payload->'email'->>'message_id';

  -- ─────────────────────────────────────────────
  -- STEP 1: Resolve Thread
  -- ─────────────────────────────────────────────
  INSERT INTO threads (user_id, gmail_thread_id, subject, semantic_summary)
  VALUES (
    v_user_id,
    payload->'thread'->>'gmail_thread_id',
    payload->'thread'->>'subject',
    payload->'thread'->>'semantic_summary'
  )
  ON CONFLICT (user_id, gmail_thread_id) DO UPDATE
    SET subject = EXCLUDED.subject  -- no-op update to satisfy RETURNING
  RETURNING id INTO v_thread_id;

  -- ─────────────────────────────────────────────
  -- STEP 2: Resolve Sender Contact
  -- Resolution order: exact email → exact name → vector similarity → insert
  -- ─────────────────────────────────────────────
  v_sender_email := lower(trim(payload->'email'->>'sender_email'));
  v_sender_name  := trim(payload->'email'->>'sender_name');
  v_sender_emb   := (
    SELECT array_agg(val::float)::vector(1536)
    FROM jsonb_array_elements_text(payload->'email'->'embedding') AS val
  );

  -- 2a. Exact email match
  IF v_sender_email IS NOT NULL AND v_sender_email != '' THEN
    SELECT id INTO v_sender_id FROM contacts WHERE user_id = v_user_id AND email = v_sender_email LIMIT 1;
  END IF;

  -- 2b. Exact name match
  IF v_sender_id IS NULL AND v_sender_name IS NOT NULL AND v_sender_name != '' THEN
    SELECT id INTO v_sender_id FROM contacts WHERE user_id = v_user_id AND upper(name) = upper(v_sender_name) LIMIT 1;
  END IF;

  -- 2c. Vector similarity (only if embedding is non-zero)
  IF v_sender_id IS NULL AND v_sender_emb IS NOT NULL THEN
    SELECT id INTO v_sender_id
    FROM contacts
    WHERE user_id = v_user_id
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> v_sender_emb) >= 0.85
    ORDER BY embedding <=> v_sender_emb
    LIMIT 1;
  END IF;

  -- 2d. Insert new contact
  IF v_sender_id IS NULL THEN
    INSERT INTO contacts (user_id, email, name, bio_summary, embedding)
    VALUES (
      v_user_id,
      NULLIF(v_sender_email, ''),
      v_sender_name,
      'Contact resolved from email communications. Name: ' || v_sender_name || '.',
      v_sender_emb
    )
    ON CONFLICT (user_id, email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_sender_id;

    -- Race-condition fallback: another concurrent insert may have won
    IF v_sender_id IS NULL THEN
      SELECT id INTO v_sender_id FROM contacts WHERE user_id = v_user_id AND email = v_sender_email LIMIT 1;
    END IF;
  END IF;

  -- Register sender in resolved map
  v_resolved := jsonb_set(v_resolved, ARRAY[upper(v_sender_name)],
    jsonb_build_object('id', v_sender_id, 'type', 'contact'));

  -- ─────────────────────────────────────────────
  -- STEP 3: Insert Email (idempotent)
  -- ─────────────────────────────────────────────
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
    v_sender_emb  -- reuse sender embedding as a cost-saving measure; TS can pass a separate email embedding
  )
  ON CONFLICT (user_id, message_id) DO NOTHING
  RETURNING id INTO v_email_id;

  -- If email already existed, fetch its ID
  IF v_email_id IS NULL THEN
    SELECT id INTO v_email_id FROM emails WHERE user_id = v_user_id AND message_id = v_message_id;
  END IF;

  -- Register thread subject in resolved map
  v_resolved := jsonb_set(v_resolved, ARRAY[upper(payload->'thread'->>'subject')],
    jsonb_build_object('id', v_thread_id, 'type', 'thread'));

  -- ─────────────────────────────────────────────
  -- STEP 4: Resolve Entities
  -- Loop through entities JSON array, find or insert each one
  -- ─────────────────────────────────────────────
  FOR v_entity IN SELECT * FROM jsonb_array_elements(payload->'entities')
  LOOP
    v_entity_id    := NULL;
    v_entity_name  := trim(v_entity->>'name');
    v_entity_type  := v_entity->>'type';
    v_entity_email := lower(trim(v_entity->>'email'));
    v_entity_desc  := v_entity->>'description';
    v_entity_emb   := (
      SELECT array_agg(val::float)::vector(1536)
      FROM jsonb_array_elements_text(v_entity->'embedding') AS val
    );

    IF v_entity_name IS NULL OR v_entity_name = '' THEN
      CONTINUE;
    END IF;

    IF v_entity_type IN ('contact', 'organization') THEN
      -- Exact email
      IF v_entity_email IS NOT NULL AND v_entity_email != '' THEN
        SELECT id INTO v_entity_id FROM contacts WHERE user_id = v_user_id AND email = v_entity_email LIMIT 1;
      END IF;
      -- Exact name
      IF v_entity_id IS NULL THEN
        SELECT id INTO v_entity_id FROM contacts WHERE user_id = v_user_id AND upper(name) = upper(v_entity_name) LIMIT 1;
      END IF;
      -- Vector similarity
      IF v_entity_id IS NULL AND v_entity_emb IS NOT NULL THEN
        SELECT id INTO v_entity_id FROM contacts
        WHERE user_id = v_user_id AND embedding IS NOT NULL AND 1 - (embedding <=> v_entity_emb) >= 0.85
        ORDER BY embedding <=> v_entity_emb LIMIT 1;
      END IF;
      -- Insert new
      IF v_entity_id IS NULL THEN
        INSERT INTO contacts (user_id, email, name, bio_summary, embedding)
        VALUES (v_user_id, NULLIF(v_entity_email, ''), v_entity_name, v_entity_desc, v_entity_emb)
        ON CONFLICT (user_id, email) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_entity_id;

        IF v_entity_id IS NULL THEN
          SELECT id INTO v_entity_id FROM contacts WHERE user_id = v_user_id AND email = v_entity_email LIMIT 1;
        END IF;
      END IF;

      v_resolved := jsonb_set(v_resolved, ARRAY[upper(v_entity_name)],
        jsonb_build_object('id', v_entity_id, 'type', 'contact'));

    ELSIF v_entity_type IN ('project', 'topic') THEN
      SELECT id INTO v_entity_id FROM projects WHERE user_id = v_user_id AND upper(name) = upper(v_entity_name) LIMIT 1;
      IF v_entity_id IS NULL THEN
        INSERT INTO projects (user_id, name, description)
        VALUES (v_user_id, v_entity_name, v_entity_desc)
        ON CONFLICT (user_id, name) DO NOTHING
        RETURNING id INTO v_entity_id;

        IF v_entity_id IS NULL THEN
          SELECT id INTO v_entity_id FROM projects WHERE user_id = v_user_id AND upper(name) = upper(v_entity_name) LIMIT 1;
        END IF;
      END IF;

      v_resolved := jsonb_set(v_resolved, ARRAY[upper(v_entity_name)],
        jsonb_build_object('id', v_entity_id, 'type', 'project'));

    ELSIF v_entity_type = 'task' THEN
      SELECT id INTO v_entity_id FROM tasks
      WHERE user_id = v_user_id AND upper(title) = upper(v_entity_name) LIMIT 1;

      IF v_entity_id IS NULL THEN
        INSERT INTO tasks (title, summary, source_email_id, status, user_id)
        VALUES (v_entity_name, v_entity_desc, 'graph_extracted_' || gen_random_uuid()::text, 'pending', v_user_id)
        RETURNING id INTO v_entity_id;
      END IF;

      v_resolved := jsonb_set(v_resolved, ARRAY[upper(v_entity_name)],
        jsonb_build_object('id', v_entity_id, 'type', 'task'));
    END IF;
  END LOOP;

  -- ─────────────────────────────────────────────
  -- STEP 5: Insert Graph Edges
  -- ─────────────────────────────────────────────

  -- Implicit edge: sender SENT_BY → thread
  IF v_sender_id IS NOT NULL AND v_thread_id IS NOT NULL THEN
    INSERT INTO graph_edges (user_id, source_id, target_id, source_type, target_type, relationship_type, description)
    VALUES (v_user_id, v_thread_id, v_sender_id, 'thread', 'contact', 'SENT_BY', 'Email thread sent by this contact')
    ON CONFLICT DO NOTHING;
  END IF;

  -- LLM-extracted relationships
  FOR v_rel IN SELECT * FROM jsonb_array_elements(payload->'relationships')
  LOOP
    v_src_id   := (v_resolved->upper(trim(v_rel->>'source_name'))->>'id')::uuid;
    v_tgt_id   := (v_resolved->upper(trim(v_rel->>'target_name'))->>'id')::uuid;
    v_src_type := v_resolved->upper(trim(v_rel->>'source_name'))->>'type';
    v_tgt_type := v_resolved->upper(trim(v_rel->>'target_name'))->>'type';

    IF v_src_id IS NOT NULL AND v_tgt_id IS NOT NULL THEN
      INSERT INTO graph_edges (user_id, source_id, target_id, source_type, target_type, relationship_type, description)
      VALUES (v_user_id, v_src_id, v_tgt_id, v_src_type, v_tgt_type, v_rel->>'relation_type', v_rel->>'description')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- ─────────────────────────────────────────────
  -- RETURN resolved IDs for logging/debugging
  -- ─────────────────────────────────────────────
  RETURN jsonb_build_object(
    'thread_id', v_thread_id,
    'email_id',  v_email_id,
    'sender_id', v_sender_id,
    'entities_resolved', jsonb_object_keys(v_resolved)
  );

EXCEPTION WHEN OTHERS THEN
  -- Non-fatal: log error context and return failure indicator
  RAISE WARNING '[ingest_graphrag_payload] Failed for message_id=%: %', v_message_id, SQLERRM;
  RETURN jsonb_build_object('error', SQLERRM, 'message_id', v_message_id);
END;
$$;
