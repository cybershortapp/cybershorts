-- Attack chain update. Run once in Supabase SQL editor. Safe to run more than once.
alter table stories add column if not exists attack_chain jsonb;
alter table stories add column if not exists chain_checked boolean not null default false;
