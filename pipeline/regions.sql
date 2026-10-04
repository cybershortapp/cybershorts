-- Regions (5 Oct 2026): remembers which country each phone is in, so alerts and tips can be local.
-- Run once in Supabase: SQL Editor, New query, paste all of this, Run. Safe to run again.

alter table devices add column if not exists country text not null default 'GB';

-- same checks as before, plus the reader's region (GB, IN or INTL)
create or replace function register_device(p_token text, p_products text[], p_terms text[], p_alerts boolean, p_country text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$' then raise exception 'invalid token'; end if;
  if coalesce(array_length(p_products, 1), 0) > 50 or coalesce(array_length(p_terms, 1), 0) > 20 then raise exception 'too many preferences'; end if;
  if exists (select 1 from unnest(coalesce(p_products, '{}') || coalesce(p_terms, '{}')) x where length(x) > 40) then raise exception 'preference too long'; end if;
  if p_country is not null and p_country !~ '^(GB|IN|INTL)$' then raise exception 'invalid country'; end if;
  insert into devices (token, products, terms, alerts, country, updated_at)
  values (p_token, coalesce(p_products, '{}'), coalesce(p_terms, '{}'), coalesce(p_alerts, true), coalesce(p_country, 'GB'), now())
  on conflict (token) do update set products = excluded.products, terms = excluded.terms, alerts = excluded.alerts,
    country = excluded.country, updated_at = now();
end $$;

revoke all on function register_device(text, text[], text[], boolean, text) from public;
grant execute on function register_device(text, text[], text[], boolean, text) to anon, authenticated;
