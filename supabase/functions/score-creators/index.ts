// Vetly score-creators Edge Function
//
// JWT-authenticated. Pulls every Creator with score_overall IS NULL for the
// authenticated user, batches them into chunks of 5, and calls Gemini 2.5
// Flash once per chunk with a JSON response schema. Computes the weighted
// overall in TypeScript (0.40 fit + 0.25 engagement + 0.20 audience +
// 0.15 recency, rounded), writes score_* + ai_reasoning + scored_at, and
// clears scoring_error.
//
// Per-chunk failures (429 rate limit, 402 quota, JSON parse error, network
// error) write the message to creators.scoring_error and continue with the
// next chunk; one bad chunk never tanks the run. The user can retry by
// hitting the endpoint again, the function picks up wherever it left off
// because the unscored filter excludes anything score_overall is set on.
//
// Sequential, not parallel, so a single user's import doesn't blow through
// Gemini's free-tier 15 RPM limit. ~3 to 5 seconds per chunk = roughly one
// Creator per second of wall clock for free-tier users.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { GoogleGenerativeAI, SchemaType } from 'npm:@google/generative-ai@0.21.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')

const CHUNK_SIZE = 5
const MODEL = 'gemini-2.5-flash'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

// Per-chunk response schema. We ask the model to echo back each Creator's
// handle so we can match scores to inputs deterministically (Gemini sometimes
// reorders multi-item arrays).
const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    scores: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          handle: {
            type: SchemaType.STRING,
            description: 'Original handle, used to match score to input Creator',
          },
          fit: {
            type: SchemaType.INTEGER,
            description: '0 to 100. How well content and niche match the brand ICP.',
          },
          engagement: {
            type: SchemaType.INTEGER,
            description: '0 to 100. Quality of engagement rate relative to follower count.',
          },
          audience: {
            type: SchemaType.INTEGER,
            description: '0 to 100. Audience alignment with brand audience.',
          },
          recency: {
            type: SchemaType.INTEGER,
            description: '0 to 100. How active and recently posting they appear.',
          },
          reasoning: {
            type: SchemaType.STRING,
            description: '1 to 2 sentences explaining the overall pick.',
          },
        },
        required: ['handle', 'fit', 'engagement', 'audience', 'recency', 'reasoning'],
      },
    },
  },
  required: ['scores'],
}

type CreatorRow = {
  id: string
  handle: string
  platform: string
  display_name: string | null
  bio: string | null
  niche: string | null
  follower_count: number | null
  engagement_rate: number | null
  post_count: number | null
  avg_likes: number | null
  avg_comments: number | null
}

type Settings = {
  icp_description: string | null
  follower_min: number | null
  follower_max: number | null
  min_engagement_rate: number | null
}

type ScoreResult = {
  handle: string
  fit: number
  engagement: number
  audience: number
  recency: number
  reasoning: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!GEMINI_API_KEY) {
    return json(
      { error: 'GEMINI_API_KEY not set. Run `supabase secrets set GEMINI_API_KEY=...`.' },
      500
    )
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization' }, 401)

  // RLS-bound supabase client; we operate as the user, not the service role.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Invalid JWT' }, 401)
  const userId = userData.user.id

  // Pull settings.
  const { data: settings, error: settingsErr } = await supabase
    .from('user_settings')
    .select('icp_description, follower_min, follower_max, min_engagement_rate')
    .eq('user_id', userId)
    .single<Settings>()

  if (settingsErr || !settings) {
    return json({ error: settingsErr?.message ?? 'Could not load settings' }, 500)
  }
  if (!settings.icp_description?.trim()) {
    return json(
      { error: 'ICP description is empty. Fill it in /settings before scoring.' },
      400
    )
  }

  // Pull unscored Creators. Includes ones with a previous scoring_error since
  // those are also unscored; on success we clear the error.
  const { data: unscored, error: unscoredErr } = await supabase
    .from('creators')
    .select(
      'id, handle, platform, display_name, bio, niche, follower_count, engagement_rate, post_count, avg_likes, avg_comments'
    )
    .is('score_overall', null)
    .order('created_at', { ascending: true })
    .returns<CreatorRow[]>()

  if (unscoredErr) return json({ error: unscoredErr.message }, 500)
  if (!unscored || unscored.length === 0) {
    return json({ scored: 0, errored: 0, total: 0 }, 200)
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      // deno-lint-ignore no-explicit-any
      responseSchema: RESPONSE_SCHEMA as any,
    },
  })

  let scored = 0
  let errored = 0

  for (let i = 0; i < unscored.length; i += CHUNK_SIZE) {
    const chunk = unscored.slice(i, i + CHUNK_SIZE)

    let chunkScores: ScoreResult[] | null = null
    let chunkError: string | null = null
    try {
      const prompt = buildPrompt(settings, chunk)
      const result = await model.generateContent(prompt)
      const text = result.response.text()
      const parsed = JSON.parse(text) as { scores: ScoreResult[] }
      if (!Array.isArray(parsed?.scores)) {
        throw new Error('Response missing scores array')
      }
      chunkScores = parsed.scores
    } catch (e) {
      chunkError = formatError(e)
    }

    if (chunkError) {
      // Mark every Creator in this chunk as errored, leave score_overall null
      // so it stays in the unscored pool for the next run.
      for (const c of chunk) {
        await supabase
          .from('creators')
          .update({ scoring_error: chunkError.slice(0, 500) })
          .eq('id', c.id)
        errored++
      }
      continue
    }

    // Match scores to inputs by handle (case-insensitive). Anything in the
    // chunk that didn't get a score back is marked errored, anything in the
    // response that doesn't match an input is silently dropped.
    const byHandle = new Map<string, ScoreResult>()
    for (const s of chunkScores!) {
      if (s?.handle) byHandle.set(String(s.handle).toLowerCase(), s)
    }

    for (const c of chunk) {
      const s = byHandle.get(c.handle.toLowerCase())
      if (!s) {
        await supabase
          .from('creators')
          .update({ scoring_error: 'No score returned for this Creator' })
          .eq('id', c.id)
        errored++
        continue
      }

      const fit = clampScore(s.fit)
      const engagement = clampScore(s.engagement)
      const audience = clampScore(s.audience)
      const recency = clampScore(s.recency)
      const overall = Math.round(
        0.40 * fit + 0.25 * engagement + 0.20 * audience + 0.15 * recency
      )

      const { error: updErr } = await supabase
        .from('creators')
        .update({
          score_fit: fit,
          score_engagement: engagement,
          score_audience: audience,
          score_recency: recency,
          score_overall: overall,
          ai_reasoning: s.reasoning ?? null,
          scored_at: new Date().toISOString(),
          scoring_error: null,
        })
        .eq('id', c.id)

      if (updErr) {
        errored++
        // Try to record the failure so the row isn't silently lost.
        await supabase
          .from('creators')
          .update({ scoring_error: `update failed: ${updErr.message}`.slice(0, 500) })
          .eq('id', c.id)
      } else {
        scored++
      }
    }
  }

  return json({ scored, errored, total: unscored.length }, 200)
})

// ─── prompt construction ─────────────────────────────────────────────────────

function buildPrompt(settings: Settings, chunk: CreatorRow[]): string {
  const followerMin = settings.follower_min ?? null
  const followerMax = settings.follower_max ?? null
  const minErPct =
    settings.min_engagement_rate != null
      ? `${(settings.min_engagement_rate * 100).toFixed(2)}%`
      : 'no minimum'

  return `You score Creators against an ICP for a brand. Be discriminating: reserve scores of 85 or above for true standouts, 70 to 84 for solid candidates, 50 to 69 for marginal fits, below 50 for clear misses.

Brand ICP:
${settings.icp_description}

Reference filters (use as signals, not absolute cutoffs):
- Followers: ${followerMin == null ? 'no minimum' : followerMin.toLocaleString()} to ${followerMax == null ? 'no maximum' : followerMax.toLocaleString()}
- Engagement rate: ${minErPct}

For each Creator, score on four 0-100 axes:
- fit: how closely their content and niche match the ICP
- engagement: quality of their engagement rate relative to follower count and category norms
- audience: how aligned their audience seems with the brand audience
- recency: how active and recently posting they appear

Then write 1 to 2 sentences of reasoning that explains the overall pick. Echo each Creator's handle in the response so order can be preserved.

Creators to score:
${chunk.map((c, i) => formatCreator(c, i + 1)).join('\n\n')}`
}

function formatCreator(c: CreatorRow, n: number): string {
  const parts: string[] = []
  parts.push(`${n}. handle: ${c.handle}${c.display_name ? ` (display name: ${c.display_name})` : ''}`)
  parts.push(`   platform: ${c.platform}`)
  if (c.bio) parts.push(`   bio: ${truncate(c.bio, 600)}`)
  if (c.niche) parts.push(`   niche: ${c.niche}`)
  if (c.follower_count != null) parts.push(`   followers: ${c.follower_count.toLocaleString()}`)
  if (c.engagement_rate != null) {
    parts.push(`   engagement_rate: ${(c.engagement_rate * 100).toFixed(2)}%`)
  }
  if (c.post_count != null) parts.push(`   posts: ${c.post_count.toLocaleString()}`)
  if (c.avg_likes != null) parts.push(`   avg_likes: ${Math.round(c.avg_likes).toLocaleString()}`)
  if (c.avg_comments != null) {
    parts.push(`   avg_comments: ${Math.round(c.avg_comments).toLocaleString()}`)
  }
  return parts.join('\n')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

function clampScore(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function formatError(e: unknown): string {
  if (e instanceof Error) {
    const msg = e.message ?? String(e)
    // Surface common Gemini error shapes with a friendlier label.
    if (/429|rate/i.test(msg)) return `rate limited: ${msg}`
    if (/402|quota|exceeded/i.test(msg)) return `quota exhausted: ${msg}`
    return msg
  }
  return String(e)
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}
