-- Growth watch (Nov 2026): sizes for the daily growth check email (pipeline/growth.py).
-- Run once in Supabase, SQL Editor. Read-only, and only the server key can call it (not the app).
create or replace function public.usage_sizes()
returns json language sql stable security definer set search_path = public, storage, pg_catalog as $$
  select json_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage', coalesce((
      select json_agg(t) from (
        select bucket_id as bucket,
               case when position('/' in name) > 0 then split_part(name, '/', 1) else '' end as folder,
               count(*) as files,
               coalesce(sum((metadata->>'size')::bigint), 0) as bytes
        from storage.objects
        group by 1, 2) t), '[]'::json)
  );
$$;
revoke all on function public.usage_sizes() from public, anon, authenticated;
grant execute on function public.usage_sizes() to service_role;
