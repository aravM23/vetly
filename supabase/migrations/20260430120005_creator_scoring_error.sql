-- Add scoring_error to public.creators so the score-creators Edge Function
-- can mark Creators that hit a Gemini error (429 rate limit, 402 quota,
-- parse failure, etc). The UI surfaces these so the user can retry, and the
-- partial index makes the "Errored" filter on the dashboard fast.

alter table public.creators
  add column if not exists scoring_error text;

create index if not exists creators_user_scoring_error_idx
  on public.creators (user_id)
  where scoring_error is not null;
