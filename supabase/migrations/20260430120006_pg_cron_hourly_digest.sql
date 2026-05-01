-- Hourly cron schedule that fires the send-digest Edge Function.
--
-- Architecture: ONE schedule entry that runs at minute 0 of every hour.
-- The function loads user_settings rows where daily_send_enabled is true
-- AND daily_send_hour matches extract(hour from now() at time zone 'UTC')
-- internally, so we don't need 24 entries (one per send hour).
--
-- Authentication: pg_cron calls the function with the service-role JWT in
-- the Authorization header. The function's cron mode (`{"cron": true}` in
-- the body) verifies the bearer matches SUPABASE_SERVICE_ROLE_KEY before
-- looping over users.
--
-- The JWT is stored in Supabase Vault under the name 'cron_service_role_jwt'
-- and resolved at fire time. This keeps it out of pg_cron's stored command
-- string (visible to anyone with read access to cron.job) and out of git.
-- See supabase/diagnostics/setup_vault_cron_jwt.sql for the one-shot
-- setup the user runs ONCE in the dashboard SQL editor before the first
-- scheduled fire.
--
-- The Supabase URL below is hardcoded to the Vetly project ref. If Vetly
-- ever migrates to another project, update this migration with the new
-- ref AND re-run it.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- Idempotent: replace any existing schedule with the same name. Lets us
-- re-run the migration safely after editing the URL or body shape.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'vetly-hourly-digest') then
    perform cron.unschedule('vetly-hourly-digest');
  end if;
end $$;

select cron.schedule(
  'vetly-hourly-digest',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://nyupdyxufedrjnntfwud.supabase.co/functions/v1/send-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || coalesce(
        (select decrypted_secret
         from vault.decrypted_secrets
         where name = 'cron_service_role_jwt'
         limit 1),
        ''
      ),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('cron', true)
  );
  $$
);

-- Print the schedule so it appears in `supabase db push` output.
select jobid, jobname, schedule, active, command
from cron.job
where jobname = 'vetly-hourly-digest';
