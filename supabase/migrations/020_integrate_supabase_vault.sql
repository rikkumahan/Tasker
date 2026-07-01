-- 1. Enable Vault extension if not active
create extension if not exists supabase_vault cascade;

-- 2. Add Vault secret reference column to user_settings
alter table user_settings add column if not exists gmail_token_secret_id uuid references vault.secrets(id);

-- 3. Backfill existing plaintext tokens into Supabase Vault
do $$
declare
  r record;
  v_secret_id uuid;
begin
  -- check if column gmail_token exists before attempting to backfill
  if exists (select 1 from information_schema.columns where table_name='user_settings' and column_name='gmail_token') then
    for r in select id, user_id, gmail_token from user_settings where gmail_token is not null loop
      -- check if secret already exists
      if not exists (select 1 from user_settings where id = r.id and gmail_token_secret_id is not null) then
        v_secret_id := vault.create_secret(
          r.gmail_token::text,
          'gmail_token_' || r.user_id::text,
          'Gmail OAuth tokens for user ' || r.user_id::text
        );
        update user_settings 
        set gmail_token_secret_id = v_secret_id 
        where id = r.id;
      end if;
    end loop;
  end if;
end;
$$;

-- 4. Drop the plaintext column from user_settings if it exists
alter table user_settings drop column if exists gmail_token;

-- 5. Create helper RPC to manage writes to Vault
create or replace function public.vault_store_gmail_token(p_user_id uuid, p_token_json jsonb)
returns uuid
language plpgsql
security definer
as $$
declare
  v_secret_id uuid;
  v_existing_secret_id uuid;
begin
  -- Get existing secret ID
  select gmail_token_secret_id into v_existing_secret_id
  from public.user_settings
  where user_id = p_user_id;

  if v_existing_secret_id is not null then
    -- Update existing secret in vault
    perform vault.update_secret(v_existing_secret_id, p_token_json::text);
    v_secret_id := v_existing_secret_id;
  else
    -- Create new secret in vault
    v_secret_id := vault.create_secret(
      p_token_json::text,
      'gmail_token_' || p_user_id::text,
      'Gmail access and refresh token for user ' || p_user_id::text
    );
    -- Save secret ID to user_settings
    update public.user_settings
    set gmail_token_secret_id = v_secret_id
    where user_id = p_user_id;
  end if;

  return v_secret_id;
end;
$$;

-- 6. Create the user_settings_decrypted view
-- We use security_invoker = true to respect the RLS of public.user_settings table.
create or replace view public.user_settings_decrypted with (security_invoker = true) as
select
  us.id,
  us.user_id,
  us.gmail_email,
  -- Only decrypt and expose the token to authorized backend/postgres roles
  (select decrypted_secret::jsonb from vault.decrypted_secrets where id = us.gmail_token_secret_id) as gmail_token,
  us.last_synced_at,
  us.last_sync_triggered_at,
  us.last_sync_error,
  us.secrets,
  us.recent_actions,
  us.sync_status,
  us.sync_page_token,
  us.sync_in_progress,
  us.sync_lock_at,
  us.sync_flags,
  us.onboarding_status,
  us.onboarding_progress,
  us.created_at
from public.user_settings us;
