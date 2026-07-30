-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

create table if not exists folders (
  id          text primary key,
  device_id   text not null,
  emoji       text default '📁',
  name        text not null,
  system_prompt text default '',
  created_at  timestamptz default now()
);

create table if not exists chats (
  id           text primary key,
  device_id    text not null,
  folder_id    text references folders(id) on delete set null,
  emoji        text default '💬',
  name         text not null,
  system_prompt text default '',
  messages     jsonb default '[]'::jsonb,
  updated_at   timestamptz default now(),
  created_at   timestamptz default now()
);

-- Index for fast queries by device
create index if not exists folders_device_idx on folders(device_id);
create index if not exists chats_device_idx   on chats(device_id);
create index if not exists chats_updated_idx  on chats(updated_at desc);

-- Enable Row Level Security (open policy — no auth, anyone with anon key can read/write)
alter table folders enable row level security;
alter table chats   enable row level security;

-- Open policies (anon key access, no user auth required)
create policy "anon all on folders" on folders for all using (true) with check (true);
create policy "anon all on chats"   on chats   for all using (true) with check (true);

-- Enable realtime
alter publication supabase_realtime add table chats;
alter publication supabase_realtime add table folders;
