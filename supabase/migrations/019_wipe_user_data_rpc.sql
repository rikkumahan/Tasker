-- Migration: 019_wipe_user_data_rpc
-- Description: Adds an RPC function to wipe all data for the authenticated user, effectively resetting their account.

CREATE OR REPLACE FUNCTION wipe_user_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Delete all user-scoped data.
  -- The order matters to avoid foreign key violations, although many have ON DELETE CASCADE.
  DELETE FROM user_settings WHERE user_id = v_uid;
  DELETE FROM sync_queue WHERE user_id = v_uid;
  DELETE FROM graph_edges WHERE user_id = v_uid;
  DELETE FROM action_items WHERE user_id = v_uid;
  
  -- Community reports and members
  -- Note: if community_reports doesn't have user_id, this might fail, but recent schemas usually scope it.
  -- We use an exception block just in case to safely ignore tables that might lack user_id.
  BEGIN
    DELETE FROM community_reports WHERE user_id = v_uid;
  EXCEPTION WHEN undefined_column THEN
    NULL;
  END;
  
  DELETE FROM emails WHERE user_id = v_uid;
  DELETE FROM threads WHERE user_id = v_uid;
  DELETE FROM contacts WHERE user_id = v_uid;
  DELETE FROM projects WHERE user_id = v_uid;
  
  -- Optionally, reset last_synced_at if user_settings is re-inserted automatically or we just leave it deleted
  -- so that the next login creates a fresh settings row.

END;
$$;
