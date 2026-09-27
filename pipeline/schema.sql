-- CyberShorts database schema. Run once in Supabase SQL editor.
create table if not exists stories (
  id text primary key,
  source text not null,
  url text not null,
  orig_title text not null,
  headline text not null,
  simple text,
  technical text not null,
  why_it_matters text,
  severity text,
  action text,
  cves text[] not null default '{}',
  attack_chain jsonb,
  chain_checked boolean not null default false,
  also_reported jsonb not null default '[]',
  incident jsonb,
  actor_group text,
  category text not null,
  country text not null default 'GB',
  language text not null default 'en',
  image_url text,
  published_at timestamptz not null,
  created_at timestamptz default now()
);

create index if not exists stories_published_idx on stories (published_at desc);
create index if not exists stories_category_idx on stories (category, published_at desc);
create index if not exists stories_severity_idx on stories (severity, published_at desc);
create index if not exists stories_country_idx on stories (country, published_at desc);

alter table stories enable row level security;
drop policy if exists "public read" on stories;
create policy "public read" on stories for select using (true);

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
  research int default 0,
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

-- Public threat group profiles from MITRE ATT&CK. The app can read them, only the pipeline can change them.
create table if not exists threat_groups (
  id text primary key,
  name text not null,
  aliases text[] not null default '{}',
  summary text,
  methods text[] not null default '{}',
  campaigns text[] not null default '{}',
  url text not null,
  updated_at timestamptz default now()
);
alter table threat_groups enable row level security;
drop policy if exists "public read" on threat_groups;
create policy "public read" on threat_groups for select using (true);
