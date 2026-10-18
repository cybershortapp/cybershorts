-- Run once in Supabase > SQL Editor (safe to run more than once).
-- Release 1.0.4: awareness games and trending decks. The app can read both; only the pipeline can write.

-- 1. A short game for some stories (scams, breaches, serious flaws in everyday apps)
create table if not exists games (
  id text primary key,
  story_id text not null references stories(id) on delete cascade,
  style text not null check (style in ('scam_or_legit', 'patch_or_panic', 'red_flags', 'real_link', 'order_steps', 'crack_meter')),
  data jsonb not null,
  fingerprint text not null,
  created_at timestamptz not null default now()
);
create index if not exists games_story_idx on games (story_id);
create index if not exists games_created_idx on games (created_at desc);
alter table games enable row level security;
drop policy if exists "public read" on games;
create policy "public read" on games for select using (true);

-- 2. Trending decks: a few swipeable slides about a group or topic that's in the news right now
create table if not exists decks (
  id text primary key,
  topic text not null,
  title text not null,
  slides jsonb not null,
  story_ids text[] not null default '{}',
  country text not null default 'INTL',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists decks_expires_idx on decks (expires_at desc);
alter table decks enable row level security;
drop policy if exists "public read" on decks;
create policy "public read" on decks for select using (true);
