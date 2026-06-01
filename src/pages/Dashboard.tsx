/**
 * Discover — the sourcing page, parameterized by program.
 *
 * Two programs live on this page:
 *   - 'club_stanley' (default) → emerging social-media coaches incubator
 *   - 'ambassador'             → Stanley Ambassador (channel-operator) program
 *
 * Layout:
 *   1. Hero KPIs: what's in the cohort, what's high-fit, what's pending.
 *   2. Cohort shortlist preview: glance at the editorial picks.
 *   3. Top picks pending review: high-score candidates from the latest
 *      discovery run, with inline Shortlist / Approve / Reject + Open-on-IG.
 *
 * Data comes from the FastAPI backend via createDiscoverApi(program).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  ExternalLink,
  Globe2,
  Loader2,
  Radar,
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

type DashboardProps = { program?: Program }

export default function DashboardPage({ program = 'club_stanley' }: DashboardProps) {
  const navigate = useNavigate()
  const api = useMemo(() => createDiscoverApi(program), [program])
  const programInfo = PROGRAMS[program]
  const shortlistPath = program === 'club_stanley' ? '/shortlist' : `/${programInfo.slug}/shortlist`

  const [candidates, setCandidates] = useState<DiscoverCandidate[] | null>(null)
  const [shortlist, setShortlist] = useState<DiscoverCandidate[] | null>(null)
  // Lifetime sourced count — used for the conversion-rate KPI on Hero.
  const [sourcedTotal, setSourcedTotal] = useState<number>(0)
  const [running, setRunning] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [cands, sl, allSourced] = await Promise.all([
        api.listCandidates({ status: 'pending', minScore: 0, limit: 200 }),
        api.listShortlist(500).catch(() => [] as DiscoverCandidate[]),
        api
          .listCandidates({ status: 'all', minScore: 0, limit: 2000 })
          .catch(() => [] as DiscoverCandidate[]),
      ])
      setCandidates(cands)
      setShortlist(sl)
      setSourcedTotal(allSourced.length)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCandidates([])
      setShortlist([])
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

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
    const prev = candidates
    setCandidates((rows) => rows?.filter((r) => r.id !== c.id) ?? null)
    setSelectedId(null)
    try {
      await api.approve(c.id)
      toast.success(`Approved @${c.handle} — now tracking.`)
      await load()
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
      await api.reject(c.id)
      toast.success(`Rejected @${c.handle}.`)
    } catch (e) {
      setCandidates(prev)
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
    setCandidates((rows) => rows?.map(patch) ?? null)
    setShortlist((rows) => {
      if (!rows) return null
      if (next) {
        if (rows.find((r) => r.id === c.id)) return rows.map(patch)
        return [{ ...c, is_shortlisted: true, shortlisted_at: new Date().toISOString() }, ...rows]
      }
      return rows.filter((r) => r.id !== c.id)
    })
    try {
      if (next) {
        await api.shortlist(c.id)
        toast.success(`Shortlisted @${c.handle} for ${programInfo.label}.`, {
          action: {
            label: 'View cohort',
            onClick: () => navigate(shortlistPath),
          },
        })
      } else {
        await api.unshortlist(c.id)
        toast.success(`Removed @${c.handle} from ${programInfo.label}.`)
      }
    } catch (e) {
      // Re-sync from backend on failure rather than try to surgically undo.
      void load()
      toast.error(`Couldn't update shortlist: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const highFitPending = useMemo(() => {
    if (!candidates) return []
    return [...candidates]
      .filter((c) => (c.score_overall ?? 0) >= HIGH_FIT_THRESHOLD)
      .sort((a, b) => (b.score_overall ?? 0) - (a.score_overall ?? 0))
  }, [candidates])

  const stats = useMemo(
    () => ({
      pending: candidates?.length ?? 0,
      highFit: highFitPending.length,
      shortlisted: shortlist?.length ?? 0,
      sourced: sourcedTotal,
    }),
    [candidates, highFitPending, shortlist, sourcedTotal]
  )

  const selected = candidates?.find((c) => c.id === selectedId) ?? null

  if (!candidates || !shortlist) {
    if (error) {
      return (
        <main className="px-8 py-12">
          <div className="mx-auto max-w-4xl">
            <ErrorPanel message={error} onRetry={load} />
          </div>
        </main>
      )
    }
    return (
      <main className="grid min-h-[60vh] place-items-center">
        <Loader2 className="size-5 animate-spin text-paper-mute" />
      </main>
    )
  }

  return (
    <main className="px-8 py-12">
      <div className="mx-auto max-w-6xl space-y-12">
        {error && (
          <div className="rounded-sm border border-danger/40 bg-danger/[0.06] px-4 py-3">
            <p className="smallcaps text-danger">Couldn't refresh</p>
            <p className="mt-1 font-mono text-xs text-paper">{error}</p>
          </div>
        )}

        <Hero
          stats={stats}
          running={running}
          onRun={runDiscovery}
          programLabel={programInfo.label}
        />

        {shortlist.length > 0 && (
          <ShortlistSection
            rows={shortlist}
            programLabel={programInfo.label}
            shortlistPath={shortlistPath}
          />
        )}

        <PendingSection
          rows={highFitPending}
          allPending={candidates}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onApprove={approve}
          onReject={reject}
          onToggleShortlist={toggleShortlist}
          onRun={runDiscovery}
          running={running}
          programLabel={programInfo.label}
        />
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
              onToggleShortlist={() => toggleShortlist(selected)}
              programLabel={programInfo.label}
            />
          )}
        </SheetContent>
      </Sheet>
    </main>
  )
}

// ─── Hero ──────────────────────────────────────────────────────────────────

function Hero({
  stats,
  running,
  onRun,
  programLabel,
}: {
  stats: {
    pending: number
    highFit: number
    shortlisted: number
    sourced: number
  }
  running: boolean
  onRun: () => void
  programLabel: string
}) {
  const pickRate =
    stats.sourced > 0 ? ((stats.shortlisted / stats.sourced) * 100).toFixed(1) : '0.0'
  return (
    <header className="space-y-6 border-b border-ink-3 pb-8">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="smallcaps text-paper-mute">{programLabel} · sourcing</p>
          <h1 className="font-display text-4xl text-paper sm:text-5xl">
            Discover creators.
          </h1>
          <p className="font-mono text-xs text-paper-mute">
            {stats.shortlisted} in {programLabel} · {stats.highFit} high-fit pending ·{' '}
            {stats.sourced.toLocaleString()} sourced lifetime
          </p>
        </div>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Trophy className="size-4" />}
          label={programLabel}
          value={stats.shortlisted.toLocaleString()}
          hint={`${pickRate}% of sourced`}
          accent
        />
        <StatCard
          icon={<Star className="size-4" />}
          label="High fit ≥ 80"
          value={stats.highFit.toLocaleString()}
          hint="ready to shortlist"
        />
        <StatCard
          icon={<Radar className="size-4" />}
          label="Total pending"
          value={stats.pending.toLocaleString()}
          hint="awaiting review"
        />
      </div>
    </header>
  )
}

function StatCard({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
  accent?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-sm border bg-ink-2 p-4',
        accent ? 'border-lime/40' : 'border-ink-3'
      )}
    >
      <div className="flex items-center gap-2 text-paper-mute">
        {icon}
        <p className="smallcaps">{label}</p>
      </div>
      <p
        className={cn(
          'mt-2 font-display text-4xl leading-none tabular-nums',
          accent ? 'text-lime' : 'text-paper'
        )}
      >
        {value}
      </p>
      <p className="mt-1 font-mono text-[11px] text-paper-mute">{hint}</p>
    </div>
  )
}

// ─── Club Stanley shortlist section ───────────────────────────────────────

function ShortlistSection({
  rows,
  programLabel,
  shortlistPath,
}: {
  rows: DiscoverCandidate[]
  programLabel: string
  shortlistPath: string
}) {
  const preview = [...rows]
    .sort((a, b) => (b.score_overall ?? 0) - (a.score_overall ?? 0))
    .slice(0, 4)
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="font-display text-2xl text-paper">
            {programLabel} shortlist
          </h2>
          <p className="mt-1 font-mono text-[11px] text-paper-mute">
            {rows.length} creators picked for the cohort
          </p>
        </div>
        <a
          href={shortlistPath}
          className="font-mono text-xs text-lime hover:underline"
        >
          view cohort →
        </a>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {preview.map((c) => (
          <ShortlistChip key={c.id} c={c} />
        ))}
      </div>
    </section>
  )
}

function ShortlistChip({ c }: { c: DiscoverCandidate }) {
  return (
    <a
      href={`https://instagram.com/${c.handle}/`}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-3 rounded-sm border border-lime/30 bg-lime/[0.04] p-3 transition hover:border-lime/60 hover:bg-lime/[0.08]"
    >
      <Avatar handle={c.handle} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm text-paper group-hover:text-lime">
          @{c.handle}
        </p>
        <p className="truncate font-mono text-[10px] text-paper-mute">
          {formatCount(c.follower_count)} ·{' '}
          {c.timezone_bucket ?? c.country_guess ?? '—'}
        </p>
      </div>
      {c.score_overall != null && (
        <span className="font-mono text-xs tabular-nums text-lime">
          {c.score_overall}
        </span>
      )}
    </a>
  )
}

// ─── Pending section ──────────────────────────────────────────────────────

function PendingSection({
  rows,
  allPending,
  selectedId,
  onSelect,
  onApprove,
  onReject,
  onToggleShortlist,
  onRun,
  running,
  programLabel,
}: {
  rows: DiscoverCandidate[]
  allPending: DiscoverCandidate[]
  selectedId: number | null
  onSelect: (id: number) => void
  onApprove: (c: DiscoverCandidate) => void
  onReject: (c: DiscoverCandidate) => void
  onToggleShortlist: (c: DiscoverCandidate) => void
  onRun: () => void
  running: boolean
  programLabel: string
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="font-display text-2xl text-paper">
            Top picks pending review
          </h2>
          <p className="mt-1 font-mono text-[11px] text-paper-mute">
            {rows.length} high-fit creators · {allPending.length} total pending
          </p>
        </div>
        <a
          href="/discover"
          className="font-mono text-xs text-lime hover:underline"
        >
          full list →
        </a>
      </div>

        {rows.length === 0 ? (
          <EmptyPending
            hasAnyPending={allPending.length > 0}
            onRun={onRun}
            running={running}
            programLabel={programLabel}
          />
        ) : (
        <div className="overflow-x-auto rounded-sm border border-ink-3">
          <Table>
            <TableHeader>
              <TableRow className="border-ink-3 hover:bg-transparent">
                <TableHead className="w-16 smallcaps text-paper-mute">
                  Score
                </TableHead>
                <TableHead className="smallcaps text-paper-mute">
                  Creator
                </TableHead>
                <TableHead className="smallcaps text-paper-mute">
                  Bio
                </TableHead>
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
              {rows.slice(0, 12).map((c) => {
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
                        <span className="font-mono text-xs text-paper-mute">
                          -
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-3">
                        <Avatar handle={c.handle} size="sm" />
                        <div className="min-w-0">
                          <a
                            href={`https://instagram.com/${c.handle}/`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="group inline-flex items-center gap-1 font-mono text-sm text-paper hover:text-lime"
                            title={`Open @${c.handle} on Instagram`}
                          >
                            @{c.handle}
                            <ExternalLink className="size-3 opacity-0 transition group-hover:opacity-100" />
                          </a>
                          {c.display_name && (
                            <div className="text-xs text-paper-mute truncate max-w-[180px]">
                              {c.display_name}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[280px]">
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
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleShortlist(c)
                          }}
                          className={cn(
                            'smallcaps h-7 px-2',
                            c.is_shortlisted
                              ? 'bg-lime/[0.12] border border-lime/40 text-lime hover:bg-lime/[0.2]'
                              : 'bg-ink-2 border border-ink-3 text-paper-mute hover:border-lime/40 hover:text-lime'
                          )}
                          title={
                            c.is_shortlisted
                              ? `Remove from ${programLabel}`
                              : `Shortlist for ${programLabel}`
                          }
                        >
                          {c.is_shortlisted ? (
                            <>
                              <XCircle className="size-3 mr-1" />
                              Remove
                            </>
                          ) : (
                            <>
                              <Star
                                className="size-3 mr-1"
                                fill="currentColor"
                              />
                              Shortlist
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation()
                            onApprove(c)
                          }}
                          className="smallcaps h-7 px-2 text-success hover:bg-success/10 hover:text-success border-success/30"
                          title="Approve and start tracking"
                        >
                          <CheckCircle2 className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation()
                            onReject(c)
                          }}
                          className="smallcaps h-7 px-2 text-paper-mute hover:bg-danger/10 hover:text-danger border-ink-3"
                          title="Reject"
                        >
                          <XCircle className="size-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

function EmptyPending({
  hasAnyPending,
  onRun,
  running,
  programLabel,
}: {
  hasAnyPending: boolean
  onRun: () => void
  running: boolean
  programLabel: string
}) {
  const description =
    programLabel === 'Stanley Ambassadors'
      ? 'The LLM sources real channel-operators whose audience actively asks for content frameworks (5K-100K followers, owned distribution beyond IG).'
      : 'The LLM sources real, well-known social-media coaches that match your ICP (10K-100K followers, NORAM/UK/EMEA, talking-head content).'
  return (
    <div className="rounded-sm border border-dashed border-ink-3 px-8 py-12 text-center">
      <p className="smallcaps text-paper-mute">
        {hasAnyPending ? 'No high-fit picks yet' : 'Nothing pending'}
      </p>
      <h3 className="mt-3 font-display text-2xl text-paper">
        {hasAnyPending
          ? 'Lower the bar or run more discovery passes.'
          : 'Run discovery to source your first cohort.'}
      </h3>
      <p className="mt-2 max-w-md mx-auto text-sm text-paper-mute">{description}</p>
      <Button
        type="button"
        onClick={onRun}
        disabled={running}
        className="smallcaps mt-6 bg-lime text-lime-ink hover:bg-lime/90"
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

// ─── Drawer ───────────────────────────────────────────────────────────────

function CandidateDrawer({
  candidate,
  onApprove,
  onReject,
  onToggleShortlist,
  programLabel,
}: {
  candidate: DiscoverCandidate
  onApprove: () => void
  onReject: () => void
  onToggleShortlist: () => void
  programLabel: string
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
            <span className="inline-flex items-center gap-1 rounded-sm border border-lime/40 px-2 py-0.5 text-[10px] uppercase tracking-caps text-lime">
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

      {(c.green_flags?.length || c.red_flags?.length) && (
        <section className="grid grid-cols-1 gap-3">
          {c.green_flags?.length ? (
            <div className="rounded-sm border border-success/40 bg-success/[0.06] p-3">
              <p className="smallcaps text-success">Green flags</p>
              <ul className="mt-2 space-y-1 text-xs text-paper">
                {c.green_flags.map((f, i) => (
                  <li key={i}>· {f}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {c.red_flags?.length ? (
            <div className="rounded-sm border border-danger/40 bg-danger/[0.06] p-3">
              <p className="smallcaps text-danger">Red flags</p>
              <ul className="mt-2 space-y-1 text-xs text-paper">
                {c.red_flags.map((f, i) => (
                  <li key={i}>· {f}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      )}

      <section className="grid grid-cols-2 gap-4 border-t border-ink-3 pt-6">
        <Stat label="Followers" value={formatCount(c.follower_count)} mono />
        <Stat
          label="Engagement"
          value={formatPct(c.engagement_rate)}
          mono
        />
        <Stat
          label="Posts/week"
          value={c.posts_per_week != null ? c.posts_per_week.toFixed(1) : '—'}
          mono
        />
        <Stat
          label="Avg views"
          value={formatCount(c.avg_views)}
          mono
        />
      </section>

      <section className="space-y-2 border-t border-ink-3 pt-6">
        <Button
          type="button"
          onClick={onToggleShortlist}
          className={cn(
            'smallcaps w-full',
            c.is_shortlisted
              ? 'bg-ink-2 border border-lime/40 text-lime hover:bg-ink-3'
              : 'bg-lime text-lime-ink hover:bg-lime/90'
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
              Shortlist for {programLabel}
            </>
          )}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            onClick={onApprove}
            className="smallcaps bg-success text-ink hover:bg-success/90"
          >
            <CheckCircle2 className="mr-1 size-4" />
            Approve & track
          </Button>
          <Button
            type="button"
            onClick={onReject}
            variant="outline"
            className="smallcaps border-ink-3"
          >
            <XCircle className="mr-1 size-4" />
            Reject
          </Button>
        </div>
        <p className="text-[11px] text-paper-mute">
          <span className="text-lime">Shortlist</span> picks the creator for the {programLabel} cohort dashboard. <span className="text-paper">Approve</span> kicks off the velocity-alerts pipeline.
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
        <span className="font-mono tabular-nums text-paper">{value ?? '-'}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-ink-3">
        <div
          className="h-full bg-lime transition-all"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="space-y-1">
      <p className="smallcaps text-paper-mute">{label}</p>
      <p className={cn('text-sm text-paper', mono && 'font-mono tabular-nums')}>
        {value}
      </p>
    </div>
  )
}

// ─── Shared bits ──────────────────────────────────────────────────────────

function Avatar({
  handle,
  size = 'md',
}: {
  handle: string
  size?: 'sm' | 'md'
}) {
  const dim = size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm'
  const initial = handle.charAt(0).toUpperCase()
  return (
    <div
      className={cn(
        'shrink-0 grid place-items-center rounded-full border border-ink-3 bg-ink-3 font-display text-paper',
        dim
      )}
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
        'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-caps',
        isPriority
          ? 'border-lime/40 text-lime'
          : 'border-ink-3 text-paper-mute'
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
    <div className="rounded-sm border border-danger/40 bg-danger/[0.06] p-6">
      <p className="smallcaps text-danger">Backend unreachable</p>
      <p className="mt-2 font-mono text-xs text-paper">{message}</p>
      <p className="mt-3 text-xs text-paper-mute">
        Make sure the FastAPI backend is running at{' '}
        <code className="font-mono text-paper">localhost:8000</code>, or set{' '}
        <code className="font-mono text-paper">VITE_DISCOVER_API_BASE</code>{' '}
        to your deployed backend.
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
