-- Bulk upsert RPC for the ingest-creators Edge Function.
--
-- Why an RPC instead of supabase-js's .upsert(): the standard upsert overwrites
-- every column on conflict, which would clobber scores from a previous Gemini
-- run any time the user re-imports a CSV. We need ON CONFLICT DO UPDATE that
-- explicitly refreshes only the data fields and leaves score_*, ai_reasoning,
-- scored_at, status, and included_in_digest_at alone.
--
-- The COALESCE(excluded.x, public.creators.x) pattern means a missing field in
-- the new payload won't blank out an existing value (e.g., if the latest CSV
-- export drops the bio field, we keep the previously-imported bio).

create or replace function public.upsert_creators(
  p_user_id uuid,
  p_batch_id uuid,
  p_rows jsonb
)
returns setof uuid
language plpgsql
security invoker
as $$
begin
  return query
  insert into public.creators (
    user_id, batch_id, handle, platform, display_name, profile_url,
    bio, niche, follower_count, following_count, post_count,
    avg_likes, avg_comments, engagement_rate, raw
  )
  select
    p_user_id,
    p_batch_id,
    r->>'handle',
    r->>'platform',
    nullif(r->>'display_name', ''),
    nullif(r->>'profile_url', ''),
    nullif(r->>'bio', ''),
    nullif(r->>'niche', ''),
    nullif(r->>'follower_count', '')::integer,
    nullif(r->>'following_count', '')::integer,
    nullif(r->>'post_count', '')::integer,
    nullif(r->>'avg_likes', '')::numeric,
    nullif(r->>'avg_comments', '')::numeric,
    nullif(r->>'engagement_rate', '')::numeric,
    r->'raw'
  from jsonb_array_elements(p_rows) r
  on conflict (user_id, platform, handle) do update set
    batch_id        = excluded.batch_id,
    display_name    = coalesce(excluded.display_name,    public.creators.display_name),
    profile_url     = coalesce(excluded.profile_url,     public.creators.profile_url),
    bio             = coalesce(excluded.bio,             public.creators.bio),
    niche           = coalesce(excluded.niche,           public.creators.niche),
    follower_count  = coalesce(excluded.follower_count,  public.creators.follower_count),
    following_count = coalesce(excluded.following_count, public.creators.following_count),
    post_count      = coalesce(excluded.post_count,      public.creators.post_count),
    avg_likes       = coalesce(excluded.avg_likes,       public.creators.avg_likes),
    avg_comments    = coalesce(excluded.avg_comments,    public.creators.avg_comments),
    engagement_rate = coalesce(excluded.engagement_rate, public.creators.engagement_rate),
    raw             = coalesce(excluded.raw,             public.creators.raw)
  returning public.creators.id;
end;
$$;
