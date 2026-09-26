-- CyberShorts database schema. Run once in Supabase SQL editor.
create table if not exists stories (
  id text primary key,
  source text not null,
  url text not null,
  orig_title text not null,
  headline text not null,
  simple text not null,
  technical text not null,
  category text not null,
  country text not null default 'GB',
  language text not null default 'en',
  image_url text,
  published_at timestamptz not null,
  created_at timestamptz default now()
);

create index if not exists stories_published_idx on stories (published_at desc);
create index if not exists stories_category_idx on stories (category, published_at desc);
create index if not exists stories_country_idx on stories (country, published_at desc);

alter table stories enable row level security;
drop policy if exists "public read" on stories;
create policy "public read" on stories for select using (true);
