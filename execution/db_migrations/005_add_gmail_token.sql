-- Add a jsonb column to store the Google OAuth token permanently
alter table user_settings 
add column if not exists gmail_token jsonb;
