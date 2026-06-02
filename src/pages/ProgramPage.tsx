/**
 * ProgramPage — one page per sourcing program, parameterized.
 *
 * Two programs share this page:
 *   - 'club_stanley' (incubator for emerging social-media coaches)  → /
 *   - 'ambassador'   (Stanley Partnerships — channel operators)     → /partnerships
 *
 * Layout:
 *   1. Hero with Stanley mascot, program name, tagline, Run button.
 *   2. KPI strip (cohort size, high-fit pending, total pending, pick rate).
 *   3. Segmented tab control: Pending review | Cohort | All sourced.
 *   4. One table that renders the active tab, with row actions appropriate
 *      to the tab (shortlist/approve/reject vs remove).
 *   5. Click any row → drawer with full creator details.
 *
 * Backend: createDiscoverApi(program) — user_id 1 for Club Stanley,
 * user_id 2 for Ambassadors. Both share the schema; only the prompts +
 * follower window differ.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ExternalLink,
  Globe2,
  Loader2,
  Sparkles,
  Star,
  Trophy,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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

const HIGH_FIT_THRESHOLD = 80

type Tab = 'pending' | 'cohort' | 'all'

const PROGRAM_COPY: Record<
  Program,
  { eyebrow: string; title: string; tagline: string; emptyHint: string }
> = {
  club_stanley: {
    eyebrow: 'Club Stanley · sourcing',
    title: 'Find emerging social-media coaches.',
    tagline:
      "10K-100K, NORAM/UK/EMEA, talking-head with a clear POV. Stanley's incubator cohort.",
    emptyHint:
      'The LLM sources real, well-known social-media coaches that match the Club Stanley ICP.',
  },
  ambassador: {
    eyebrow: 'Partnerships · sourcing',
    title: 'Find Stanley Ambassadors.',
    tagline:
      "Channel operators whose audience already wants a content thought-partner. The non-negotiable test: if Stanley disappeared tomorrow, would their audience still be searching for a tool like Stanley?",
    emptyHint:
      'The LLM sources real channel-operators with owned distribution beyond IG (5K-100K, ideal sweet spot 10K-50K).',
  },
}

type ProgramPageProps = { program: Program }

export default function ProgramPage({ program }: ProgramPageProps) {
  const api = useMemo(() => createDiscoverApi(program), [program])
  const programInfo = PROGRAMS[program]
  const copy = PROGRAM_COPY[program]

  const [pending, setPending] = useState<DiscoverCandidate[] | null>(null)
  const [cohort, setCohort] = useState<DiscoverCandidate[] | null>(null)
  const [allSourced, setAllSourced] = useState<DiscoverCandidate[]>([])
  const [running, setRunning] = useState(false)
  const [tab, setTab] = useState<Tab>('pending')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [p, c, a] = await Promise.all([
        api.listCandidates({ status: 'pending', minScore: 0, limit: 200 }),
        api.listShortlist(500).catch(() => [] as DiscoverCandidate[]),
        api
          .listCandidates({ status: 'all', minScore: 0, limit: 2000 })
          .catch(() => [] as DiscoverCandidate[]),
      ])
      setPending(p)
      setCohort(c)
      setAllSourced(a)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPending([])
      setCohort([])
      setAllSourced([])
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  // Reset to "pending" when the user switches programs.
  useEffect(() => {
    setTab('pending')
    setSelectedId(null)
  }, [program])

  async function runDiscovery() {
    setRunning(true)
    try {
      const run = await api.run({ useScrapers: true, runSync: true })
      toast.success(`Sourced ${run.scored_count} new creators.`)
      await load()
    } catch (e) {
      toast.error(`Discovery failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  async function approve(c: DiscoverCandidate) {
    const prev = pending
    setPending((rows) => rows?.filter((r) => r.id !== c.id) ?? null)
    setSelectedId(null)
    try {
      await api.approve(c.id)
      toast.success(`Approved @${c.handle}.`)
      await load()
    } catch (e) {
      setPending(prev)
      toast.error(`Couldn't approve: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function reject(c: DiscoverCandidate) {
    const prev = pending
    setPending((rows) => rows?.filter((r) => r.id !== c.id) ?? null)
    setSelectedId(null)
    try {
      await api.reject(c.id)
      toast.success(`Rejected @${c.handle}.`)
    } catch (e) {
      setPending(prev)
      toast.error(`Couldn't reject: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function toggleShortlist(c: DiscoverCandidate) {
    const next = !c.is_shortlisted
    const patch = (r: DiscoverCandidate) =>
      r.id === c.id
        ? {
            ...r,
            is_shortlisted: next,
            shortlisted_at: next ? new Date().toISOString() : null,
          }
        : r
    setPending((rows) => rows?.map(patch) ?? null)
    setCohort((rows) => {
      if (!rows) return null
      if (next) {
        if (rows.find((r) => r.id === c.id)) return rows.map(patch)
        return [
          { ...c, is_shortlisted: true, shortlisted_at: new Date().toISOString() },
          ...rows,
        ]
      }
      return rows.filter((r) => r.id !== c.id)
    })
    try {
      if (next) {
        await api.shortlist(c.id)
        toast.success(`Added @${c.handle} to ${programInfo.label}.`)
      } else {
        await api.unshortlist(c.id)
        toast.success(`Removed @${c.handle} from ${programInfo.label}.`)
      }
    } catch (e) {
      void load()
      toast.error(`Couldn't update: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const stats = useMemo(() => {
    const cohortCount = cohort?.length ?? 0
    const pendingCount = pending?.length ?? 0
    const highFit =
      pending?.filter((c) => (c.score_overall ?? 0) >= HIGH_FIT_THRESHOLD).length ?? 0
    const sourced = allSourced.length
    const pickRate = sourced > 0 ? (cohortCount / sourced) * 100 : 0
    return { cohortCount, pendingCount, highFit, sourced, pickRate }
  }, [pending, cohort, allSourced])

  // Active rows depending on the tab.
  const activeRows = useMemo<DiscoverCandidate[]>(() => {
    if (tab === 'pending') {
      return [...(pending ?? [])].sort(
        (a, b) => (b.score_overall ?? 0) - (a.score_overall ?? 0)
      )
    }
    if (tab === 'cohort') {
      return [...(cohort ?? [])].sort(
        (a, b) => (b.score_overall ?? 0) - (a.score_overall ?? 0)
      )
    }
    return [...allSourced].sort(
      (a, b) => (b.score_overall ?? 0) - (a.score_overall ?? 0)
    )
  }, [tab, pending, cohort, allSourced])

  const selected =
    activeRows.find((c) => c.id === selectedId) ??
    pending?.find((c) => c.id === selectedId) ??
    cohort?.find((c) => c.id === selectedId) ??
    allSourced.find((c) => c.id === selectedId) ??
    null

  const loaded = pending != null && cohort != null

  if (!loaded && error) {
    return (
      <main className="px-6 py-12 sm:px-10">
        <div className="mx-auto max-w-6xl">
          <ErrorPanel message={error} onRetry={load} />
        </div>
      </main>
    )
  }

  if (!loaded) {
    return (
      <main className="grid min-h-[60vh] place-items-center">
        <Loader2 className="size-5 animate-spin text-paper-mute" />
      </main>
    )
  }

  return (
    <main className="px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-6xl space-y-10">
        {error && (
          <div className="rounded-[10px] border border-danger/40 bg-danger/[0.06] px-4 py-3">
            <p className="smallcaps text-danger">Couldn't refresh</p>
            <p className="mt-1 font-mono text-xs text-paper">{error}</p>
          </div>
        )}

        <Hero copy={copy} stats={stats} running={running} onRun={runDiscovery} />

        <TabBar
          tab={tab}
          onChange={setTab}
          counts={{
            pending: stats.pendingCount,
            cohort: stats.cohortCount,
            all: stats.sourced,
          }}
        />

        {activeRows.length === 0 ? (
          <Empty
            tab={tab}
            programLabel={programInfo.label}
            emptyHint={copy.emptyHint}
            onRun={runDiscovery}
            running={running}
          />
        ) : (
          <CreatorTable
            rows={activeRows}
            tab={tab}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onApprove={approve}
            onReject={reject}
            onToggleShortlist={toggleShortlist}
          />
        )}
      </div>

      <Sheet
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <SheetContent className="w-full overflow-y-auto border-l border-ink-3 bg-ink-2 text-paper sm:max-w-xl">
          {selected && (
            <CandidateDrawer
              candidate={selected}
              programLabel={programInfo.label}
              onApprove={() => approve(selected)}
              onReject={() => reject(selected)}
              onToggleShortlist={() => toggleShortlist(selected)}
            />
          )}
        </SheetContent>
      </Sheet>
    </main>
  )
}

// ─── Hero ──────────────────────────────────────────────────────────────────

function Hero({
  copy,
  stats,
  running,
  onRun,
}: {
  copy: { eyebrow: string; title: string; tagline: string }
  stats: {
    cohortCount: number
    pendingCount: number
    highFit: number
    sourced: number
    pickRate: number
  }
  running: boolean
  onRun: () => void
}) {
  return (
    <section className="relative overflow-hidden rounded-[20px] border border-ink-3 bg-gradient-to-br from-ink-2 via-ink to-ink p-6 sm:p-12">
      {/* glow blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-lime/25 blur-[100px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 bottom-0 size-72 rounded-full bg-lime/12 blur-[100px]"
      />

      <div className="relative grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="space-y-5">
          <p className="smallcaps text-paper-mute">{copy.eyebrow}</p>
          <h1 className="font-display text-5xl leading-[1.05] text-paper sm:text-6xl">
            {copy.title}
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-paper-mute sm:text-lg">
            {copy.tagline}
          </p>
          <div className="pt-2">
            <Button
              type="button"
              onClick={onRun}
              disabled={running}
              className="smallcaps glow-violet pill h-12 bg-lime px-7 text-base font-bold text-lime-ink hover:bg-lime/90"
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
        </div>

        <div className="hidden sm:block">
          <Mascot />
        </div>
      </div>

      <div className="relative mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          icon={<Trophy className="size-4" />}
          label="In cohort"
          value={stats.cohortCount}
          accent
        />
        <Kpi
          icon={<Star className="size-4" />}
          label="High fit ≥ 80"
          value={stats.highFit}
        />
        <Kpi
          icon={<Sparkles className="size-4" />}
          label="Pending"
          value={stats.pendingCount}
        />
        <Kpi
          icon={<Globe2 className="size-4" />}
          label="Pick rate"
          value={`${stats.pickRate.toFixed(1)}%`}
          hint={`${stats.cohortCount} of ${stats.sourced.toLocaleString()}`}
        />
      </div>
    </section>
  )
}

function Mascot() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 rounded-full bg-lime/35 blur-[60px]"
      />
      <img
        src="/stanley-mascot.png"
        alt="Stanley"
        className="size-56 object-contain drop-shadow-[0_20px_60px_rgba(167,139,250,0.5)]"
      />
    </div>
  )
}

function Kpi({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  hint?: string
  accent?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-[10px] border bg-ink-2/60 p-4 backdrop-blur-sm',
        accent ? 'border-lime/40' : 'border-ink-3'
      )}
    >
      <div className="flex items-center gap-2 text-paper-mute">
        {icon}
        <p className="smallcaps">{label}</p>
      </div>
      <p
        className={cn(
          'mt-2 font-display text-3xl leading-none tabular-nums sm:text-4xl',
          accent ? 'text-lime' : 'text-paper'
        )}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {hint && <p className="mt-1 font-mono text-[10px] text-paper-mute">{hint}</p>}
    </div>
  )
}

// ─── Tabs ──────────────────────────────────────────────────────────────────

function TabBar({
  tab,
  onChange,
  counts,
}: {
  tab: Tab
  onChange: (t: Tab) => void
  counts: { pending: number; cohort: number; all: number }
}) {
  const items: { id: Tab; label: string; count: number }[] = [
    { id: 'pending', label: 'Pending review', count: counts.pending },
    { id: 'cohort', label: 'In cohort', count: counts.cohort },
    { id: 'all', label: 'All sourced', count: counts.all },
  ]
  return (
    <div className="inline-flex rounded-full border border-ink-3 bg-ink-2/60 p-1 backdrop-blur-sm">
      {items.map((it) => {
        const active = it.id === tab
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition',
              active
                ? 'bg-lime text-lime-ink'
                : 'text-paper-mute hover:text-paper'
            )}
          >
            {it.label}
            <span
              className={cn(
                'font-mono text-[10px] tabular-nums',
                active ? 'text-lime-ink/60' : 'text-paper-mute/70'
              )}
            >
              {it.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Table ─────────────────────────────────────────────────────────────────

function CreatorTable({
  rows,
  tab,
  selectedId,
  onSelect,
  onApprove,
  onReject,
  onToggleShortlist,
}: {
  rows: DiscoverCandidate[]
  tab: Tab
  selectedId: number | null
  onSelect: (id: number) => void
  onApprove: (c: DiscoverCandidate) => void
  onReject: (c: DiscoverCandidate) => void
  onToggleShortlist: (c: DiscoverCandidate) => void
}) {
  return (
    <div className="surface overflow-x-auto">
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
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 50).map((c) => {
            const isSelected = c.id === selectedId
            return (
              <TableRow
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={cn(
                  'cursor-pointer border-ink-3 hover:bg-ink-2',
                  isSelected && 'bg-ink-2 border-l-2 border-l-lime'
                )}
              >
                <TableCell>
                  {c.score_overall != null ? (
                    <span className="score-badge">{c.score_overall}</span>
                  ) : (
                    <span className="font-mono text-xs text-paper-mute">—</span>
                  )}
                </TableCell>
                <TableCell className="py-2">
                  <div className="flex items-center gap-3">
                    <Avatar handle={c.handle} />
                    <div className="min-w-0">
                      <a
                        href={`https://instagram.com/${c.handle}/`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="group inline-flex items-center gap-1 font-mono text-sm text-paper hover:text-lime"
                      >
                        @{c.handle}
                        <ExternalLink className="size-3 opacity-0 transition group-hover:opacity-100" />
                      </a>
                      {c.display_name && (
                        <div className="max-w-[200px] truncate text-xs text-paper-mute">
                          {c.display_name}
                        </div>
                      )}
                    </div>
                  </div>
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
                <TableCell
                  className="text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <RowActions
                    c={c}
                    tab={tab}
                    onApprove={onApprove}
                    onReject={onReject}
                    onToggleShortlist={onToggleShortlist}
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function RowActions({
  c,
  tab,
  onApprove,
  onReject,
  onToggleShortlist,
}: {
  c: DiscoverCandidate
  tab: Tab
  onApprove: (c: DiscoverCandidate) => void
  onReject: (c: DiscoverCandidate) => void
  onToggleShortlist: (c: DiscoverCandidate) => void
}) {
  if (tab === 'cohort') {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => onToggleShortlist(c)}
        className="smallcaps h-7 px-2 text-paper-mute hover:bg-danger/10 hover:text-danger"
      >
        <XCircle className="mr-1 size-3" />
        Remove
      </Button>
    )
  }
  return (
    <div className="inline-flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        onClick={() => onToggleShortlist(c)}
        className={cn(
          'smallcaps h-7 px-2',
          c.is_shortlisted
            ? 'border border-lime/40 bg-lime/[0.12] text-lime hover:bg-lime/[0.2]'
            : 'border border-ink-3 bg-ink-2 text-paper-mute hover:border-lime/40 hover:text-lime'
        )}
      >
        {c.is_shortlisted ? (
          <>
            <XCircle className="mr-1 size-3" />
            Remove
          </>
        ) : (
          <>
            <Star className="mr-1 size-3" fill="currentColor" />
            Shortlist
          </>
        )}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onApprove(c)}
        className="smallcaps h-7 px-2 border-success/30 text-success hover:bg-success/10 hover:text-success"
        title="Approve & track"
      >
        <CheckCircle2 className="size-3" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onReject(c)}
        className="smallcaps h-7 px-2 border-ink-3 text-paper-mute hover:bg-danger/10 hover:text-danger"
        title="Reject"
      >
        <XCircle className="size-3" />
      </Button>
    </div>
  )
}

// ─── Empty state ───────────────────────────────────────────────────────────

function Empty({
  tab,
  programLabel,
  emptyHint,
  onRun,
  running,
}: {
  tab: Tab
  programLabel: string
  emptyHint: string
  onRun: () => void
  running: boolean
}) {
  if (tab === 'cohort') {
    return (
      <div className="surface px-8 py-16 text-center">
        <Trophy className="mx-auto size-8 text-paper-mute" />
        <p className="smallcaps mt-4 text-paper-mute">No picks yet</p>
        <h3 className="mt-3 font-display text-3xl text-paper">
          Build out the {programLabel} cohort.
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-paper-mute">
          Browse pending candidates and tap{' '}
          <span className="mx-1 inline-flex items-center gap-1 rounded-[6px] border border-lime/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-caps text-lime">
            <Star className="size-2.5" />
            Shortlist
          </span>
          on the ones who belong here.
        </p>
      </div>
    )
  }
  return (
    <div className="surface px-8 py-16 text-center">
      <Sparkles className="mx-auto size-8 text-paper-mute" />
      <p className="smallcaps mt-4 text-paper-mute">
        {tab === 'pending' ? 'Nothing pending' : 'Nothing sourced yet'}
      </p>
      <h3 className="mt-3 font-display text-3xl text-paper">
        Run discovery to find creators.
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-paper-mute">{emptyHint}</p>
      <Button
        type="button"
        onClick={onRun}
        disabled={running}
        className="smallcaps glow-violet pill mt-6 h-12 bg-lime px-7 text-base font-bold text-lime-ink hover:bg-lime/90"
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
  )
}

// ─── Drawer ────────────────────────────────────────────────────────────────

function CandidateDrawer({
  candidate,
  programLabel,
  onApprove,
  onReject,
  onToggleShortlist,
}: {
  candidate: DiscoverCandidate
  programLabel: string
  onApprove: () => void
  onReject: () => void
  onToggleShortlist: () => void
}) {
  const c = candidate
  return (
    <div className="space-y-8">
      <SheetHeader className="space-y-3 pt-2">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <SheetTitle className="font-display text-3xl text-paper">
              @{c.handle}
            </SheetTitle>
            {c.display_name && (
              <p className="text-base text-paper">{c.display_name}</p>
            )}
            <p className="font-mono text-xs text-paper-mute capitalize">
              {c.discovered_via.replace(/_/g, ' ')}
              {c.discovery_seed ? ` · ${c.discovery_seed}` : null}
            </p>
          </div>
          {c.score_overall != null && (
            <span className="score-badge h-10 px-3 text-base">
              {c.score_overall}
            </span>
          )}
        </div>
        <a
          href={`https://instagram.com/${c.handle}/`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-xs text-lime hover:underline"
        >
          Open on Instagram
          <ExternalLink className="size-3" />
        </a>
        <div className="flex flex-wrap gap-2 pt-1">
          <GeoChip country={c.country_guess} timezone={c.timezone_bucket} />
          {c.is_outlier_flagged && (
            <span className="inline-flex items-center gap-1 rounded-[6px] border border-lime/40 px-2 py-0.5 text-[10px] uppercase tracking-caps text-lime">
              <Star className="size-2.5" fill="currentColor" />
              Outlier
            </span>
          )}
        </div>
      </SheetHeader>

      {c.biography && (
        <section className="space-y-2">
          <h3 className="smallcaps text-paper-mute">Bio</h3>
          <p className="text-sm text-paper">{c.biography}</p>
        </section>
      )}

      {c.score_overall != null && (
        <section className="space-y-3">
          <h3 className="smallcaps text-paper-mute">Score breakdown</h3>
          <ScoreBar label="Fit" value={c.score_fit} weight="40%" />
          <ScoreBar label="Engagement" value={c.score_engagement} weight="25%" />
          <ScoreBar label="Audience" value={c.score_audience} weight="20%" />
          <ScoreBar label="Recency" value={c.score_recency} weight="15%" />
        </section>
      )}

      {c.score_reasoning && (
        <section className="space-y-2">
          <h3 className="smallcaps text-paper-mute">AI reasoning</h3>
          <p className="font-display text-base italic leading-relaxed text-paper">
            {c.score_reasoning}
          </p>
        </section>
      )}

      {(c.green_flags?.length || c.red_flags?.length) ? (
        <section className="grid grid-cols-1 gap-3">
          {c.green_flags?.length ? (
            <div className="rounded-[8px] border border-success/40 bg-success/[0.06] p-3">
              <p className="smallcaps text-success">Green flags</p>
              <ul className="mt-2 space-y-1 text-xs text-paper">
                {c.green_flags.map((f, i) => (
                  <li key={i}>· {f}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {c.red_flags?.length ? (
            <div className="rounded-[8px] border border-danger/40 bg-danger/[0.06] p-3">
              <p className="smallcaps text-danger">Red flags</p>
              <ul className="mt-2 space-y-1 text-xs text-paper">
                {c.red_flags.map((f, i) => (
                  <li key={i}>· {f}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-4 border-t border-ink-3 pt-6">
        <Stat label="Followers" value={formatCount(c.follower_count)} />
        <Stat label="Engagement" value={formatPct(c.engagement_rate)} />
        <Stat
          label="Posts/week"
          value={c.posts_per_week != null ? c.posts_per_week.toFixed(1) : '—'}
        />
        <Stat label="Avg views" value={formatCount(c.avg_views)} />
      </section>

      <section className="space-y-2 border-t border-ink-3 pt-6">
        <Button
          type="button"
          onClick={onToggleShortlist}
          className={cn(
            'smallcaps pill h-11 w-full text-sm font-bold',
            c.is_shortlisted
              ? 'border border-lime/40 bg-ink-2 text-lime hover:bg-ink-3'
              : 'glow-violet bg-lime text-lime-ink hover:bg-lime/90'
          )}
        >
          {c.is_shortlisted ? (
            <>
              <XCircle className="mr-1 size-4" />
              Remove from {programLabel}
            </>
          ) : (
            <>
              <Star className="mr-1 size-4" fill="currentColor" />
              Add to {programLabel}
            </>
          )}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            onClick={onApprove}
            className="pill h-10 bg-success font-bold text-ink hover:bg-success/90"
          >
            <CheckCircle2 className="mr-1 size-4" />
            Approve
          </Button>
          <Button
            type="button"
            onClick={onReject}
            variant="outline"
            className="pill h-10 border-ink-3 font-semibold"
          >
            <XCircle className="mr-1 size-4" />
            Reject
          </Button>
        </div>
        <p className="pt-1 text-[11px] text-paper-mute">
          <span className="text-lime">Shortlist</span> picks the creator for the {programLabel} cohort. <span className="text-paper">Approve</span> kicks off the velocity-alerts pipeline.
        </p>
      </section>
    </div>
  )
}

function ScoreBar({
  label,
  value,
  weight,
}: {
  label: string
  value: number | null
  weight: string
}) {
  const pct = value ?? 0
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-paper">
          {label} <span className="text-paper-mute">{weight}</span>
        </span>
        <span className="font-mono tabular-nums text-paper">{value ?? '—'}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-[4px] bg-ink-3">
        <div
          className="h-full bg-lime transition-all"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="smallcaps text-paper-mute">{label}</p>
      <p className="font-mono text-sm tabular-nums text-paper">{value}</p>
    </div>
  )
}

// ─── Shared bits ───────────────────────────────────────────────────────────

function Avatar({ handle }: { handle: string }) {
  const initial = handle.charAt(0).toUpperCase()
  return (
    <div
      className="grid size-8 shrink-0 place-items-center rounded-full border border-ink-3 bg-gradient-to-br from-lime/20 to-ink-3 font-display text-xs text-paper"
      aria-hidden
    >
      {initial}
    </div>
  )
}

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
  const isPriority =
    timezone === 'NORAM' || timezone === 'UK' || timezone === 'EMEA'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-caps',
        isPriority ? 'border-lime/40 text-lime' : 'border-ink-3 text-paper-mute'
      )}
      title={country ?? ''}
    >
      <Globe2 className="size-2.5" />
      {timezone ?? country}
    </span>
  )
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="rounded-[10px] border border-danger/40 bg-danger/[0.06] p-6">
      <p className="smallcaps text-danger">Backend unreachable</p>
      <p className="mt-2 font-mono text-xs text-paper">{message}</p>
      <p className="mt-3 text-xs text-paper-mute">
        Make sure the FastAPI backend is reachable. Set{' '}
        <code className="font-mono text-paper">VITE_DISCOVER_API_BASE</code> in
        your env to point at it.
      </p>
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

// ─── Helpers ───────────────────────────────────────────────────────────────

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
