/**
 * Automated Sourcing — pipeline metrics dashboard.
 *
 * Shows how many Creators we're actually getting out of the automated scrape
 * so we can decide whether to scale the sourcing budget. Pulls from the same
 * discoverApi the /discover page uses (live FastAPI or local demo), so it
 * works on Vercel with zero backend config.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  ArrowUpRight,
  Clock,
  Filter,
  Globe2,
  Loader2,
  Radar,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
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
  discoverApi,
  type DiscoverCandidate,
  type DiscoverRun,
} from '@/lib/discoverApi'
import { trackedApi, type TrackedCreator } from '@/lib/trackedApi'
import { cn } from '@/lib/utils'

// LLM cost / projection assumptions, kept honest and conservative.
const LLM_COST_PER_CANDIDATE_USD = 0.012 // ~3¢ per scored Creator with cheap model
const HIGH_FIT_THRESHOLD = 80
const PARTNER_VALUE_USD = 500 // assumed value of one closed Creator partnership
const PARTNER_CONVERSION = 0.1 // assume 1 in 10 high-fit Creators converts

export default function SourcingPage() {
  const [candidates, setCandidates] = useState<DiscoverCandidate[] | null>(null)
  const [runs, setRuns] = useState<DiscoverRun[] | null>(null)
  const [tracked, setTracked] = useState<TrackedCreator[] | null>(null)
  const [running, setRunning] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, runHistory, trackedList] = await Promise.all([
        discoverApi.listCandidates({ status: 'all', minScore: 0, limit: 1000 }),
        discoverApi.listRuns(50),
        trackedApi.list().catch(() => [] as TrackedCreator[]),
      ])
      setCandidates(list)
      setRuns(runHistory)
      setTracked(trackedList)
      setLoadError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLoadError(msg)
      setCandidates([])
      setRuns([])
      setTracked([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function runDiscovery() {
    setRunning(true)
    try {
      const run = await discoverApi.run({ useScrapers: true, runSync: true })
      toast.success(
        `Sourced ${run.scored_count} new Creator${run.scored_count === 1 ? '' : 's'}.`
      )
      await load()
    } catch (e) {
      toast.error(
        `Discovery failed: ${e instanceof Error ? e.message : String(e)}`
      )
    } finally {
      setRunning(false)
    }
  }

  const metrics = useMemo(() => {
    if (!candidates || !runs || !tracked) return null
    return computeMetrics(candidates, runs, tracked)
  }, [candidates, runs, tracked])

  if (!metrics) {
    return (
      <main className="grid min-h-[60vh] place-items-center">
        {loadError ? (
          <BackendDown message={loadError} onRetry={load} />
        ) : (
          <Loader2 className="size-5 animate-spin text-paper-mute" />
        )}
      </main>
    )
  }

  const m = metrics
  return (
    <main className="px-8 py-12">
      <div className="mx-auto max-w-6xl space-y-12">
        {loadError && (
          <div className="rounded-sm border border-danger/40 bg-danger/[0.06] px-4 py-3">
            <p className="smallcaps text-danger">Backend unreachable</p>
            <p className="mt-1 font-mono text-xs text-paper">{loadError}</p>
          </div>
        )}
        <SourcingHeader
          totalRuns={runs?.length ?? 0}
          totalScored={m.lifetime.scored}
          running={running}
          onRun={runDiscovery}
        />

        <KpiRow m={m} />

        <FunnelSection m={m} />

        <ActivitySection runs={runs ?? []} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ScoreDistribution candidates={candidates ?? []} />
          <GeoMix candidates={candidates ?? []} />
        </div>

        <SourcesSection candidates={candidates ?? []} />

        <RecentRuns runs={(runs ?? []).slice(0, 8)} />

        <LeadershipCard m={m} />
      </div>
    </main>
  )
}

// ─── Header ────────────────────────────────────────────────────────────────

function SourcingHeader({
  totalRuns,
  totalScored,
  running,
  onRun,
}: {
  totalRuns: number
  totalScored: number
  running: boolean
  onRun: () => void
}) {
  return (
    <header className="space-y-4 border-b border-ink-3 pb-6">
      <div className="flex items-center justify-between gap-4">
        <nav className="flex items-center gap-1 font-mono text-xs text-paper-mute">
          <NavLink to="/discover" className="hover:text-paper">
            Discover
          </NavLink>
          <span>/</span>
          <span className="text-paper">Sourcing</span>
          <span>/</span>
          <NavLink to="/tracked" className="hover:text-paper">
            Tracked
          </NavLink>
        </nav>
        <Button
          type="button"
          onClick={onRun}
          disabled={running}
          className="smallcaps bg-lime text-lime-ink hover:bg-lime/90"
        >
          {running ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Sourcing
            </>
          ) : (
            <>
              <Sparkles className="mr-2 size-4" />
              Run discovery
            </>
          )}
        </Button>
      </div>
      <div className="flex items-end justify-between gap-6">
        <div className="space-y-2">
          <p className="smallcaps text-paper-mute">Automated sourcing</p>
          <h1 className="font-display text-4xl text-paper sm:text-5xl">
            Pipeline metrics.
          </h1>
          <p className="font-mono text-xs text-paper-mute">
            {totalRuns} runs · {totalScored.toLocaleString()} Creators sourced ·
            14-day window
          </p>
        </div>
      </div>
    </header>
  )
}

function BackendDown({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="max-w-md rounded-sm border border-danger/40 bg-danger/[0.06] p-6 text-center">
      <p className="smallcaps text-danger">Backend unreachable</p>
      <p className="mt-2 font-mono text-xs text-paper">{message}</p>
      <Button
        type="button"
        onClick={onRetry}
        variant="outline"
        size="sm"
        className="smallcaps mt-4"
      >
        Try again
      </Button>
    </div>
  )
}

// ─── KPI row ───────────────────────────────────────────────────────────────

function KpiRow({ m }: { m: Metrics }) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        icon={<Users className="size-4" />}
        label="Sourced"
        value={m.lifetime.scored.toLocaleString()}
        delta={m.deltas.scored}
        hint="creators · all time"
      />
      <KpiCard
        icon={<Target className="size-4" />}
        label="High fit ≥ 80"
        value={m.lifetime.highFit.toLocaleString()}
        delta={m.deltas.highFit}
        hint={`${m.lifetime.highFitRate.toFixed(0)}% of scored`}
      />
      <KpiCard
        icon={<Radar className="size-4" />}
        label="Runs this week"
        value={m.lifetime.runsLast7d.toLocaleString()}
        delta={m.deltas.runs}
        hint="last 7 days"
      />
      <KpiCard
        icon={<Users className="size-4" />}
        label="Tracked"
        value={m.lifetime.tracked.toLocaleString()}
        delta={null}
        hint="now in the velocity-alerts pipeline"
        accent
      />
    </section>
  )
}

function KpiCard({
  icon,
  label,
  value,
  delta,
  hint,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  delta: number | null
  hint: string
  accent?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-sm border bg-ink-2 p-5',
        accent ? 'border-lime/40' : 'border-ink-3'
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-paper-mute">
          {icon}
          <p className="smallcaps">{label}</p>
        </div>
        <DeltaPill delta={delta} />
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
    </div>
  )
}

function DeltaPill({ delta }: { delta: number | null }) {
  if (delta == null) return null
  if (delta === 0)
    return (
      <span className="font-mono text-[10px] text-paper-mute">no change</span>
    )
  const positive = delta > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-mono text-[11px] tabular-nums',
        positive ? 'text-success' : 'text-danger'
      )}
    >
      <ArrowUpRight
        className={cn('size-3', positive ? '' : 'rotate-90')}
      />
      {positive ? '+' : ''}
      {delta}
      <span className="ml-1 text-paper-mute">vs 7d prior</span>
    </span>
  )
}

// ─── Funnel ────────────────────────────────────────────────────────────────

function FunnelSection({ m }: { m: Metrics }) {
  const max = Math.max(
    m.lifetime.raw,
    m.lifetime.deduped,
    m.lifetime.hydrated,
    m.lifetime.scored,
    1
  )
  const rows: { label: string; value: number; sub: string; color: string }[] = [
    {
      label: 'Raw scraped',
      value: m.lifetime.raw,
      sub: 'across all sources',
      color: 'bg-paper-mute/30',
    },
    {
      label: 'After dedupe',
      value: m.lifetime.deduped,
      sub: pct(m.lifetime.deduped, m.lifetime.raw, 'of raw'),
      color: 'bg-paper-mute/50',
    },
    {
      label: 'Hydrated',
      value: m.lifetime.hydrated,
      sub: pct(m.lifetime.hydrated, m.lifetime.raw, 'of raw'),
      color: 'bg-paper-mute/70',
    },
    {
      label: 'Scored',
      value: m.lifetime.scored,
      sub: pct(m.lifetime.scored, m.lifetime.raw, 'of raw'),
      color: 'bg-paper',
    },
    {
      label: `High fit ≥${HIGH_FIT_THRESHOLD}`,
      value: m.lifetime.highFit,
      sub: pct(m.lifetime.highFit, m.lifetime.scored, 'of scored'),
      color: 'bg-lime',
    },
    {
      label: 'Approved',
      value: m.lifetime.approved,
      sub: pct(m.lifetime.approved, m.lifetime.highFit, 'of high fit'),
      color: 'bg-lime',
    },
    {
      label: 'Tracked (live)',
      value: m.lifetime.tracked,
      sub: pct(m.lifetime.tracked, m.lifetime.approved, 'of approved'),
      color: 'bg-success',
    },
  ]

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl text-paper">Funnel — lifetime</h2>
        <p className="font-mono text-[11px] text-paper-mute">
          Where Creators drop off across the pipeline
        </p>
      </div>
      <div className="space-y-3 rounded-sm border border-ink-3 bg-ink-2 p-6">
        {rows.map((r) => (
          <FunnelBar key={r.label} {...r} max={max} />
        ))}
      </div>
    </section>
  )
}

function FunnelBar({
  label,
  value,
  sub,
  color,
  max,
}: {
  label: string
  value: number
  sub: string
  color: string
  max: number
}) {
  const widthPct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <p className="smallcaps text-paper">{label}</p>
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs text-paper-mute">{sub}</span>
          <span className="font-mono text-base tabular-nums text-paper">
            {value.toLocaleString()}
          </span>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-sm bg-ink-3">
        <div
          className={cn('h-full transition-all', color)}
          style={{ width: `${Math.max(2, widthPct)}%` }}
        />
      </div>
    </div>
  )
}

// ─── Activity chart ────────────────────────────────────────────────────────

function ActivitySection({ runs }: { runs: DiscoverRun[] }) {
  const days = 14
  const today = startOfDay(new Date())
  const buckets: { date: Date; scored: number; runs: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    buckets.push({ date: d, scored: 0, runs: 0 })
  }
  for (const run of runs) {
    const d = startOfDay(new Date(run.started_at))
    const idx = buckets.findIndex((b) => b.date.getTime() === d.getTime())
    if (idx >= 0) {
      buckets[idx].scored += run.scored_count
      buckets[idx].runs += 1
    }
  }
  const max = Math.max(...buckets.map((b) => b.scored), 1)
  const total = buckets.reduce((s, b) => s + b.scored, 0)

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl text-paper">
          Activity — last 14 days
        </h2>
        <p className="font-mono text-[11px] text-paper-mute">
          {total.toLocaleString()} creators sourced
        </p>
      </div>
      <div className="rounded-sm border border-ink-3 bg-ink-2 p-6">
        <div className="flex h-44 items-end gap-2">
          {buckets.map((b, i) => {
            const h = max > 0 ? (b.scored / max) * 100 : 0
            const isWeekend = b.date.getDay() === 0 || b.date.getDay() === 6
            return (
              <div
                key={i}
                className="group relative flex flex-1 flex-col items-center gap-2"
              >
                <div className="relative flex h-full w-full items-end">
                  <div
                    className={cn(
                      'w-full rounded-sm transition-all',
                      b.scored > 0
                        ? 'bg-lime hover:bg-lime/80'
                        : 'bg-ink-3 hover:bg-ink-3/80'
                    )}
                    style={{ height: `${Math.max(2, h)}%` }}
                    title={`${dayLabel(b.date)} · ${b.scored} scored · ${b.runs} run${b.runs === 1 ? '' : 's'}`}
                  />
                  <div
                    className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded-sm bg-ink-3 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-paper opacity-0 transition group-hover:opacity-100"
                  >
                    {b.scored}
                  </div>
                </div>
                <span
                  className={cn(
                    'font-mono text-[10px]',
                    isWeekend ? 'text-paper-mute/60' : 'text-paper-mute'
                  )}
                >
                  {dayLabel(b.date).split(' ')[0]}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ─── Score distribution ───────────────────────────────────────────────────

function ScoreDistribution({ candidates }: { candidates: DiscoverCandidate[] }) {
  const buckets = [
    { label: '90 – 100', min: 90, max: 101, color: 'bg-lime' },
    { label: '80 – 89', min: 80, max: 90, color: 'bg-lime/70' },
    { label: '70 – 79', min: 70, max: 80, color: 'bg-paper' },
    { label: '60 – 69', min: 60, max: 70, color: 'bg-paper-mute/70' },
    { label: '< 60', min: 0, max: 60, color: 'bg-paper-mute/40' },
  ]
  const counts = buckets.map(
    (b) =>
      candidates.filter(
        (c) =>
          c.score_overall != null &&
          c.score_overall >= b.min &&
          c.score_overall < b.max
      ).length
  )
  const max = Math.max(...counts, 1)
  const total = counts.reduce((s, n) => s + n, 0)

  return (
    <PanelCard
      icon={<Filter className="size-4" />}
      title="Score distribution"
      subtitle={`${total} scored`}
    >
      <div className="space-y-2">
        {buckets.map((b, i) => {
          const v = counts[i]
          const widthPct = max > 0 ? (v / max) * 100 : 0
          return (
            <div key={b.label} className="space-y-1">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-mono text-paper">{b.label}</span>
                <span className="font-mono tabular-nums text-paper">{v}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-sm bg-ink-3">
                <div
                  className={cn('h-full', b.color)}
                  style={{ width: `${Math.max(2, widthPct)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </PanelCard>
  )
}

// ─── Geo mix ───────────────────────────────────────────────────────────────

function GeoMix({ candidates }: { candidates: DiscoverCandidate[] }) {
  const highFit = candidates.filter(
    (c) => c.score_overall != null && c.score_overall >= HIGH_FIT_THRESHOLD
  )
  const buckets = new Map<string, number>()
  for (const c of highFit) {
    const tz = c.timezone_bucket ?? 'Unknown'
    buckets.set(tz, (buckets.get(tz) ?? 0) + 1)
  }
  const rows = Array.from(buckets.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const max = Math.max(...rows.map(([, v]) => v), 1)

  return (
    <PanelCard
      icon={<Globe2 className="size-4" />}
      title="Geo mix"
      subtitle={`${highFit.length} high-fit creators`}
    >
      {rows.length === 0 ? (
        <p className="font-mono text-xs text-paper-mute">
          No high-fit creators yet.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map(([label, v]) => {
            const widthPct = max > 0 ? (v / max) * 100 : 0
            const isPriority =
              label === 'UK' || label === 'NORAM' || label === 'EMEA'
            return (
              <div key={label} className="space-y-1">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-mono text-paper">
                    {label}
                    {isPriority && (
                      <span className="ml-2 text-[10px] text-lime">
                        ◉ priority
                      </span>
                    )}
                  </span>
                  <span className="font-mono tabular-nums text-paper">{v}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-sm bg-ink-3">
                  <div
                    className={cn(
                      'h-full',
                      isPriority ? 'bg-lime' : 'bg-paper-mute/50'
                    )}
                    style={{ width: `${Math.max(2, widthPct)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </PanelCard>
  )
}

// ─── Source mix ────────────────────────────────────────────────────────────

function SourcesSection({ candidates }: { candidates: DiscoverCandidate[] }) {
  const counts = new Map<string, { total: number; highFit: number }>()
  for (const c of candidates) {
    const k = sourceLabel(c.discovered_via)
    const cur = counts.get(k) ?? { total: 0, highFit: 0 }
    cur.total += 1
    if ((c.score_overall ?? 0) >= HIGH_FIT_THRESHOLD) cur.highFit += 1
    counts.set(k, cur)
  }
  const rows = Array.from(counts.entries()).sort(
    (a, b) => b[1].highFit - a[1].highFit
  )

  if (rows.length === 0) return null

  const totalAll = rows.reduce((s, [, v]) => s + v.total, 0)

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl text-paper">
          Which sources are worth the spend?
        </h2>
        <p className="font-mono text-[11px] text-paper-mute">
          Hit rate = high-fit ÷ total
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {rows.slice(0, 4).map(([label, v]) => {
          const hitRate = v.total > 0 ? (v.highFit / v.total) * 100 : 0
          const share = totalAll > 0 ? (v.total / totalAll) * 100 : 0
          return (
            <div
              key={label}
              className="rounded-sm border border-ink-3 bg-ink-2 p-5"
            >
              <p className="smallcaps text-paper-mute">{label}</p>
              <p className="mt-3 font-display text-3xl tabular-nums text-paper">
                {hitRate.toFixed(0)}%
              </p>
              <p className="mt-1 font-mono text-[11px] text-paper-mute">
                {v.highFit} high-fit · {v.total} total
              </p>
              <div className="mt-3 h-1 overflow-hidden rounded-sm bg-ink-3">
                <div
                  className="h-full bg-lime"
                  style={{ width: `${Math.max(4, share)}%` }}
                  title={`${share.toFixed(0)}% of total volume`}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Recent runs ───────────────────────────────────────────────────────────

function RecentRuns({ runs }: { runs: DiscoverRun[] }) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl text-paper">Recent runs</h2>
        <p className="font-mono text-[11px] text-paper-mute">
          {runs.length} most recent
        </p>
      </div>
      <div className="overflow-x-auto rounded-sm border border-ink-3">
        <Table>
          <TableHeader>
            <TableRow className="border-ink-3 hover:bg-transparent">
              <TableHead className="smallcaps text-paper-mute">When</TableHead>
              <TableHead className="smallcaps text-paper-mute">
                Sources
              </TableHead>
              <TableHead className="smallcaps text-paper-mute text-right">
                Raw
              </TableHead>
              <TableHead className="smallcaps text-paper-mute text-right">
                Deduped
              </TableHead>
              <TableHead className="smallcaps text-paper-mute text-right">
                Hydrated
              </TableHead>
              <TableHead className="smallcaps text-paper-mute text-right">
                Scored
              </TableHead>
              <TableHead className="smallcaps text-paper-mute text-right">
                Yield
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => {
              const yieldPct =
                r.raw_count > 0 ? (r.scored_count / r.raw_count) * 100 : 0
              return (
                <TableRow
                  key={r.id}
                  className="border-ink-3 hover:bg-ink-2"
                >
                  <TableCell className="py-3">
                    <div className="font-mono text-xs text-paper">
                      {relativeTime(r.started_at)}
                    </div>
                    <div className="font-mono text-[10px] text-paper-mute">
                      {new Date(r.started_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(r.sources_used ?? []).slice(0, 3).map((s) => (
                        <span
                          key={s}
                          className="rounded-sm border border-ink-3 px-1.5 py-0.5 font-mono text-[10px] text-paper-mute"
                        >
                          {sourceLabel(s)}
                        </span>
                      ))}
                      {(r.sources_used?.length ?? 0) > 3 && (
                        <span className="font-mono text-[10px] text-paper-mute">
                          +{(r.sources_used?.length ?? 0) - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-paper">
                    {r.raw_count}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-paper">
                    {r.deduped_count}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-paper">
                    {r.hydrated_count}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="score-badge">{r.scored_count}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-paper-mute">
                    {yieldPct.toFixed(0)}%
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

// ─── Leadership card (the "talk to the bosses" pitch) ─────────────────────

function LeadershipCard({ m }: { m: Metrics }) {
  // Use the actual weekly count, not the week-over-week delta.
  // Fall back to a 1/2-of-lifetime estimate if we don't have a full week yet.
  const weeklyHighFit =
    m.last7.highFit > 0
      ? m.last7.highFit
      : Math.max(1, Math.round(m.lifetime.highFit / 2))
  const projectedAt3x = weeklyHighFit * 3
  const llmSpendLifetime =
    m.lifetime.scored * LLM_COST_PER_CANDIDATE_USD
  const costPerHighFit =
    m.lifetime.highFit > 0
      ? llmSpendLifetime / m.lifetime.highFit
      : LLM_COST_PER_CANDIDATE_USD * 10
  const projectedPipelineValue =
    m.lifetime.highFit * PARTNER_CONVERSION * PARTNER_VALUE_USD

  return (
    <section className="rounded-sm border border-lime/40 bg-lime/[0.04] p-6 sm:p-8">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-lime" />
          <p className="smallcaps text-lime">Bring this upstairs</p>
        </div>
        <h2 className="font-display text-3xl text-paper">
          The case for scaling automated sourcing.
        </h2>
        <p className="max-w-2xl text-sm text-paper-mute">
          Numbers below are derived from your actual run history — LLM cost is
          modeled at ${LLM_COST_PER_CANDIDATE_USD.toFixed(3)} per scored
          Creator, and partnership value is assumed at $
          {PARTNER_VALUE_USD.toLocaleString()} with a{' '}
          {(PARTNER_CONVERSION * 100).toFixed(0)}% conversion of high-fit picks.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PitchStat
          icon={<Zap className="size-4" />}
          label="Cost per high-fit"
          value={`$${costPerHighFit.toFixed(2)}`}
          sub={`vs. ~$80–150 manual`}
        />
        <PitchStat
          icon={<Users className="size-4" />}
          label="Pipeline value"
          value={`$${formatCount(projectedPipelineValue)}`}
          sub={`from ${m.lifetime.highFit} high-fit picks`}
        />
        <PitchStat
          icon={<Clock className="size-4" />}
          label="Manual hours saved"
          value={`${Math.round(m.lifetime.scored * 0.25)}h`}
          sub={`~15 min/creator avoided`}
        />
        <PitchStat
          icon={<TrendingUp className="size-4" />}
          label="At 3× source budget"
          value={`~${projectedAt3x}/wk`}
          sub={`projected high-fit creators`}
          highlight
        />
      </div>
    </section>
  )
}

function PitchStat({
  icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-sm border bg-ink-2 p-4',
        highlight ? 'border-lime' : 'border-ink-3'
      )}
    >
      <div className="flex items-center gap-2 text-paper-mute">
        {icon}
        <p className="smallcaps">{label}</p>
      </div>
      <p
        className={cn(
          'mt-2 font-display text-3xl tabular-nums',
          highlight ? 'text-lime' : 'text-paper'
        )}
      >
        {value}
      </p>
      <p className="mt-1 font-mono text-[11px] text-paper-mute">{sub}</p>
    </div>
  )
}

// ─── Generic panel ─────────────────────────────────────────────────────────

function PanelCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-sm border border-ink-3 bg-ink-2 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-paper">
          {icon}
          <h3 className="font-display text-xl">{title}</h3>
        </div>
        {subtitle && (
          <p className="font-mono text-[11px] text-paper-mute">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  )
}

// ─── Metrics computation ──────────────────────────────────────────────────

type Metrics = {
  lifetime: {
    raw: number
    deduped: number
    hydrated: number
    scored: number
    highFit: number
    approved: number
    tracked: number
    highFitRate: number
    reach: number
    runsLast7d: number
  }
  last7: {
    scored: number
    highFit: number
  }
  deltas: {
    scored: number
    highFit: number
    runs: number
  }
}

function computeMetrics(
  candidates: DiscoverCandidate[],
  runs: DiscoverRun[],
  tracked: TrackedCreator[]
): Metrics {
  const totalRaw = runs.reduce((s, r) => s + r.raw_count, 0)
  const totalDedup = runs.reduce((s, r) => s + r.deduped_count, 0)
  const totalHydrated = runs.reduce((s, r) => s + r.hydrated_count, 0)
  const totalScored = runs.reduce((s, r) => s + r.scored_count, 0)

  const highFit = candidates.filter(
    (c) => (c.score_overall ?? 0) >= HIGH_FIT_THRESHOLD
  )
  const approved = candidates.filter((c) => c.status === 'approved').length
  const activeTracked = tracked.filter((t) => t.is_active).length
  const reach = activeTracked
    ? tracked
        .filter((t) => t.is_active)
        .reduce((s, t) => s + (t.follower_count ?? 0), 0)
    : highFit.reduce((s, c) => s + (c.follower_count ?? 0), 0)
  const highFitRate =
    totalScored > 0 ? (highFit.length / totalScored) * 100 : 0

  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const last7 = runs.filter(
    (r) => now - new Date(r.started_at).getTime() <= 7 * day
  )
  const prior7 = runs.filter((r) => {
    const t = now - new Date(r.started_at).getTime()
    return t > 7 * day && t <= 14 * day
  })
  const scoredLast7 = last7.reduce((s, r) => s + r.scored_count, 0)
  const scoredPrior7 = prior7.reduce((s, r) => s + r.scored_count, 0)

  // Approximate high-fit deltas using last-7 / prior-7 ratios of the lifetime
  // high-fit count, since per-run high-fit isn't tracked separately.
  const last7Share = totalScored > 0 ? scoredLast7 / totalScored : 0
  const prior7Share = totalScored > 0 ? scoredPrior7 / totalScored : 0
  const highFitLast7 = Math.round(highFit.length * last7Share)
  const highFitPrior7 = Math.round(highFit.length * prior7Share)

  return {
    lifetime: {
      raw: totalRaw,
      deduped: totalDedup,
      hydrated: totalHydrated,
      scored: totalScored,
      highFit: highFit.length,
      approved,
      tracked: activeTracked,
      highFitRate,
      reach,
      runsLast7d: last7.length,
    },
    last7: {
      scored: scoredLast7,
      highFit: highFitLast7,
    },
    deltas: {
      scored: scoredLast7 - scoredPrior7,
      highFit: highFitLast7 - highFitPrior7,
      runs: last7.length - prior7.length,
    },
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────

function pct(n: number, d: number, label: string): string {
  if (d <= 0) return '—'
  return `${((n / d) * 100).toFixed(0)}% ${label}`
}

function formatCount(n: number | null | undefined): string {
  if (n == null) return '–'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
  })
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

function sourceLabel(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/\bllm\b/i, 'LLM')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
