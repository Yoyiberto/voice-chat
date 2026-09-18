-- Supabase schema for magic-link authentication and user-owned data.
-- Run this in the Supabase SQL Editor. The user_id columns are nullable on
-- purpose so this migration keeps existing device_id rows intact.

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  username   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The regular index supports lookup while the partial unique index below
-- keeps explicitly chosen usernames unique and permits an initial NULL value.
create index if not exists profiles_username_idx
  on public.profiles (lower(username));
create index if not exists profiles_user_id_idx
  on public.profiles (user_id);
create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username)) where username is not null;

create table if not exists public.folders (
  id            text primary key,
  device_id     text not null,
  user_id       uuid references auth.users(id) on delete cascade,
  emoji         text default '📁',
  name          text not null,
  system_prompt text default '',
  created_at    timestamptz default now()
);

create table if not exists public.chats (
  id            text primary key,
  device_id     text not null,
  user_id       uuid references auth.users(id) on delete cascade,
  folder_id     text references public.folders(id) on delete set null,
  emoji         text default '💬',
  name          text not null,
  system_prompt text default '',
  messages      jsonb default '[]'::jsonb,
  updated_at    timestamptz default now(),
  created_at    timestamptz default now()
);

-- Migration path for databases created by the previous device-only schema.
-- ADD COLUMN IF NOT EXISTS leaves every existing device_id and row untouched.
alter table public.folders
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.chats
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- New authenticated inserts get their owner from the JWT. Existing rows keep
-- a NULL owner until an explicit, trusted data migration assigns one.
alter table public.folders alter column user_id set default auth.uid();
alter table public.chats alter column user_id set default auth.uid();

create index if not exists folders_device_idx on public.folders(device_id);
create index if not exists folders_user_id_idx on public.folders(user_id);
create index if not exists chats_device_idx on public.chats(device_id);
create index if not exists chats_user_id_idx on public.chats(user_id);
create index if not exists chats_updated_idx on public.chats(updated_at desc);
create index if not exists chats_user_folder_idx on public.chats(user_id, folder_id);

-- A profile is created automatically when a magic-link user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, username)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'username'), '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Also create profiles for users that existed before this schema was applied.
insert into public.profiles (user_id, username)
select id, nullif(trim(raw_user_meta_data ->> 'username'), '')
from auth.users
on conflict (user_id) do nothing;

alter table public.profiles enable row level security;
alter table public.folders enable row level security;
alter table public.chats enable row level security;

-- Remove the previous device-only policies. In particular, do not leave an
-- old USING (true) policy in place alongside the owner policies below.
drop policy if exists "anon all on folders" on public.folders;
drop policy if exists "anon all on chats" on public.chats;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = user_id);
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profiles_delete_own" on public.profiles
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "folders_select_own" on public.folders;
drop policy if exists "folders_insert_own" on public.folders;
drop policy if exists "folders_update_own" on public.folders;
drop policy if exists "folders_delete_own" on public.folders;
create policy "folders_select_own" on public.folders
  for select to authenticated using (auth.uid() = user_id);
create policy "folders_insert_own" on public.folders
  for insert to authenticated with check (auth.uid() = user_id);
create policy "folders_update_own" on public.folders
  for update to authenticated
  using (auth.uid() = user_id or user_id is null)
  with check (auth.uid() = user_id);
create policy "folders_delete_own" on public.folders
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "chats_select_own" on public.chats;
drop policy if exists "chats_insert_own" on public.chats;
drop policy if exists "chats_update_own" on public.chats;
drop policy if exists "chats_delete_own" on public.chats;
create policy "chats_select_own" on public.chats
  for select to authenticated using (auth.uid() = user_id);
create policy "chats_insert_own" on public.chats
  for insert to authenticated with check (auth.uid() = user_id);
create policy "chats_update_own" on public.chats
  for update to authenticated
  using (auth.uid() = user_id or user_id is null)
  with check (auth.uid() = user_id);
create policy "chats_delete_own" on public.chats
  for delete to authenticated using (auth.uid() = user_id);

-- Optional simple mode for this small personal app. This is not real
-- authentication: the shared device_id acts as a username and is client-held.
drop policy if exists "simple anon folders" on public.folders;
drop policy if exists "simple anon chats" on public.chats;
create policy "simple anon folders" on public.folders
  for all to anon using (true) with check (true);
create policy "simple anon chats" on public.chats
  for all to anon using (true) with check (true);

-- Enable realtime without failing if this migration is run more than once.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication p
       join pg_publication_rel pr on pr.prpubid = p.oid
       where p.pubname = 'supabase_realtime'
         and pr.prrelid = 'public.chats'::regclass
     ) then
    alter publication supabase_realtime add table public.chats;
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication p
       join pg_publication_rel pr on pr.prpubid = p.oid
       where p.pubname = 'supabase_realtime'
         and pr.prrelid = 'public.folders'::regclass
     ) then
    alter publication supabase_realtime add table public.folders;
  end if;
end;
$$;
