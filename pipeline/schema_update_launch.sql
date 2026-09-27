-- Launch-readiness update. Run once in Supabase SQL editor. Safe to run more than once.

-- 1. "Also reported by" on each story
alter table stories add column if not exists also_reported jsonb not null default '[]';

-- 2. Links we've already handled but didn't turn into a card (duplicates, adverts),
--    so the AI never reads them twice. Private: only the pipeline can see it.
create table if not exists seen_links (
  id text primary key,
  reason text not null,
  story_id text references stories(id) on delete set null,
  created_at timestamptz default now()
);
alter table seen_links enable row level security;

-- 3. One row per pipeline run, for monitoring and the daily AI cap. Private.
create table if not exists pipeline_runs (
  id bigserial primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  added int default 0,
  merged int default 0,
  skipped int default 0,
  failed int default 0,
  ai_calls int default 0,
  sources_ok int default 0,
  sources_total int default 0,
  ok boolean default true
);
alter table pipeline_runs enable row level security;

-- 4. "Report an error" from the app. The app can ADD a report but can never READ, change or delete them.
create table if not exists reports (
  id bigserial primary key,
  story_id text not null references stories(id) on delete cascade,
  reason text not null check (reason in ('Wrong facts', 'Wrong severity', 'Broken link', 'Duplicate story', 'Not cyber news', 'Other')),
  created_at timestamptz default now()
);
alter table reports enable row level security;
drop policy if exists "app can add reports" on reports;
create policy "app can add reports" on reports for insert to anon with check (true);

-- 5. Make sure the app can only READ stories (no insert, update or delete policies exist)
alter table stories enable row level security;
drop policy if exists "public read" on stories;
create policy "public read" on stories for select using (true);
