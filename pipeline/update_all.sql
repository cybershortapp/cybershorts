-- CyberShorts: ALL database updates in one go. Safe to run more than once, on dev now and on prod later.
alter table stories add column if not exists why_it_matters text;
alter table stories add column if not exists severity text;
alter table stories add column if not exists action text;
alter table stories add column if not exists cves text[] not null default '{}';
alter table stories alter column simple drop not null;
alter table stories add column if not exists attack_chain jsonb;
alter table stories add column if not exists chain_checked boolean not null default false;
alter table stories add column if not exists also_reported jsonb not null default '[]';
alter table stories add column if not exists incident jsonb;
alter table stories add column if not exists actor_group text;
create index if not exists stories_severity_idx on stories (severity, published_at desc);

create table if not exists seen_links (
  id text primary key, reason text not null,
  story_id text references stories(id) on delete set null, created_at timestamptz default now()
);
alter table seen_links enable row level security;

create table if not exists pipeline_runs (
  id bigserial primary key, started_at timestamptz not null, finished_at timestamptz,
  added int default 0, merged int default 0, skipped int default 0, failed int default 0,
  ai_calls int default 0, research int default 0, sources_ok int default 0, sources_total int default 0,
  ok boolean default true
);
alter table pipeline_runs add column if not exists research int default 0;
alter table pipeline_runs enable row level security;

create table if not exists reports (
  id bigserial primary key,
  story_id text not null references stories(id) on delete cascade,
  reason text not null check (reason in ('Wrong facts', 'Wrong severity', 'Broken link', 'Duplicate story', 'Not cyber news', 'Other')),
  created_at timestamptz default now()
);
alter table reports enable row level security;
drop policy if exists "app can add reports" on reports;
create policy "app can add reports" on reports for insert to anon with check (true);

create table if not exists threat_groups (
  id text primary key, name text not null, aliases text[] not null default '{}',
  summary text, methods text[] not null default '{}', campaigns text[] not null default '{}',
  url text not null, updated_at timestamptz default now()
);
alter table threat_groups enable row level security;
drop policy if exists "public read" on threat_groups;
create policy "public read" on threat_groups for select using (true);

alter table stories enable row level security;
drop policy if exists "public read" on stories;
create policy "public read" on stories for select using (true);

-- AI cover pictures: a public folder the app can view; only the pipeline (secret key) can add or delete
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 1048576, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];
