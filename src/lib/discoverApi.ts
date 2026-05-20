/**
 * Discovery API client — production-only.
 *
 * Hits the FastAPI backend directly. No fallback, no demo data. If the
 * backend is unreachable, callers see the raw error and the UI surfaces it.
 *
 * Configure the base URL via:
 *   - VITE_DISCOVER_API_BASE   (e.g. https://api.stanwith.com)
 *   - or leave unset to use the Vite dev proxy at /api
 */

const ENV_API_BASE = import.meta.env.VITE_DISCOVER_API_BASE as string | undefined
const API_BASE = (ENV_API_BASE ?? '/api').replace(/\/$/, '')

// Until auth is wired through, the single demo user owns everything.
export const DISCOVER_USER_ID = 1

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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}/users/${DISCOVER_USER_ID}/discover${path}`
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

export const discoverApi = {
  run: (opts: { useScrapers?: boolean; perSourceLimit?: number | null; runSync?: boolean } = {}) =>
    call<DiscoverRun>('/run', {
      method: 'POST',
      body: JSON.stringify({
        use_scrapers: opts.useScrapers ?? true,
        per_source_limit: opts.perSourceLimit ?? null,
        run_sync: opts.runSync ?? true,
      }),
    }),

  listRuns: (limit = 10) => call<DiscoverRun[]>(`/runs?limit=${limit}`),

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
    return call<DiscoverCandidate[]>(`/candidates?${params}`)
  },

  approve: (candidateId: number) =>
    call<DiscoverCandidate>(`/candidates/${candidateId}/approve`, { method: 'POST' }),

  reject: (candidateId: number) =>
    call<DiscoverCandidate>(`/candidates/${candidateId}/reject`, { method: 'POST' }),

  /** Pick a candidate for the Club Stanley cohort. */
  shortlist: (candidateId: number) =>
    call<DiscoverCandidate>(`/candidates/${candidateId}/shortlist`, { method: 'POST' }),

  /** Remove a candidate from the Club Stanley cohort. */
  unshortlist: (candidateId: number) =>
    call<DiscoverCandidate>(`/candidates/${candidateId}/shortlist`, { method: 'DELETE' }),

  /** All candidates currently shortlisted for Club Stanley (any status). */
  listShortlist: (limit = 500) =>
    call<DiscoverCandidate[]>(
      `/candidates?status=all&min_score=0&shortlisted=true&limit=${limit}`
    ),

  getSettings: () => call<DiscoverSettings>('/settings'),

  updateSettings: (patch: Partial<DiscoverSettings>) =>
    call<DiscoverSettings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
}
