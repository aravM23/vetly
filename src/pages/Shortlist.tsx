/**
 * Shortlist — every candidate a reviewer hand-picked for the cohort.
 * Parameterized by program (Club Stanley or Stanley Ambassadors).
 *
 * Distinct from /tracked (which is the velocity-alerts pipeline). Shortlist is
 * the editorial decision: "this creator belongs in the cohort". You can
 * shortlist someone whether or not they're tracked, and you can untrack
 * someone you've already shortlisted without losing the pick.
 *
 * Data flow: GET /discover/candidates?shortlisted=true&status=all — backed by
 * the is_shortlisted column on CreatorCandidate. The Discover pages let you
 * toggle individual candidates in/out of this list.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  ArrowLeft,
  ExternalLink,
  Globe,
  Loader2,
  Radar,
  RefreshCcw,
  Star,
  Trophy,
  Users,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  PROGRAMS,
  createDiscoverApi,
  type DiscoverCandidate,
  type Program,
} from '@/lib/discoverApi'
import { cn } from '@/lib/utils'

const TARGET_COHORT_SIZE = 25 // editorial target — used for the progress bar.

type ShortlistProps = { program?: Program }

export default function ShortlistPage({ program = 'club_stanley' }: ShortlistProps) {
  const api = useMemo(() => createDiscoverApi(program), [program])
  const programInfo = PROGRAMS[program]
  const discoverPath = program === 'club_stanley' ? '/' : `/${programInfo.slug}`

  const [rows, setRows] = useState<DiscoverCandidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sourcedTotal, setSourcedTotal] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [shortlisted, allSourced] = await Promise.all([
        api.listShortlist(500),
        // Lifetime sourced — used for the "X of Y" conversion KPI.
        api.listCandidates({ status: 'all', minScore: 0, limit: 2000 }),
      ])
      setRows(shortlisted)
      setSourcedTotal(allSourced.length)
      setError(null)
    } catch (e) {
      setRows([])
      setSourcedTotal(0)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  async function remove(c: DiscoverCandidate) {
    const prev = rows
    setRows((r) => r?.filter((x) => x.id !== c.id) ?? null)
    try {
      await api.unshortlist(c.id)
      toast.success(`Removed @${c.handle} from ${programInfo.label}.`)
    } catch (e) {
      setRows(prev)
      toast.error(`Couldn't remove: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const stats = useMemo(() => {
    if (!rows) return null
    const reach = rows.reduce((s, c) => s + (c.follower_count ?? 0), 0)
    const erVals = rows
      .map((c) => c.engagement_rate)
      .filter((v): v is number => v != null)
    const avgEr = erVals.length
      ? erVals.reduce((s, v) => s + v, 0) / erVals.length
      : 0
    const priorityGeo = rows.filter(
      (c) =>
        c.timezone_bucket === 'NORAM' ||
        c.timezone_bucket === 'UK' ||
        c.timezone_bucket === 'EMEA'
    ).length
    const conversion =
      sourcedTotal && sourcedTotal > 0 ? rows.length / sourcedTotal : 0
    return {
      count: rows.length,
      reach,
      avgEr,
      priorityGeo,
      conversion,
      targetProgress: Math.min(1, rows.length / TARGET_COHORT_SIZE),
    }
  }, [rows, sourcedTotal])

  const grouped = useMemo(() => {
    if (!rows) return null
    const byTz = new Map<string, DiscoverCandidate[]>()
    for (const c of rows) {
      const key = c.timezone_bucket || 'UNKNOWN'
      const bucket = byTz.get(key) ?? []
      bucket.push(c)
      byTz.set(key, bucket)
    }
    return Array.from(byTz.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [rows])

  return (
    <main className="px-8 py-12">
      <div className="mx-auto max-w-6xl space-y-10">
        <Header
          count={stats?.count ?? 0}
          sourced={sourcedTotal ?? 0}
          refreshing={refreshing}
          onRefresh={refresh}
          programLabel={programInfo.label}
          discoverPath={discoverPath}
        />

        {stats && (
          <>
            <KpiRow stats={stats} sourcedTotal={sourcedTotal ?? 0} />
            <CompositionRow grouped={grouped ?? []} />
          </>
        )}

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !rows ? (
          <div className="grid min-h-[40vh] place-items-center">
            <Loader2 className="size-5 animate-spin text-paper-mute" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState discoverPath={discoverPath} programLabel={programInfo.label} />
        ) : (
          <ShortlistTable rows={rows} onRemove={remove} />
        )}
      </div>
    </main>
  )
}

// ─── Header ────────────────────────────────────────────────────────────────

function Header({
  count,
  sourced,
  refreshing,
  onRefresh,
  programLabel,
  discoverPath,
}: {
  count: number
  sourced: number
  refreshing: boolean
  onRefresh: () => void
  programLabel: string
  discoverPath: string
}) {
  const conv = sourced > 0 ? ((count / sourced) * 100).toFixed(1) : '0.0'
  return (
    <header className="space-y-4 border-b border-ink-3 pb-6">
      <div className="flex items-center justify-between gap-4">
        <nav className="flex items-center gap-1 font-mono text-xs text-paper-mute">
          <NavLink to={discoverPath} className="hover:text-paper">
            Discover
          </NavLink>
          <span>/</span>
          <span className="text-paper">{programLabel}</span>
        </nav>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
          className="smallcaps"
        >
          {refreshing ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Refreshing
            </>
          ) : (
            <>
              <RefreshCcw className="mr-2 size-4" />
              Refresh
            </>
          )}
        </Button>
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="smallcaps text-paper-mute">Editorial picks</p>
          <h1 className="font-display text-4xl text-paper sm:text-5xl">
            {programLabel} cohort.
          </h1>
          <p className="font-mono text-xs text-paper-mute">
            {count.toLocaleString()} shortlisted ·{' '}
            {sourced.toLocaleString()} sourced ·{' '}
            <span className="text-lime">{conv}%</span> conversion
          </p>
        </div>
        <NavLink to={discoverPath}>
          <Button
            type="button"
            className="smallcaps bg-lime text-lime-ink hover:bg-lime/90"
          >
            <Radar className="mr-2 size-4" />
            Source more creators
          </Button>
        </NavLink>
      </div>
    </header>
  )
}

// ─── KPI row ───────────────────────────────────────────────────────────────

function KpiRow({
  stats,
  sourcedTotal,
}: {
  stats: {
    count: number
    reach: number
    avgEr: number
    priorityGeo: number
    conversion: number
    targetProgress: number
  }
  sourcedTotal: number
}) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi
        icon={<Trophy className="size-4" />}
        label="In cohort"
        value={stats.count.toLocaleString()}
        hint={`target ${TARGET_COHORT_SIZE}`}
        progress={stats.targetProgress}
        accent
      />
      <Kpi
        icon={<Star className="size-4" />}
        label="Pick rate"
        value={`${(stats.conversion * 100).toFixed(1)}%`}
        hint={`${stats.count} of ${sourcedTotal} sourced`}
      />
      <Kpi
        icon={<Users className="size-4" />}
        label="Combined reach"
        value={formatCount(stats.reach)}
        hint="sum of followers"
      />
      <Kpi
        icon={<Globe className="size-4" />}
        label="Priority geo"
        value={stats.priorityGeo.toLocaleString()}
        hint="NORAM · UK · EMEA"
      />
    </section>
  )
}

function Kpi({
  icon,
  label,
  value,
  hint,
  progress,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
  progress?: number
  accent?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-sm border bg-ink-2 p-5',
        accent ? 'border-lime/40' : 'border-ink-3'
      )}
    >
      <div className="flex items-center gap-2 text-paper-mute">
        {icon}
        <p className="smallcaps">{label}</p>
      </div>
      <p
        className={cn(
          'mt-3 font-display text-5xl leading-none tabular-nums',
          accent ? 'text-lime' : 'text-paper'
        )}
      >
        {value}
      </p>
      <p className="mt-2 font-mono text-[11px] text-paper-mute">{hint}</p>
      {progress != null && (
        <div className="mt-3 h-1 overflow-hidden rounded-sm bg-ink-3">
          <div
            className="h-full bg-lime transition-all"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Composition (geo breakdown) ───────────────────────────────────────────

function CompositionRow({
  grouped,
}: {
  grouped: [string, DiscoverCandidate[]][]
}) {
  if (grouped.length === 0) return null
  const total = grouped.reduce((s, [, list]) => s + list.length, 0)
  return (
    <section className="space-y-3">
      <h2 className="smallcaps text-paper-mute">Cohort composition · by region</h2>
      <div className="rounded-sm border border-ink-3 bg-ink-2/40 p-5">
        <div className="flex h-2 overflow-hidden rounded-sm bg-ink-3">
          {grouped.map(([tz, list], i) => {
            const pct = (list.length / total) * 100
            return (
              <div
                key={tz}
                className={cn(
                  'h-full transition-all',
                  i === 0 ? 'bg-lime' : i === 1 ? 'bg-lime/60' : 'bg-lime/30'
                )}
                style={{ width: `${pct}%` }}
                title={`${tz}: ${list.length}`}
              />
            )
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] text-paper-mute">
          {grouped.map(([tz, list]) => (
            <span key={tz} className="flex items-center gap-2">
              <span className="size-2 rounded-sm bg-lime/70" />
              <span className="text-paper">{tz}</span>
              <span>{list.length.toLocaleString()}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Table ─────────────────────────────────────────────────────────────────

function ShortlistTable({
  rows,
  onRemove,
}: {
  rows: DiscoverCandidate[]
  onRemove: (c: DiscoverCandidate) => void
}) {
  // Sort: highest score first, then most recently shortlisted.
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const score = (b.score_overall ?? 0) - (a.score_overall ?? 0)
        if (score !== 0) return score
        const aT = a.shortlisted_at ? new Date(a.shortlisted_at).getTime() : 0
        const bT = b.shortlisted_at ? new Date(b.shortlisted_at).getTime() : 0
        return bT - aT
      }),
    [rows]
  )
  return (
    <section className="overflow-x-auto rounded-sm border border-ink-3">
      <Table>
        <TableHeader>
          <TableRow className="border-ink-3 hover:bg-transparent">
            <TableHead className="w-16 smallcaps text-paper-mute">Score</TableHead>
            <TableHead className="smallcaps text-paper-mute">Creator</TableHead>
            <TableHead className="smallcaps text-paper-mute">Bio</TableHead>
            <TableHead className="smallcaps text-paper-mute">Geo</TableHead>
            <TableHead className="smallcaps text-paper-mute text-right">
              Followers
            </TableHead>
            <TableHead className="smallcaps text-paper-mute text-right">
              ER
            </TableHead>
            <TableHead className="smallcaps text-paper-mute">Status</TableHead>
            <TableHead className="smallcaps text-paper-mute">Picked</TableHead>
            <TableHead className="smallcaps text-paper-mute text-right">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((c) => (
            <TableRow key={c.id} className="border-ink-3 hover:bg-ink-2">
              <TableCell>
                {c.score_overall != null ? (
                  <span className="score-badge">{c.score_overall}</span>
                ) : (
                  <span className="font-mono text-xs text-paper-mute">—</span>
                )}
              </TableCell>
              <TableCell className="py-2">
                <a
                  href={`https://instagram.com/${c.handle}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center gap-1 font-mono text-sm text-paper hover:text-lime"
                  title={`Open @${c.handle} on Instagram`}
                >
                  @{c.handle}
                  <ExternalLink className="size-3 opacity-0 transition group-hover:opacity-100" />
                </a>
                {c.display_name && (
                  <div className="text-xs text-paper-mute truncate max-w-[200px]">
                    {c.display_name}
                  </div>
                )}
              </TableCell>
              <TableCell className="max-w-[260px]">
                <p className="line-clamp-2 text-xs text-paper-mute">
                  {c.biography ?? '—'}
                </p>
              </TableCell>
              <TableCell>
                <GeoChip
                  country={c.country_guess}
                  timezone={c.timezone_bucket}
                />
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums text-paper">
                {formatCount(c.follower_count)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums text-paper">
                {formatPct(c.engagement_rate)}
              </TableCell>
              <TableCell>
                <StatusPill status={c.status} />
              </TableCell>
              <TableCell className="font-mono text-[11px] text-paper-mute">
                {c.shortlisted_at ? relativeTime(c.shortlisted_at) : '—'}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(c)}
                  className="smallcaps text-paper-mute hover:bg-danger/10 hover:text-danger"
                  title="Remove from cohort"
                >
                  <XCircle className="mr-1 size-3" />
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

// ─── Empty / error states ─────────────────────────────────────────────────

function EmptyState({
  discoverPath,
  programLabel,
}: {
  discoverPath: string
  programLabel: string
}) {
  return (
    <div className="rounded-sm border border-dashed border-ink-3 px-8 py-16 text-center">
      <Trophy className="mx-auto size-8 text-paper-mute" />
      <p className="smallcaps mt-4 text-paper-mute">No picks yet</p>
      <h2 className="mt-3 font-display text-3xl text-paper">
        Build out the {programLabel} cohort.
      </h2>
      <p className="mt-2 max-w-md mx-auto text-sm text-paper-mute">
        Head to the dashboard or Discover, browse sourced creators, and hit
        <span className="mx-1 inline-flex items-center gap-1 rounded-sm border border-lime/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-caps text-lime">
          <Star className="size-2.5" />
          Shortlist
        </span>
        on the ones who belong in {programLabel}.
      </p>
      <div className="mt-6 flex justify-center">
        <NavLink to={discoverPath}>
          <Button
            type="button"
            className="smallcaps bg-lime text-lime-ink hover:bg-lime/90"
          >
            <Radar className="mr-2 size-4" />
            Go to Discover
          </Button>
        </NavLink>
      </div>
    </div>
  )
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="rounded-sm border border-danger/40 bg-danger/[0.06] p-6">
      <p className="smallcaps text-danger">Couldn't reach the backend</p>
      <p className="mt-2 font-mono text-xs text-paper">{message}</p>
      <p className="mt-3 max-w-xl text-xs text-paper-mute">
        Make sure the FastAPI backend is running at{' '}
        <code className="font-mono text-paper">localhost:8000</code> or set{' '}
        <code className="font-mono text-paper">VITE_DISCOVER_API_BASE</code>{' '}
        to your deployed backend URL.
      </p>
      <Button
        type="button"
        onClick={onRetry}
        variant="outline"
        size="sm"
        className="smallcaps mt-4"
      >
        <ArrowLeft className="mr-2 size-4 rotate-180" />
        Try again
      </Button>
    </div>
  )
}

// ─── Bits ─────────────────────────────────────────────────────────────────

function GeoChip({
  country,
  timezone,
}: {
  country: string | null
  timezone: string | null
}) {
  if (!country && !timezone) {
    return <span className="font-mono text-[11px] text-paper-mute">—</span>
  }
  const label = timezone || country || '—'
  const tone =
    label === 'NORAM' || label === 'UK'
      ? 'border-success/40 text-success'
      : label === 'EMEA'
      ? 'border-lime/40 text-lime'
      : 'border-ink-3 text-paper-mute'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-caps',
        tone
      )}
      title={country ?? ''}
    >
      <Globe className="size-2.5" />
      {label}
    </span>
  )
}

function StatusPill({ status }: { status: DiscoverCandidate['status'] }) {
  const dot =
    status === 'approved'
      ? 'bg-success'
      : status === 'rejected'
      ? 'bg-danger'
      : status === 'duplicate'
      ? 'bg-lime'
      : status === 'errored'
      ? 'bg-danger'
      : 'bg-paper-mute'
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-caps text-paper-mute">
      <span className={cn('size-1.5 rounded-full', dot)} />
      {status}
    </span>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatCount(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return Math.round(n).toLocaleString()
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${(n * 100).toFixed(2)}%`
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}
