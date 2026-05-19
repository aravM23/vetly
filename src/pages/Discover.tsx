import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Radar,
  Sparkles,
  Star,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { NavLink } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
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
  getRuntimeMode,
  type DiscoverCandidate,
  type DiscoverRun,
  type DiscoverSettings,
} from '@/lib/discoverApi'
import { cn } from '@/lib/utils'

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all'

export default function DiscoverPage() {
  const [candidates, setCandidates] = useState<DiscoverCandidate[] | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<DiscoverRun | null>(null)
  const [settings, setSettings] = useState<DiscoverSettings | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100])
  const [mode, setMode] = useState<'live' | 'demo' | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, runs] = await Promise.all([
        discoverApi.listCandidates({ status: statusFilter, minScore: 0, limit: 200 }),
        discoverApi.listRuns(5),
      ])
      setCandidates(list)
      setLastRun(runs[0] ?? null)
      setMode(getRuntimeMode())
    } catch (e) {
      toast.error(`Couldn't load Creators: ${e instanceof Error ? e.message : String(e)}`)
      setCandidates([])
    }
  }, [statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    discoverApi.getSettings().then(setSettings).catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    if (!candidates) return []
    return candidates.filter((c) => {
      const s = c.score_overall
      if (s == null) {
        return scoreRange[0] === 0 && scoreRange[1] === 100
      }
      return s >= scoreRange[0] && s <= scoreRange[1]
    })
  }, [candidates, scoreRange])

  const counts = useMemo(() => {
    if (!candidates) return null
    return {
      total: candidates.length,
      avg: candidates.length
        ? Math.round(
            candidates.reduce((s, c) => s + (c.score_overall ?? 0), 0) /
              Math.max(1, candidates.filter((c) => c.score_overall != null).length)
          )
        : 0,
      outliers: candidates.filter((c) => c.is_outlier_flagged).length,
      greens: candidates.reduce((s, c) => s + (c.green_flags?.length ?? 0), 0),
    }
  }, [candidates])

  const selected = candidates?.find((c) => c.id === selectedId) ?? null

  async function runDiscovery() {
    setRunning(true)
    try {
      const run = await discoverApi.run({ useScrapers: true, runSync: true })
      toast.success(
        `Sourced ${run.scored_count} Creators across ${run.sources_used?.length ?? 0} source${run.sources_used?.length === 1 ? '' : 's'}.`
      )
      await load()
    } catch (e) {
      toast.error(`Discovery failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  async function approve(c: DiscoverCandidate) {
    const prev = candidates
    setCandidates((rows) => rows?.filter((r) => r.id !== c.id) ?? null)
    setSelectedId(null)
    try {
      await discoverApi.approve(c.id)
      toast.success(`Approved @${c.handle} — promoted to tracked Creator.`)
    } catch (e) {
      setCandidates(prev)
      toast.error(`Couldn't approve: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function reject(c: DiscoverCandidate) {
    const prev = candidates
    setCandidates((rows) => rows?.filter((r) => r.id !== c.id) ?? null)
    setSelectedId(null)
    try {
      await discoverApi.reject(c.id)
      toast.success(`Rejected @${c.handle}.`)
    } catch (e) {
      setCandidates(prev)
      toast.error(`Couldn't reject: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="min-h-screen">
      <DiscoverHeader mode={mode} />

      <main className="px-8 py-12">
        <div className="mx-auto max-w-6xl space-y-8">
          <header className="flex items-end justify-between gap-4 border-b border-ink-3 pb-6">
            <div className="space-y-2">
              <p className="smallcaps text-paper-mute">Club Stanley · cohort 2 sourcing</p>
              <h1 className="font-display text-4xl text-paper">Sourced today.</h1>
              {counts && (
                <p className="font-mono text-xs text-paper-mute">
                  {counts.total.toLocaleString()} {statusFilter},{' '}
                  <span className="text-paper">avg {counts.avg || '-'}</span>
                  {counts.outliers > 0 && (
                    <>
                      , <span className="text-lime">{counts.outliers} outliers</span>
                    </>
                  )}
                  {counts.greens > 0 && <>, {counts.greens} green flags</>}
                  {lastRun && (
                    <>
                      {' · last run '}
                      {timeAgo(lastRun.completed_at ?? lastRun.started_at)}
                    </>
                  )}
                </p>
              )}
            </div>
            <Button
              type="button"
              onClick={runDiscovery}
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
                  <Radar className="mr-2 size-4" />
                  Run discovery
                </>
              )}
            </Button>
          </header>

          {settings && (
            <section className="rounded-sm border border-ink-3 bg-ink-2/40 px-4 py-3">
              <p className="font-display text-base text-paper italic leading-relaxed">
                “{settings.icp_description}”
              </p>
              <p className="mt-3 font-mono text-[11px] text-paper-mute">
                {settings.follower_min.toLocaleString()}–{settings.follower_max.toLocaleString()} followers
                {settings.preferred_geo_tags?.length ? (
                  <> · prefer {settings.preferred_geo_tags.join(' / ')}</>
                ) : null}
                {settings.deprioritized_geo_tags?.length ? (
                  <> · deprio {settings.deprioritized_geo_tags.join(' / ')}</>
                ) : null}
                {' · '}
                {(settings.hashtag_seeds?.length ?? 0)} hashtag seeds,{' '}
                {(settings.brand_account_seeds?.length ?? 0)} brand seeds
              </p>
            </section>
          )}

          <section className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label className="smallcaps text-paper-mute">Status</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="w-44 bg-ink-2 border-ink-3 text-paper">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-2 min-w-64">
              <Label className="smallcaps text-paper-mute">
                Score range{' '}
                <span className="font-mono text-paper">
                  {scoreRange[0]} - {scoreRange[1]}
                </span>
              </Label>
              <Slider
                min={0}
                max={100}
                step={1}
                value={scoreRange}
                onValueChange={(v) => setScoreRange([v[0], v[1]] as [number, number])}
                className="py-2"
              />
            </div>
            <p className="font-mono text-xs text-paper-mute pb-2">
              {filtered.length.toLocaleString()} / {candidates?.length.toLocaleString() ?? '-'}
            </p>
          </section>

          {!candidates ? (
            <div className="grid min-h-[40vh] place-items-center">
              <Loader2 className="size-5 animate-spin text-paper-mute" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-sm border border-dashed border-ink-3 px-8 py-16 text-center">
              <p className="smallcaps text-paper-mute">Empty</p>
              <h2 className="mt-3 font-display text-3xl text-paper">
                No {statusFilter} Creators.
              </h2>
              <p className="mt-2 text-sm text-paper-mute">
                {statusFilter === 'pending'
                  ? 'Hit “Run discovery” to surface a fresh batch.'
                  : 'Switch the status filter to see other Creators.'}
              </p>
            </div>
          ) : (
            <section className="overflow-x-auto rounded-sm border border-ink-3">
              <Table>
                <TableHeader>
                  <TableRow className="border-ink-3 hover:bg-transparent">
                    <TableHead className="w-16 smallcaps text-paper-mute">Score</TableHead>
                    <TableHead className="smallcaps text-paper-mute">Handle</TableHead>
                    <TableHead className="smallcaps text-paper-mute text-right">Followers</TableHead>
                    <TableHead className="smallcaps text-paper-mute text-right">ER</TableHead>
                    <TableHead className="smallcaps text-paper-mute text-right">Posts/wk</TableHead>
                    <TableHead className="smallcaps text-paper-mute">Geo</TableHead>
                    <TableHead className="smallcaps text-paper-mute">Signal</TableHead>
                    <TableHead className="smallcaps text-paper-mute">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => {
                    const isSelected = c.id === selectedId
                    return (
                      <TableRow
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className={cn(
                          'cursor-pointer border-ink-3 hover:bg-ink-2',
                          isSelected && 'bg-ink-2 border-l-2 border-l-lime'
                        )}
                      >
                        <TableCell>
                          {c.score_overall != null ? (
                            <span className="score-badge">{c.score_overall}</span>
                          ) : (
                            <span className="font-mono text-xs text-paper-mute">-</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="flex items-center gap-2">
                            <a
                              href={`https://instagram.com/${c.handle}/`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title={`Open @${c.handle} on Instagram`}
                              className="group inline-flex items-center gap-1 font-mono text-sm text-paper hover:text-lime"
                            >
                              @{c.handle}
                              <ExternalLink className="size-3 opacity-0 transition group-hover:opacity-100" />
                            </a>
                            {c.is_outlier_flagged && (
                              <span
                                title="Sub-floor outlier — tapped-in audience"
                                className="inline-flex items-center gap-1 rounded-sm border border-lime/40 px-1.5 py-0.5 text-[10px] uppercase tracking-caps text-lime"
                              >
                                <Star className="size-2.5" fill="currentColor" />
                                Outlier
                              </span>
                            )}
                          </div>
                          {c.display_name && (
                            <div className="text-xs text-paper-mute">{c.display_name}</div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-paper text-right tabular-nums">
                          {formatCount(c.follower_count)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-paper text-right tabular-nums">
                          {formatPct(c.engagement_rate)}
                        </TableCell>
                        <TableCell className="text-right">
                          <CadenceCell value={c.posts_per_week} />
                        </TableCell>
                        <TableCell>
                          <GeoCell bucket={c.timezone_bucket} />
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-paper-mute">
                          {c.green_flags?.length || c.red_flags?.length ? (
                            <span>
                              {c.green_flags?.length ? (
                                <span className="text-success">+{c.green_flags.length}</span>
                              ) : null}
                              {c.green_flags?.length && c.red_flags?.length ? ' / ' : ''}
                              {c.red_flags?.length ? (
                                <span className="text-danger">−{c.red_flags.length}</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-paper-mute">-</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-paper-mute">
                          {c.discovered_via.replace(/_/g, ' ')}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </section>
          )}
        </div>

        <Sheet
          open={selected != null}
          onOpenChange={(open) => {
            if (!open) setSelectedId(null)
          }}
        >
          <SheetContent className="w-full max-w-xl border-l border-ink-3 bg-ink-2 text-paper sm:max-w-xl overflow-y-auto">
            {selected && (
              <CandidateDrawer
                candidate={selected}
                onApprove={() => approve(selected)}
                onReject={() => reject(selected)}
              />
            )}
          </SheetContent>
        </Sheet>
      </main>
    </div>
  )
}

// ─── Header (matches Vetly's AppHeader visually, but stays auth-free) ──────

function DiscoverHeader({ mode }: { mode: 'live' | 'demo' | null }) {
  const links = [
    { to: '/', label: 'Dashboard' },
    { to: '/import', label: 'Import' },
    { to: '/discover', label: 'Discover' },
    { to: '/digest', label: 'Digest' },
    { to: '/settings', label: 'Settings' },
  ]
  return (
    <header className="border-b border-ink-3">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-8 py-4">
        <div className="flex items-center gap-8">
          <p className="font-display text-xl text-paper">Vetly</p>
          <nav className="flex items-center gap-1">
            {links.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'smallcaps px-3 py-1.5 transition',
                    isActive ? 'text-paper' : 'text-paper-mute hover:text-paper'
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <ModeChip mode={mode} />
      </div>
    </header>
  )
}

function ModeChip({ mode }: { mode: 'live' | 'demo' | null }) {
  if (mode === null) return null
  const isLive = mode === 'live'
  const dot = isLive ? 'bg-success' : 'bg-lime'
  const label = isLive ? 'live · user #1' : 'demo mode'
  return (
    <span
      title={
        isLive
          ? 'Backend reachable — calls hit FastAPI + OpenRouter.'
          : 'Self-contained demo dataset (no backend configured). Approvals are saved to localStorage. Set VITE_DISCOVER_API_BASE to point at your backend to go live.'
      }
      className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-caps text-paper-mute"
    >
      <span className={cn('size-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}

// ─── Drawer ────────────────────────────────────────────────────────────────

function CandidateDrawer({
  candidate,
  onApprove,
  onReject,
}: {
  candidate: DiscoverCandidate
  onApprove: () => void
  onReject: () => void
}) {
  const c = candidate
  return (
    <div className="space-y-8">
      <SheetHeader className="space-y-3 pt-2">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <SheetTitle className="font-display text-3xl text-paper">@{c.handle}</SheetTitle>
            {c.display_name && <p className="text-sm text-paper-mute">{c.display_name}</p>}
            <p className="font-mono text-xs text-paper-mute capitalize">
              {c.discovered_via.replace(/_/g, ' ')}
              {c.discovery_seed ? ` · ${c.discovery_seed}` : null}
            </p>
          </div>
          {c.score_overall != null && (
            <span className="score-badge h-10 px-3 text-base">{c.score_overall}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {c.is_outlier_flagged && (
            <span className="inline-flex items-center gap-1 rounded-sm border border-lime/40 px-2 py-0.5 text-[10px] uppercase tracking-caps text-lime">
              <Star className="size-2.5" fill="currentColor" />
              Outlier
            </span>
          )}
          <GeoCell bucket={c.timezone_bucket} country={c.country_guess} />
          <CadenceCell value={c.posts_per_week} />
        </div>
        <a
          href={`https://instagram.com/${c.handle}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-lime hover:underline w-fit"
        >
          Open on Instagram
          <ExternalLink className="size-3" />
        </a>
      </SheetHeader>

      {c.score_overall != null && (
        <section className="space-y-3">
          <h3 className="smallcaps text-paper-mute">Score breakdown</h3>
          <div className="space-y-2">
            <ScoreBar label="Fit" value={c.score_fit} weight="40%" />
            <ScoreBar label="Engagement" value={c.score_engagement} weight="25%" />
            <ScoreBar label="Audience" value={c.score_audience} weight="20%" />
            <ScoreBar label="Recency" value={c.score_recency} weight="15%" />
          </div>
        </section>
      )}

      {(c.talking_head_signal != null ||
        c.bio_quality_signal != null ||
        c.comment_quality_signal != null) && (
        <section className="space-y-3">
          <h3 className="smallcaps text-paper-mute">Content signals</h3>
          <div className="space-y-2">
            <ScoreBar label="Talking head" value={c.talking_head_signal} weight="" muted />
            <ScoreBar label="Bio quality" value={c.bio_quality_signal} weight="" muted />
            <ScoreBar label="Comment quality" value={c.comment_quality_signal} weight="" muted />
          </div>
        </section>
      )}

      {(c.green_flags?.length || c.red_flags?.length) && (
        <section className="grid grid-cols-1 gap-3">
          {c.green_flags && c.green_flags.length > 0 && (
            <FlagBlock tone="green" flags={c.green_flags} />
          )}
          {c.red_flags && c.red_flags.length > 0 && (
            <FlagBlock tone="red" flags={c.red_flags} />
          )}
        </section>
      )}

      {c.score_reasoning && (
        <section className="space-y-2">
          <h3 className="smallcaps text-paper-mute">Sourcer notes</h3>
          <p className="font-display text-base text-paper italic leading-relaxed">
            “{c.score_reasoning}”
          </p>
        </section>
      )}

      {c.biography && (
        <section className="space-y-2">
          <h3 className="smallcaps text-paper-mute">Bio</h3>
          <p className="text-sm text-paper">{c.biography}</p>
        </section>
      )}

      <section className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Stat label="Followers" value={formatCount(c.follower_count)} mono />
        <Stat label="Engagement rate" value={formatPct(c.engagement_rate)} mono />
        <Stat label="Posts / week" value={c.posts_per_week != null ? c.posts_per_week.toFixed(1) : '-'} mono />
        <Stat label="Ad density" value={c.ad_density != null ? `${Math.round(c.ad_density * 100)}%` : '-'} mono />
        <Stat
          label="Like : comment"
          value={c.like_to_comment_ratio != null ? c.like_to_comment_ratio.toFixed(1) : '-'}
          mono
        />
        <Stat label="Last post" value={c.last_post_at ? timeAgo(c.last_post_at) : '-'} />
      </section>

      <section className="space-y-3 border-t border-ink-3 pt-6">
        <h3 className="smallcaps text-paper-mute">
          Action <StatusPill status={c.status} className="ml-2" />
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            onClick={onApprove}
            disabled={c.status === 'approved'}
            variant={c.status === 'approved' ? 'default' : 'outline'}
            className={cn(
              'smallcaps',
              c.status === 'approved' && 'bg-success text-ink hover:bg-success/90'
            )}
          >
            <CheckCircle2 className="mr-1 size-4" />
            Approve
          </Button>
          <Button
            type="button"
            onClick={onReject}
            disabled={c.status === 'rejected'}
            variant={c.status === 'rejected' ? 'default' : 'outline'}
            className={cn(
              'smallcaps',
              c.status === 'rejected' && 'bg-danger text-ink hover:bg-danger/90'
            )}
          >
            <XCircle className="mr-1 size-4" />
            Reject
          </Button>
        </div>
        <p className="text-[11px] text-paper-mute">
          Approving promotes this handle into the tracked-Creator pipeline and kicks off post ingestion.
        </p>
      </section>
    </div>
  )
}

// ─── Small building blocks ─────────────────────────────────────────────────

function ScoreBar({
  label,
  value,
  weight,
  muted,
}: {
  label: string
  value: number | null
  weight: string
  muted?: boolean
}) {
  const pct = value ?? 0
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-paper">
          {label}
          {weight ? <span className="text-paper-mute"> {weight}</span> : null}
        </span>
        <span className="font-mono tabular-nums text-paper">{value ?? '-'}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-ink-3">
        <div
          className={cn('h-full transition-all', muted ? 'bg-paper-mute/60' : 'bg-lime')}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  )
}

function FlagBlock({ tone, flags }: { tone: 'green' | 'red'; flags: string[] }) {
  const Icon = tone === 'green' ? CheckCircle2 : AlertTriangle
  const wrap =
    tone === 'green'
      ? 'border-success/30 bg-success/[0.06] text-success'
      : 'border-danger/30 bg-danger/[0.06] text-danger'
  return (
    <div className={cn('rounded-sm border p-3', wrap)}>
      <p className="smallcaps mb-2 opacity-80">
        {tone === 'green' ? 'Green flags' : 'Red flags'}
      </p>
      <ul className="space-y-1">
        {flags.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-paper">
            <Icon className="size-3 mt-0.5 shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function GeoCell({ bucket, country }: { bucket: string | null; country?: string | null }) {
  const label = bucket || 'UNKNOWN'
  const tone =
    label === 'NORAM' || label === 'UK'
      ? 'border-success/40 text-success'
      : label === 'EMEA'
      ? 'border-lime/40 text-lime'
      : label === 'PHILIPPINES'
      ? 'border-danger/40 text-danger'
      : 'border-ink-3 text-paper-mute'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-caps',
        tone
      )}
    >
      <Globe className="size-2.5" />
      {label}
      {country && country !== label && (
        <span className="ml-1 normal-case tracking-normal text-paper-mute">· {country}</span>
      )}
    </span>
  )
}

function CadenceCell({ value }: { value: number | null }) {
  if (value == null) return <span className="font-mono text-xs text-paper-mute">-</span>
  const tone =
    value >= 3
      ? 'border-success/40 text-success'
      : value >= 2
      ? 'border-lime/40 text-lime'
      : 'border-danger/40 text-danger'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-caps',
        tone
      )}
    >
      <Calendar className="size-2.5" />
      {value.toFixed(1)}/wk
    </span>
  )
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="smallcaps text-paper-mute">{label}</p>
      <p className={cn('text-sm text-paper', mono && 'font-mono tabular-nums')}>{value}</p>
    </div>
  )
}

function StatusPill({
  status,
  className,
}: {
  status: DiscoverCandidate['status']
  className?: string
}) {
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
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-caps text-paper-mute',
        className
      )}
    >
      <span className={cn('size-1.5 rounded-full', dot)} />
      {status}
    </span>
  )
}

// ─── Formatters ────────────────────────────────────────────────────────────

function formatCount(n: number | null): string {
  if (n == null) return '-'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatPct(n: number | null): string {
  if (n == null) return '-'
  return `${(n * 100).toFixed(2)}%`
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// Re-export so we can also expose this from the AppHeader when ProtectedRoute
// is in use. Plain export to keep the file self-contained for the demo.
export { Sparkles }
