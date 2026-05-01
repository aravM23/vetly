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

  // Normalize per row first; collect errors without bailing the whole batch.
  const errors: RowError[] = []
  const candidates: NormalizedRow[] = []
  for (let i = 0; i < rawRows.length; i++) {
    try {
      candidates.push(normalizeRow(rawRows[i]))
    } catch (e) {
      errors.push({ index: i, reason: e instanceof Error ? e.message : String(e), row: rawRows[i] })
    }
  }

  // Resolve intra-batch (platform, handle) collisions. Two rows with the same
  // key + same display_name are a true duplicate (drop). Different display_name
  // is a slug collision: keep both by suffixing handle with -2, -3, ... so two
  // distinct Creators that happen to slugify to the same handle don't smush.
  // Cross-batch collisions (against rows already in the DB) are not detected
  // here; the upsert will refresh the existing row, which is acceptable for
  // an MVP with a single user.
  const normalized: NormalizedRow[] = []
  const seenByKey = new Map<string, string>() // platform:handle -> display_name
  let dedupeCount = 0

  for (const row of candidates) {
    let key = `${row.platform}:${row.handle}`
    const existingDisplay = seenByKey.get(key)

    if (existingDisplay !== undefined) {
      const sameDisplay = (existingDisplay ?? '') === (row.display_name ?? '')
      if (sameDisplay) {
        dedupeCount++
        continue
      }
      let suffix = 2
      while (seenByKey.has(`${row.platform}:${row.handle}-${suffix}`)) suffix++
      row.handle = `${row.handle}-${suffix}`
      key = `${row.platform}:${row.handle}`
    }

    seenByKey.set(key, row.display_name ?? '')
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

// Vetly is currently single-target (Stanley → Instagram), so any row that
// can't be resolved to a platform via column or URL falls through to this
// default. If a future CSV adds TikTok Creators, add a 'platform' column to
// the source and the explicit value will win.
const DEFAULT_PLATFORM = 'instagram'

function normalizeRow(raw: RawRow): NormalizedRow {
  const get = (...keys: string[]) => firstString(raw, keys)

  // Pass 1: scan every cell for an instagram.com / tiktok.com URL or an
  // @-prefixed handle. Authoritative if found, since a real handle anywhere
  // in the row is more reliable than guessing from a display name.
  const scanned = scanForHandle(raw)

  // Pass 2: explicit handle column. Aliases are normalized to alphanumeric-
  // only, so "IG Username" and "ig_username" both resolve to "igusername".
  const handleColInput = get(
    'handle',
    'username',
    'user',
    'account',
    'ig',
    'instagram',
    'screen_name',
    'ig_username',
    'ig_handle',
    'instagram_username',
    'instagram_handle',
    'tiktok_username',
    'tiktok_handle',
    'creator_handle',
    'profile_handle',
    'profile_username'
  )

  // Pass 3: profile URL column (handle and platform extractable together).
  const profileUrlInput =
    get('profile_url', 'profile url', 'url', 'link', 'profile', 'profile_link') ?? ''
  const fromUrl = profileUrlInput
    ? extractFromUrl(profileUrlInput)
    : { platform: null as string | null, handle: null as string | null }

  // Pass 4: display name, used for slugified fallback handle and for
  // display_name regardless of which pass produced the canonical handle.
  const displayName = get(
    'display_name',
    'display name',
    'full_name',
    'full name',
    'name',
    'creator',
    'creator_name'
  )

  // Resolve handle in priority order:
  //   1. Explicit handle / username / account / IG / etc column. Wins when
  //      present because it's the producer telling us "this is the handle";
  //      we shouldn't second-guess with a heuristic. Validate that the result
  //      looks like a real handle so a mis-mapped Name column doesn't sneak
  //      through as "pat flynn".
  //   2. Cell-wide scan (URLs, @-prefix anywhere, handle-named col with
  //      handle-shape value). Catches CSVs without an obvious handle column.
  //   3. profile_url column extraction.
  //   4. Slugify display_name as a last resort.
  let handle: string | null = null
  let platformFromHandle: string | null = null

  if (handleColInput) {
    const candidate = normalizeHandle(handleColInput)?.toLowerCase() ?? null
    if (candidate && /^[a-z0-9_.]{1,30}$/.test(candidate)) {
      handle = candidate
    }
  }
  if (!handle && scanned) {
    handle = scanned.handle
    platformFromHandle = scanned.platform
  }
  if (!handle && fromUrl.handle) {
    handle = fromUrl.handle
    platformFromHandle = fromUrl.platform
  }
  if (!handle && displayName) {
    handle = slugifyName(displayName)
  }

  if (!handle) {
    throw new Error(
      'Missing handle (need handle, username, profile URL, or display name)'
    )
  }

  // Resolve platform: explicit column > detected from URL or @-handle > default.
  const platformInput = get('platform', 'network', 'channel', 'source_platform')
  let platform: string
  if (platformInput) {
    platform = platformInput.trim().toLowerCase()
  } else if (platformFromHandle) {
    platform = platformFromHandle
  } else {
    platform = DEFAULT_PLATFORM
  }

  if (!VALID_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported platform "${platform}" (must be instagram or tiktok)`)
  }

  const followerCount = parseCount(get('follower_count', 'followers', 'audience', 'follower'))
  const followingCount = parseCount(get('following_count', 'following'))
  const postCount = parseCount(get('post_count', 'posts', 'post'))
  const avgLikes = parseDecimal(get('avg_likes', 'average_likes', 'avg likes', 'likes'))
  const avgComments = parseDecimal(get('avg_comments', 'average_comments', 'avg comments', 'comments'))

  let engagementRate = parseEngagementRate(
    get('engagement_rate', 'engagement', 'engagement %', 'er')
  )
  if (
    engagementRate == null &&
    avgLikes != null &&
    avgComments != null &&
    followerCount &&
    followerCount > 0
  ) {
    engagementRate = (avgLikes + avgComments) / followerCount
  }

  return {
    handle,
    platform,
    display_name: displayName?.trim() || null,
    profile_url: profileUrlInput.trim() || null,
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

// Scans every cell in the row for a real handle. Three passes, most
// authoritative first:
//   1. URLs anywhere (instagram.com/foo, tiktok.com/@bar) — gives both
//      handle AND platform.
//   2. @-prefixed values anywhere — strong signal even without column name.
//   3. Bare-handle-shaped value in a column whose name suggests a handle
//      (handle / username / account / ig / instagram / tiktok / user /
//      profile, with word boundaries so "User Name" matches but "Bigger"
//      doesn't).
// Anything not caught by these three falls through to the explicit column
// alias lookup, the profile_url extraction, or display-name slugification.
const HANDLE_COL_PATTERN = /(^|[^a-z])(handle|username|account|ig|instagram|tiktok|user|profile)([^a-z]|$)/i
const HANDLE_VALUE_PATTERN = /^@?[a-zA-Z0-9_.]{2,30}$/

function scanForHandle(raw: RawRow): { handle: string; platform: string } | null {
  // Pass 1: URLs.
  for (const v of Object.values(raw)) {
    const s = String(v ?? '').trim()
    if (!s) continue
    const ext = extractFromUrl(s)
    if (ext.handle && ext.platform) return { handle: ext.handle, platform: ext.platform }
  }
  // Pass 2: @-prefixed values.
  for (const v of Object.values(raw)) {
    const s = String(v ?? '').trim()
    if (!s.startsWith('@')) continue
    const cleaned = s.slice(1).trim()
    if (/^[a-zA-Z0-9_.]{1,30}$/.test(cleaned)) {
      return { handle: cleaned.toLowerCase(), platform: DEFAULT_PLATFORM }
    }
  }
  // Pass 3: bare-handle-shaped value in a handle-named column.
  for (const [k, v] of Object.entries(raw)) {
    if (!HANDLE_COL_PATTERN.test(k)) continue
    const s = String(v ?? '').trim()
    if (!s) continue
    if (!HANDLE_VALUE_PATTERN.test(s)) continue
    return { handle: s.replace(/^@/, '').toLowerCase(), platform: DEFAULT_PLATFORM }
  }
  return null
}

// "Pat Flynn" → "patflynn"
// "Camille Adrian (Modern Millie)" → "camilleadrian"
// "MrBeast" → "mrbeast"
// Drops anything in parens (typically a stage name annotation), lowercases,
// strips non-alphanumeric. Returns null on empty input or empty result.
function slugifyName(name: string): string | null {
  if (!name) return null
  const beforeParen = name.split('(')[0]
  const slug = beforeParen.toLowerCase().replace(/[^a-z0-9]/g, '')
  return slug || null
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// Looks up the first key from the row that has a non-empty string value.
// Strips ALL non-alphanumerics on both sides before comparing so "IG
// Username", "ig_username", "ig-username", and "IGUsername" all collapse
// to the same key. Aliases passed in can use whatever readable form.
function firstString(row: RawRow, keys: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const lookup = new Map<string, unknown>()
  for (const [k, v] of Object.entries(row)) {
    lookup.set(norm(k), v)
  }
  for (const k of keys) {
    const v = lookup.get(norm(k))
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
