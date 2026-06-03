/**
 * Discovery API client — production-only.
 *
 * Hits the FastAPI backend directly. No fallback, no demo data. If the
 * backend is unreachable, callers see the raw error and the UI surfaces it.
 *
 * Configure the base URL via:
 *   - VITE_DISCOVER_API_BASE   (e.g. https://api.stanwith.com/api)
 *   - or leave unset to use the Vite dev proxy at /api
 *
 * Programs:
 *   - 'club_stanley'  → emerging social-media coaches incubator (user_id=1)
 *   - 'ambassador'    → Stanley Ambassador channel-operators (user_id=2)
 *
 * Both programs share the schema; the backend dispatches different prompts
 * + ICP defaults based on DiscoverySettings.program for the matching user.
 */

const ENV_API_BASE = import.meta.env.VITE_DISCOVER_API_BASE as string | undefined
const API_BASE = (ENV_API_BASE ?? '/api').replace(/\/$/, '')

export type Program = 'club_stanley' | 'ambassador'

export const PROGRAMS: Record<Program, { id: number; label: string; slug: string }> = {
  club_stanley: { id: 1, label: 'Club Stanley', slug: 'club-stanley' },
  ambassador: { id: 2, label: 'Stanley Ambassadors', slug: 'ambassadors' },
}

// Kept for backward compatibility with any caller still importing this.
// New code should read `PROGRAMS[program].id` instead.
export const DISCOVER_USER_ID = PROGRAMS.club_stanley.id

export type CandidateStatus = 'pending' | 'approved' | 'rejected' | 'duplicate' | 'errored'

export type DiscoverCandidate = {
  id: number
  handle: string
  display_name: string | null
  biography: string | null
  follower_count: number | null
  engagement_rate: number | null
  avg_views: number | null
  last_post_at: string | null

  posts_per_week: number | null
  like_to_comment_ratio: number | null
  ad_density: number | null
  country_guess: string | null
  timezone_bucket: string | null
  talking_head_signal: number | null
  bio_quality_signal: number | null
  comment_quality_signal: number | null
  is_outlier_flagged: boolean
  green_flags: string[] | null
  red_flags: string[] | null

  discovered_via: string
  discovery_seed: string | null
  data_source: string | null

  score_fit: number | null
  score_engagement: number | null
  score_audience: number | null
  score_recency: number | null
  score_overall: number | null
  score_reasoning: string | null
  status: CandidateStatus
  is_shortlisted: boolean
  shortlisted_at: string | null
  first_seen_at: string
}

export type DiscoverRun = {
  id: number
  status: string
  sources_used: string[] | null
  raw_count: number
  deduped_count: number
  hydrated_count: number
  scored_count: number
  started_at: string
  completed_at: string | null
  error_message: string | null
}

export type DiscoverSettings = {
  icp_description: string
  hashtag_seeds: string[] | null
  brand_account_seeds: string[] | null
  competitor_handle_seeds: string[] | null
  follower_min: number
  follower_max: number
  min_engagement_rate: number
  allow_sub_floor_outliers: boolean
  preferred_geo_tags: string[] | null
  deprioritized_geo_tags: string[] | null
  candidates_per_source: number
  digest_size: number
}

async function call<T>(path: string, init: RequestInit | undefined, userId: number): Promise<T> {
  const url = `${API_BASE}/users/${userId}/discover${path}`
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch (e) {
    throw new Error(
      `Network error reaching ${url} — is the FastAPI backend running? (${e instanceof Error ? e.message : String(e)})`
    )
  }
  if (!res.ok) {
    throw new Error(await formatHttpError(res, url))
  }
  return res.json() as Promise<T>
}

/**
 * FastAPI returns `{detail: "..."}` for HTTPException and
 * `{detail: [{loc, msg, type, ...}, ...]}` for validation errors. Both used
 * to render as "[object Object]" because `new Error(arrayOrObject)` coerces
 * via Object.prototype.toString. This produces a human-readable single line.
 */
async function formatHttpError(res: Response, url: string): Promise<string> {
  const fallback = `${res.status} ${res.statusText} · ${url}`
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return fallback
  }
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return `${res.status}: ${detail}`
    if (Array.isArray(detail)) {
      const lines = detail.map((d) => {
        if (d && typeof d === 'object') {
          const obj = d as Record<string, unknown>
          const loc = Array.isArray(obj.loc) ? obj.loc.join('.') : ''
          const msg = obj.msg ?? obj.message ?? JSON.stringify(d)
          return loc ? `${loc}: ${msg}` : String(msg)
        }
        return String(d)
      })
      return `${res.status}: ${lines.join(' · ')}`
    }
    if (detail) return `${res.status}: ${JSON.stringify(detail)}`
  }
  return fallback
}

export type DiscoverApi = ReturnType<typeof createDiscoverApi>

export function createDiscoverApi(program: Program) {
  const userId = PROGRAMS[program].id
  const c = <T,>(path: string, init?: RequestInit) => call<T>(path, init, userId)
  return {
    program,
    userId,

    run: (opts: { useScrapers?: boolean; perSourceLimit?: number | null; runSync?: boolean } = {}) =>
      c<DiscoverRun>('/run', {
        method: 'POST',
        body: JSON.stringify({
          use_scrapers: opts.useScrapers ?? true,
          per_source_limit: opts.perSourceLimit ?? null,
          run_sync: opts.runSync ?? true,
        }),
      }),

    listRuns: (limit = 10) => c<DiscoverRun[]>(`/runs?limit=${limit}`),

    listCandidates: (
      opts: {
        status?: 'pending' | 'approved' | 'rejected' | 'all'
        minScore?: number
        limit?: number
        shortlisted?: boolean
      } = {}
    ) => {
      const params = new URLSearchParams({
        status: opts.status ?? 'pending',
        min_score: String(opts.minScore ?? 0),
        limit: String(opts.limit ?? 100),
      })
      if (typeof opts.shortlisted === 'boolean') {
        params.set('shortlisted', String(opts.shortlisted))
      }
      return c<DiscoverCandidate[]>(`/candidates?${params}`)
    },

    approve: (candidateId: number) =>
      c<DiscoverCandidate>(`/candidates/${candidateId}/approve`, { method: 'POST' }),

    reject: (candidateId: number) =>
      c<DiscoverCandidate>(`/candidates/${candidateId}/reject`, { method: 'POST' }),

    shortlist: (candidateId: number) =>
      c<DiscoverCandidate>(`/candidates/${candidateId}/shortlist`, { method: 'POST' }),

    unshortlist: (candidateId: number) =>
      c<DiscoverCandidate>(`/candidates/${candidateId}/shortlist`, { method: 'DELETE' }),

    listShortlist: (limit = 500) =>
      c<DiscoverCandidate[]>(
        `/candidates?status=all&min_score=0&shortlisted=true&limit=${limit}`
      ),

    getSettings: () => c<DiscoverSettings>('/settings'),

    updateSettings: (patch: Partial<DiscoverSettings>) =>
      c<DiscoverSettings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  }
}

// Default export: Club Stanley client (preserves existing call sites).
export const discoverApi = createDiscoverApi('club_stanley')
