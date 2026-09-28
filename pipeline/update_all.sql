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

-- ===== Round 3: products, zero-days, phone alerts, email digest =====
alter table stories add column if not exists products text[] not null default '{}';
alter table stories add column if not exists zero_day boolean not null default false;
create index if not exists stories_products_idx on stories using gin (products);
create index if not exists stories_created_idx on stories (created_at desc);
create index if not exists stories_zero_day_idx on stories (zero_day, created_at desc) where zero_day;
update stories set zero_day = true
where not zero_day and (orig_title || ' ' || coalesce(technical, '')) ~* '(zero[- ]?day|actively exploited|exploited in the wild|under active exploitation|known exploited vulnerabilit)';

-- phones that want alerts. Private: the app can only add/update/remove its own phone through the functions below.
create table if not exists devices (
  token text primary key,
  products text[] not null default '{}',
  terms text[] not null default '{}',
  alerts boolean not null default true,
  last_push_at timestamptz,
  updated_at timestamptz default now()
);
alter table devices enable row level security;

create or replace function register_device(p_token text, p_products text[], p_terms text[], p_alerts boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$' then raise exception 'invalid token'; end if;
  if coalesce(array_length(p_products, 1), 0) > 50 or coalesce(array_length(p_terms, 1), 0) > 20 then raise exception 'too many preferences'; end if;
  if exists (select 1 from unnest(coalesce(p_products, '{}') || coalesce(p_terms, '{}')) x where length(x) > 40) then raise exception 'preference too long'; end if;
  insert into devices (token, products, terms, alerts, updated_at)
  values (p_token, coalesce(p_products, '{}'), coalesce(p_terms, '{}'), coalesce(p_alerts, true), now())
  on conflict (token) do update set products = excluded.products, terms = excluded.terms, alerts = excluded.alerts, updated_at = now();
end $$;

create or replace function remove_device(p_token text) returns void
language sql security definer set search_path = public as $$ delete from devices where token = p_token $$;

-- email digest subscribers. Private: nothing is sent until the person clicks the confirmation link.
create table if not exists subscribers (
  email text primary key,
  products text[] not null default '{}',
  terms text[] not null default '{}',
  confirmed boolean not null default false,
  token uuid not null default gen_random_uuid() unique,
  confirm_sent_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz default now()
);
alter table subscribers enable row level security;

create or replace function subscribe_email(p_email text, p_products text[], p_terms text[])
returns void language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if e is null or length(e) > 254 or e !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then raise exception 'invalid email'; end if;
  if coalesce(array_length(p_products, 1), 0) > 50 or coalesce(array_length(p_terms, 1), 0) > 20 then raise exception 'too many preferences'; end if;
  insert into subscribers (email, products, terms) values (e, coalesce(p_products, '{}'), coalesce(p_terms, '{}'))
  on conflict (email) do update set products = excluded.products, terms = excluded.terms;
end $$;

create or replace function confirm_email(p_token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update subscribers set confirmed = true where token = p_token;
  return found;
end $$;

create or replace function unsubscribe_email(p_token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from subscribers where token = p_token;
  return found;
end $$;

revoke all on function register_device(text, text[], text[], boolean) from public;
revoke all on function remove_device(text) from public;
revoke all on function subscribe_email(text, text[], text[]) from public;
revoke all on function confirm_email(uuid) from public;
revoke all on function unsubscribe_email(uuid) from public;
grant execute on function register_device(text, text[], text[], boolean) to anon, authenticated;
grant execute on function remove_device(text) to anon, authenticated;
grant execute on function subscribe_email(text, text[], text[]) to anon, authenticated;
grant execute on function confirm_email(uuid) to anon, authenticated;
grant execute on function unsubscribe_email(uuid) to anon, authenticated;
