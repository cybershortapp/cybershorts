-- Snake chain update: incident facts, attacker profiles, research counter. Safe to run more than once.
alter table stories add column if not exists incident jsonb;
alter table stories add column if not exists actor_group text;
alter table pipeline_runs add column if not exists research int default 0;

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
