-- Supabase SQL: Run this in the Supabase SQL editor for the tasker project

-- Tasks table
create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  course          text,
  deadline        timestamptz,
  location        text,
  summary         text,
  source_email_id text unique not null,
  status          text not null default 'pending', -- 'pending' | 'completed'
  updated         boolean not null default false,
  change_note     text,
  warnings        text[] default '{}',
  category        text,
  starred         boolean not null default false,
  created_at      timestamptz not null default now()
);

-- Indexes
create index if not exists tasks_status_idx   on tasks(status);
create index if not exists tasks_deadline_idx on tasks(deadline);
create index if not exists tasks_course_idx   on tasks(course);

-- Row Level Security
alter table tasks enable row level security;

-- Anon users can read (dashboard reads without login)
create policy "anon read" on tasks
  for select using (true);

-- Only service role can insert/update/delete (n8n uses service key)
-- No additional policy needed — service_role bypasses RLS by default

-- Enable real-time replication for the tasks table
alter publication supabase_realtime add table tasks;

-- User Settings table (for dynamic categories)
create table if not exists user_settings (
  id uuid primary key default gen_random_uuid(),
  categories text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Row Level Security for user_settings
alter table user_settings enable row level security;

-- Anon users can read (dashboard needs to display the filter bubbles)
create policy "anon read settings" on user_settings
  for select using (true);

-- Enable real-time replication for user_settings (optional but good if categories update)
alter publication supabase_realtime add table user_settings;
