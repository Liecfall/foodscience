-- FoodLab Supabase schema v1
-- Run in Supabase SQL Editor only after reviewing this file.
create extension if not exists pgcrypto;

create table if not exists public.diary_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, entry_id)
);

create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  favorite_key text not null,
  source text not null check (source = 'catalog'),
  catalog_product_id text not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, favorite_key)
);

create table if not exists public.user_notes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  goal numeric check (goal is null or (goal > 0 and goal <= 100000)),
  updated_at timestamptz not null default now()
);

create index if not exists diary_entries_user_updated_idx
  on public.diary_entries (user_id, updated_at desc);
create index if not exists favorites_user_updated_idx
  on public.favorites (user_id, updated_at desc);

alter table public.diary_entries enable row level security;
alter table public.favorites enable row level security;
alter table public.user_notes enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "diary_select_own" on public.diary_entries;
create policy "diary_select_own" on public.diary_entries
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "diary_insert_own" on public.diary_entries;
create policy "diary_insert_own" on public.diary_entries
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "diary_update_own" on public.diary_entries;
create policy "diary_update_own" on public.diary_entries
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "diary_delete_own" on public.diary_entries;
create policy "diary_delete_own" on public.diary_entries
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own" on public.favorites
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own" on public.favorites
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "favorites_update_own" on public.favorites;
create policy "favorites_update_own" on public.favorites
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own" on public.favorites
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "notes_select_own" on public.user_notes;
create policy "notes_select_own" on public.user_notes
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "notes_insert_own" on public.user_notes;
create policy "notes_insert_own" on public.user_notes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "notes_update_own" on public.user_notes;
create policy "notes_update_own" on public.user_notes
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "notes_delete_own" on public.user_notes;
create policy "notes_delete_own" on public.user_notes
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "settings_select_own" on public.user_settings;
create policy "settings_select_own" on public.user_settings
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "settings_insert_own" on public.user_settings;
create policy "settings_insert_own" on public.user_settings
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "settings_update_own" on public.user_settings;
create policy "settings_update_own" on public.user_settings
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "settings_delete_own" on public.user_settings;
create policy "settings_delete_own" on public.user_settings
  for delete to authenticated using (auth.uid() = user_id);

-- Optional server-side updated_at maintenance.
create or replace function public.foodlab_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists diary_entries_updated_at on public.diary_entries;
create trigger diary_entries_updated_at before update on public.diary_entries
for each row execute function public.foodlab_set_updated_at();
drop trigger if exists favorites_updated_at on public.favorites;
create trigger favorites_updated_at before update on public.favorites
for each row execute function public.foodlab_set_updated_at();
drop trigger if exists user_notes_updated_at on public.user_notes;
create trigger user_notes_updated_at before update on public.user_notes
for each row execute function public.foodlab_set_updated_at();
drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at before update on public.user_settings
for each row execute function public.foodlab_set_updated_at();

-- Explicit client privileges: authenticated users only; RLS remains mandatory.
revoke all on public.diary_entries, public.favorites, public.user_notes, public.user_settings from anon;
grant select, insert, update, delete on public.diary_entries, public.favorites, public.user_notes, public.user_settings to authenticated;
