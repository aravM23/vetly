# ADR-0001: Stack selection

- **Status:** Accepted
- **Date:** 2026-04-30
- **Deciders:** Leo (sole owner)

## Context

Vetly is a personal-tool MVP: a CSV of Instagram and TikTok Creators is dumped in, an LLM scores each Creator against Leo's ICP and product description, and the top picks are emailed every morning at 7:00 AM. The user count is one. The hard requirements are: row-level security per user (so we can grow to multi-tenant later without a rewrite), a scheduled job, durable storage of Creator records and scores, and an LLM call cheap enough to run on hundreds of Creators per import without flinching.

This ADR captures the stack choices that were debated in the planning conversation, so future decisions can reference the trade-offs we already made instead of relitigating them.

## Decisions

### 1. Backend: Supabase

**Picked:** Supabase (Postgres, Auth, Edge Functions in Deno, Storage, pg_cron).

**Rejected:** Convex.

**Why.** Convex is genuinely nicer to write code for, especially the live-query story. But Vetly's data model is dead simple (a few tables, no real-time UI requirements, no collaborative editing). The actual constraints that mattered were:

- A built-in cron primitive that runs server-side, not browser-side. Supabase has pg_cron; Convex has cron jobs but the integration with external HTTP calls is more cumbersome.
- Postgres directly, so we can write SQL when we need to and use standard tooling (psql, Supabase Studio) instead of a proprietary query language.
- Cheap, generous free tier for a personal tool that may sit at one user for a while.
- Webhook-style Edge Functions that accept arbitrary payloads (CSV or JSON) without forcing a typed schema, which matters because the upstream CSVs are messy.

Supabase wins on every one of those. Convex's developer-experience advantage doesn't translate into anything we'd actually use here.

### 2. LLM: Google Gemini 2.5 Flash via the official SDK

**Picked:** `@google/generative-ai` calling Gemini 2.5 Flash directly.

**Rejected:** OpenRouter as a model-router middleman.

**Why.** OpenRouter is great when you're A/B-ing models or want to swap providers on the fly. We're not. Gemini 2.5 Flash specifically:

- Has native JSON-mode / structured-output support, so the scoring prompt returns parsed objects without a regex-the-output dance.
- Is the cheapest frontier-class model per token at this writing, which matters when we may score hundreds of Creators per batch.
- The SDK is small, well-typed, and runs cleanly in Deno (Edge Functions).

If we ever do want to swap models, the scoring function is one file; replacing the SDK call is a 30-minute refactor. Adding OpenRouter today would be paying a complexity tax for optionality we don't need.

### 3. Email: Resend, sandbox mode for the MVP

**Picked:** Resend, sending from `onboarding@resend.dev` initially.

**Rejected:** Resend with a verified custom domain on day one; SendGrid; Postmark; raw SMTP.

**Why.** Sandbox mode means zero DNS work and zero risk of a typo bricking my own email. Sending only to my own verified address until I'm sure the digest formatting is right is the cheapest possible feedback loop. The custom domain (deliverability, branding, recipient choice) is a step we'll take once the digest is actually useful, not before. Switching to a custom domain later is a single Resend dashboard change plus DNS records, no code change.

Resend specifically because the API is small, the React Email integration is clean if we ever want it, and the free tier comfortably covers a daily personal digest.

### 4. Frontend: Vite + React + TypeScript

**Picked:** Vite + React + TS + Tailwind + shadcn/ui, deployed to Vercel.

**Rejected:** Next.js (App Router).

**Why.** Vetly has no SSR requirement, no SEO surface, no marketing pages, no edge-rendered routes. It's a single-user authenticated app behind a login wall. Next.js solves problems we don't have and adds a server-component mental model that would be pure friction for a workload that's "fetch from Supabase, render, mutate." Vite gives us a faster dev loop, simpler routing (react-router), and a frontend bundle that's straightforwardly hostable anywhere. If Vetly ever grows a public marketing site, that's a separate project.

shadcn/ui because we want full control over component source (the editorial dark palette in this repo is non-default and would fight a closed component library), and we want to commit components into the repo rather than pin to a versioned package.

### 5. Data ingestion: webhook + CSV, not scraping

**Picked:** Accept CSV exports from upstream tools (Manus, Lessee) via a webhook endpoint.

**Rejected:** Scraping Instagram and TikTok directly.

**Why.** Scraping Instagram and TikTok is a maintenance treadmill: anti-bot defenses change weekly, IPs get rate-limited, and the scrapers are constantly breaking. The upstream tools (Manus, Lessee) already pay for that battle. Vetly's job is to be the scoring and ranking layer on top of whatever data the user is already collecting, not to redo the collection. The webhook also makes the architecture pleasingly composable: any future source (a Google Sheet, a manual entry form, a different scraping tool) is just another producer hitting the same endpoint.

The CSV format means we have to do column normalization on our end (handles like `@user`, `https://instagram.com/user`, or `user`; followers as `12.3k` or `12300`), but that's a one-shot piece of code, not an ongoing maintenance cost.

## Consequences

- We're locked into Postgres for our data model. Migrations are SQL files under `supabase/migrations/`.
- All multi-tenant safety relies on RLS policies. Every table gets `auth.uid() = user_id` policies, and the ingest webhook bypasses RLS via the service role key (it can't use a user JWT because the caller is an upstream tool, not the user). User identity in the webhook path is established by matching `x-webhook-secret` against `user_settings.webhook_secret`.
- The scheduled digest depends on pg_cron running inside the Supabase project. If we ever need to leave Supabase, the cron job is the most coupled piece.
- Gemini 2.5 Flash specifically: if Google deprecates or reprices it, the scoring function needs a one-file swap. No other code path depends on the model.
- Frontend hosting on Vercel: we're not using any Vercel-specific features (no Edge Middleware, no Server Components, no Vercel KV). If Vercel becomes inconvenient, Netlify or Cloudflare Pages are drop-in replacements.

## Revisit when

- Vetly has a second user, OR
- We need a public marketing or onboarding surface, OR
- Gemini 2.5 Flash is no longer the cost/quality leader for this kind of structured scoring task, OR
- The digest needs to send to recipients other than the account owner (move off Resend sandbox).
