-- Round 1 update. Run once in Supabase SQL editor. Safe to run more than once.
alter table stories add column if not exists why_it_matters text;
alter table stories add column if not exists severity text;
alter table stories add column if not exists action text;
alter table stories add column if not exists cves text[] not null default '{}';

-- the Simple summary is no longer used
alter table stories alter column simple drop not null;

create index if not exists stories_severity_idx on stories (severity, published_at desc);
