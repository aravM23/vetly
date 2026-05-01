# Vetly

AI-powered Creator vetting. Drop a CSV of Instagram Creators from Manus, Lessee, or any other source; Gemini 2.5 Flash scores each one against your ICP; the top picks land in your inbox each morning. Single-user MVP, scoped to Stanley.

## Env

Frontend (`.env.local`):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (publishable key, either `sb_publishable_*` or the legacy anon JWT)

Edge Function secrets (set via `supabase secrets set <KEY>=<VALUE>`):

- `GEMINI_API_KEY` — required by score-creators
- `RESEND_API_KEY` — required by send-digest
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the platform

## Run locally

```sh
npm install
cp .env.example .env.local   # fill in the two VITE_ vars
npm run dev                  # http://localhost:5173
```

## Deploy

```sh
supabase db push                      # apply migrations to remote
supabase functions deploy <name>      # ingest-creators | score-creators | send-digest
```

The hourly digest is fired by pg_cron (migration 0006), which authenticates against send-digest using a service-role JWT stored in Supabase Vault. One-shot setup: `supabase/diagnostics/setup_vault_cron_jwt.sql`.

## Architecture

Vite + React + TypeScript + Tailwind + shadcn on the front. Supabase (Postgres, Auth, Edge Functions in Deno, pg_cron) on the back. Gemini 2.5 Flash for scoring. Resend (sandbox mode, `onboarding@resend.dev`) for email. See [`docs/adr/0001-stack-selection.md`](docs/adr/0001-stack-selection.md) for the why.

## Routes

- `/auth` — sign in / sign up (email + password, verification required)
- `/` — dashboard (Creator table, filters, drawer)
- `/import` — drag-drop CSV
- `/digest` — tomorrow's email preview + test send
- `/settings` — ICP, follower / engagement filters, daily send schedule, webhook URL + secret

## Layout

```
src/                       Vite app
supabase/migrations/       SQL migrations (timestamped)
supabase/functions/        Edge Functions (Deno)
supabase/config.toml       Function config (verify_jwt overrides)
supabase/diagnostics/      Local-only one-shot SQL (gitignored)
docs/adr/                  Architecture decision records
```
