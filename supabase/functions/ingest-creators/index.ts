// Vetly ingest-creators Edge Function
//
// Public webhook (verify_jwt = false in supabase/config.toml). Auth is via
// the x-webhook-secret header matched against user_settings.webhook_secret;
// the secret is the only thing that ties an inbound request to a user_id.
//
// Body: either application/json with shape {creators: [...]} or text/csv with
// a header row. Either way, each row is normalized server-side (column aliases
// resolved, follower counts parsed, handle stripped of @ and URL prefix,
// platform detected from URL when not explicit). Rows that fail validation are
// reported in `errors` rather than rejecting the whole batch.
//
// Upserts via the upsert_creators RPC, which preserves score_*, ai_reasoning,
// scored_at, status, and included_in_digest_at on conflict so re-importing a
// Creator never invalidates an existing review.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { parse as parseCsv } from 'jsr:@std/csv'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-webhook-secret',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const VALID_PLATFORMS = new Set(['instagram', 'tiktok'])

type RawRow = Record<string, unknown>

type NormalizedRow = {
  handle: string
  platform: string
  display_name?: string | null
  profile_url?: string | null
  bio?: string | null
  niche?: string | null
  follower_count?: number | null
  following_count?: number | null
  post_count?: number | null
  avg_likes?: number | null
  avg_comments?: number | null
  engagement_rate?: number | null
  raw: RawRow
}

type RowError = {
  index: number
  reason: string
  row: RawRow
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const secret = req.headers.get('x-webhook-secret')
  if (!secret) {
    return json({ error: 'Missing x-webhook-secret header' }, 401)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Resolve user_id from the webhook secret. Service role bypasses RLS.
  const { data: settings, error: settingsErr } = await supabase
    .from('user_settings')
    .select('user_id')
    .eq('webhook_secret', secret)
    .maybeSingle()

  if (settingsErr) {
    return json({ error: settingsErr.message }, 500)
  }
  if (!settings) {
    return json({ error: 'Invalid webhook secret' }, 401)
  }
  const userId = settings.user_id as string

  // Parse body.
  const contentType = (req.headers.get('content-type') ?? '').toLowerCase()
  let rawRows: RawRow[]
  try {
    rawRows = await readRows(req, contentType)
  } catch (e) {
    return json({ error: `Failed to parse body: ${e instanceof Error ? e.message : String(e)}` }, 400)
  }

  if (rawRows.length === 0) {
    return json({ error: 'No rows in payload' }, 400)
  }

  // Source labels are optional querystring params, useful when wiring multiple
  // upstream tools to the same webhook.
  const url = new URL(req.url)
  const source = url.searchParams.get('source') ?? (contentType.includes('json') ? 'api' : 'csv')
  const sourceLabel = url.searchParams.get('label')

  // Open a batch row first so we have a batch_id to attach to each Creator,
  // and so traffic that errors out mid-stream still leaves a forensic trail.
  const { data: batch, error: batchErr } = await supabase
    .from('ingest_batches')
    .insert({
      user_id: userId,
      source,
      source_label: sourceLabel,
      row_count: rawRows.length,
      status: 'processing',
    })
    .select('id')
    .single()

  if (batchErr || !batch) {
    return json({ error: batchErr?.message ?? 'Failed to create batch' }, 500)
  }
  const batchId = batch.id as string

  // Normalize + dedupe within the batch. Errors are collected per-row so a
  // single bad row never tanks the whole import.
  const errors: RowError[] = []
  const seen = new Set<string>()
  const normalized: NormalizedRow[] = []
  let dedupeCount = 0

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i]
    let row: NormalizedRow
    try {
      row = normalizeRow(raw)
    } catch (e) {
      errors.push({ index: i, reason: e instanceof Error ? e.message : String(e), row: raw })
      continue
    }
    const key = `${row.platform}:${row.handle.toLowerCase()}`
    if (seen.has(key)) {
      dedupeCount++
      continue
    }
    seen.add(key)
    normalized.push(row)
  }

  // Bulk upsert via RPC. The RPC preserves scores on conflict.
  let importedCount = 0
  if (normalized.length > 0) {
    const rpcRows = normalized.map((n) => ({
      handle: n.handle,
      platform: n.platform,
      display_name: n.display_name ?? null,
      profile_url: n.profile_url ?? null,
      bio: n.bio ?? null,
      niche: n.niche ?? null,
      follower_count: n.follower_count ?? '',
      following_count: n.following_count ?? '',
      post_count: n.post_count ?? '',
      avg_likes: n.avg_likes ?? '',
      avg_comments: n.avg_comments ?? '',
      engagement_rate: n.engagement_rate ?? '',
      raw: n.raw,
    }))

    const { data: ids, error: rpcErr } = await supabase.rpc('upsert_creators', {
      p_user_id: userId,
      p_batch_id: batchId,
      p_rows: rpcRows,
    })

    if (rpcErr) {
      await supabase
        .from('ingest_batches')
        .update({ status: 'error', notes: rpcErr.message })
        .eq('id', batchId)
      return json({ error: rpcErr.message, batch_id: batchId }, 500)
    }
    importedCount = Array.isArray(ids) ? ids.length : 0
  }

  await supabase
    .from('ingest_batches')
    .update({
      status: errors.length > 0 ? 'imported_with_errors' : 'imported',
      imported_count: importedCount,
      notes: errors.length > 0 ? `${errors.length} row(s) failed normalization` : null,
    })
    .eq('id', batchId)

  return json(
    {
      batch_id: batchId,
      row_count: rawRows.length,
      imported_count: importedCount,
      dedupe_count: dedupeCount,
      errors,
    },
    200
  )
})

// ─── body parsing ────────────────────────────────────────────────────────────

async function readRows(req: Request, contentType: string): Promise<RawRow[]> {
  if (contentType.includes('application/json')) {
    const body = await req.json()
    const list = Array.isArray(body) ? body : body?.creators
    if (!Array.isArray(list)) {
      throw new Error('Expected {creators: [...]} or a top-level array')
    }
    return list as RawRow[]
  }

  // Default to CSV. Accepts text/csv, text/plain, or anything else.
  const text = await req.text()
  if (!text.trim()) return []
  // skipFirstRow + columns inferred from the header row.
  const parsed = parseCsv(text, { skipFirstRow: true }) as Record<string, string>[]
  return parsed
}

// ─── per-row normalization ──────────────────────────────────────────────────

function normalizeRow(raw: RawRow): NormalizedRow {
  const get = (...keys: string[]) => firstString(raw, keys)
  const getNum = (...keys: string[]) => firstString(raw, keys)

  // Try to extract handle and platform together from a profile URL.
  const profileUrlInput =
    get('profile_url', 'profile url', 'url', 'link', 'profile', 'profile_link') ?? ''
  const fromUrl = extractFromUrl(profileUrlInput)

  // Handle: prefer explicit handle/username, fall back to URL extraction.
  const handleInput = get('handle', 'username', 'user', 'screen_name')
  let handle = normalizeHandle(handleInput) ?? fromUrl.handle
  if (!handle) {
    throw new Error('Missing handle (handle, username, or profile URL required)')
  }
  handle = handle.toLowerCase()

  // Platform: explicit column wins, then URL detection.
  const platformInput = get('platform', 'network', 'channel', 'source_platform')
  let platform = (platformInput ?? '').trim().toLowerCase() || fromUrl.platform || null
  if (!platform) {
    throw new Error('Missing platform (column or detectable URL required)')
  }
  if (!VALID_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported platform "${platform}" (must be instagram or tiktok)`)
  }

  const profileUrl = profileUrlInput.trim() || null

  const followerCount = parseCount(getNum('follower_count', 'followers', 'audience', 'follower'))
  const followingCount = parseCount(getNum('following_count', 'following'))
  const postCount = parseCount(getNum('post_count', 'posts', 'post'))
  const avgLikes = parseDecimal(getNum('avg_likes', 'average_likes', 'avg likes', 'likes'))
  const avgComments = parseDecimal(getNum('avg_comments', 'average_comments', 'avg comments', 'comments'))

  let engagementRate = parseEngagementRate(
    getNum('engagement_rate', 'engagement', 'engagement %', 'er')
  )
  if (engagementRate == null && avgLikes != null && avgComments != null && followerCount && followerCount > 0) {
    engagementRate = (avgLikes + avgComments) / followerCount
  }

  return {
    handle,
    platform,
    display_name: get('display_name', 'display name', 'full_name', 'full name', 'name')?.trim() || null,
    profile_url: profileUrl,
    bio: get('bio', 'description', 'about')?.trim() || null,
    niche: get('niche', 'category', 'topic', 'interests', 'interest')?.trim() || null,
    follower_count: followerCount,
    following_count: followingCount,
    post_count: postCount,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    engagement_rate: engagementRate,
    raw,
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// Looks up the first key from the row that has a non-empty string value.
// Case-insensitive and tolerant of trailing whitespace in column names.
function firstString(row: RawRow, keys: string[]): string | null {
  const lookup = new Map<string, unknown>()
  for (const [k, v] of Object.entries(row)) {
    lookup.set(k.trim().toLowerCase(), v)
  }
  for (const k of keys) {
    const v = lookup.get(k.trim().toLowerCase())
    if (v == null) continue
    const s = String(v).trim()
    if (s) return s
  }
  return null
}

function normalizeHandle(input: string | null): string | null {
  if (!input) return null
  const s = input.trim()
  if (!s) return null

  // If the cell looks like a URL, route through URL extraction.
  if (s.includes('/') || s.includes('.com')) {
    const ext = extractFromUrl(s)
    if (ext.handle) return ext.handle
  }

  return s.replace(/^@/, '').trim() || null
}

function extractFromUrl(url: string): { platform: string | null; handle: string | null } {
  if (!url) return { platform: null, handle: null }
  const norm = url.trim().toLowerCase()

  const ig = norm.match(/(?:^|\/\/|www\.)instagram\.com\/([a-z0-9_.]+)/i)
  if (ig) return { platform: 'instagram', handle: ig[1] }

  const tt = norm.match(/(?:^|\/\/|www\.)tiktok\.com\/@?([a-z0-9_.]+)/i)
  if (tt) return { platform: 'tiktok', handle: tt[1] }

  return { platform: null, handle: null }
}

// Parses follower-count strings like "12.3k", "1.2M", "1,234,567" to integers.
// Returns null on null/empty/unparseable input.
function parseCount(input: string | null): number | null {
  if (input == null) return null
  const s = String(input).trim().toLowerCase().replace(/,/g, '')
  if (!s) return null
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const mult = m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : m[2] === 'b' ? 1_000_000_000 : 1
  return Math.round(n * mult)
}

// Parses arbitrary decimals with optional k/M/B suffixes, used for like/comment
// averages where fractional values are common.
function parseDecimal(input: string | null): number | null {
  if (input == null) return null
  const s = String(input).trim().toLowerCase().replace(/,/g, '')
  if (!s) return null
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const mult = m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : m[2] === 'b' ? 1_000_000_000 : 1
  return n * mult
}

// Engagement rate may arrive as "2.5%", "2.5", or "0.025". We collapse all
// three to a fraction (0.025). Anything > 1 is assumed to be a percent.
function parseEngagementRate(input: string | null): number | null {
  if (input == null) return null
  const s = String(input).trim()
  if (!s) return null
  const hasPct = s.endsWith('%')
  const cleaned = s.replace('%', '').replace(/,/g, '').trim()
  const n = parseFloat(cleaned)
  if (!Number.isFinite(n)) return null
  if (hasPct) return n / 100
  if (n > 1) return n / 100
  return n
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}
