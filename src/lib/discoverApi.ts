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
  const res = await fetch(`${API_BASE}/users/${DISCOVER_USER_ID}/discover${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.detail ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
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
    opts: { status?: 'pending' | 'approved' | 'rejected' | 'all'; minScore?: number; limit?: number } = {}
  ) => {
    const params = new URLSearchParams({
      status: opts.status ?? 'pending',
      min_score: String(opts.minScore ?? 0),
      limit: String(opts.limit ?? 100),
    })
    return call<DiscoverCandidate[]>(`/candidates?${params}`)
  },

  approve: (candidateId: number) =>
    call<DiscoverCandidate>(`/candidates/${candidateId}/approve`, { method: 'POST' }),

  reject: (candidateId: number) =>
    call<DiscoverCandidate>(`/candidates/${candidateId}/reject`, { method: 'POST' }),

  getSettings: () => call<DiscoverSettings>('/settings'),

  updateSettings: (patch: Partial<DiscoverSettings>) =>
    call<DiscoverSettings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
}
