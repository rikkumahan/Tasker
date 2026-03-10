-- Add user_profile text column to existing user_settings table
alter table user_settings 
add column if not exists user_profile text not null default 'The user is a student seeking to organize academic and personal tasks.';
