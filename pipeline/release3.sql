-- Run once in Supabase > SQL Editor (safe to run more than once).

-- 1. Picture colour for each story (the app's Vivid theme)
alter table stories add column if not exists tint text;

-- 2. Crash reports from the app: the app can only add rows, never read them (like story reports)
create table if not exists app_errors (
  id bigserial primary key,
  message text not null check (char_length(message) <= 400),
  fatal boolean not null default false,
  app_version text check (char_length(app_version) <= 20),
  android_version text check (char_length(android_version) <= 20),
  device text check (char_length(device) <= 60),
  created_at timestamptz default now()
);
alter table app_errors enable row level security;
drop policy if exists "app can add errors" on app_errors;
create policy "app can add errors" on app_errors for insert to anon with check (true);
