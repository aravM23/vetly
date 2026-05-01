import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { useAuth } from '@/lib/auth'
import { triggerScoring } from '@/lib/scoring'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type CreatorStatus = 'pending' | 'approved' | 'rejected' | 'contacted'
type Platform = 'instagram' | 'tiktok'

type Creator = {
  id: string
  handle: string
  platform: Platform
  display_name: string | null
  profile_url: string | null
  bio: string | null
  niche: string | null
  follower_count: number | null
  following_count: number | null
  post_count: number | null
  avg_likes: number | null
  avg_comments: number | null
  engagement_rate: number | null
  score_fit: number | null
  score_engagement: number | null
  score_audience: number | null
  score_recency: number | null
  score_overall: number | null
  ai_reasoning: string | null
  scored_at: string | null
  scoring_error: string | null
  status: CreatorStatus
}

type StatusFilter = 'all' | CreatorStatus | 'errored'
type PlatformFilter = 'all' | Platform

export default function DashboardPage() {
  const { user } = useAuth()
  const [creators, setCreators] = useState<Creator[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scoring, setScoring] = useState(false)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all')
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100])

  useEffect(() => {
    if (!user) return
    void loadCreators(setCreators)
  }, [user])

  const filtered = useMemo(() => {
    if (!creators) return []
    return creators.filter((c) => {
      if (statusFilter === 'errored') {
        if (!c.scoring_error) return false
      } else if (statusFilter !== 'all') {
        if (c.status !== statusFilter) return false
      }
      if (platformFilter !== 'all' && c.platform !== platformFilter) return false
      const score = c.score_overall
      if (score == null) {
        // Unscored rows are kept for the default range only.
        if (scoreRange[0] > 0 || scoreRange[1] < 100) return false
      } else if (score < scoreRange[0] || score > scoreRange[1]) {
        return false
      }
      return true
    })
  }, [creators, statusFilter, platformFilter, scoreRange])

  const counts = useMemo(() => {
    if (!creators) return null
    return {
      total: creators.length,
      scored: creators.filter((c) => c.score_overall != null).length,
      unscored: creators.filter((c) => c.score_overall == null && !c.scoring_error).length,
      errored: creators.filter((c) => c.scoring_error).length,
      approved: creators.filter((c) => c.status === 'approved').length,
    }
  }, [creators])

  const selected = creators?.find((c) => c.id === selectedId) ?? null

  async function runScoring() {
    setScoring(true)
    try {
      const r = await triggerScoring()
      if (r.total === 0) {
        toast.success('Nothing to score.')
      } else {
        toast.success(
          `Scored ${r.scored} of ${r.total}${
            r.errored > 0 ? ` (${r.errored} errored)` : ''
          }`
        )
      }
      await loadCreators(setCreators)
    } catch (e) {
      toast.error(`Scoring failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setScoring(false)
    }
  }

  async function setStatus(c: Creator, next: CreatorStatus) {
    const previous = c.status
    setCreators((prev) =>
      prev?.map((x) => (x.id === c.id ? { ...x, status: next } : x)) ?? null
    )
    const { error } = await supabase
      .from('creators')
      .update({ status: next })
      .eq('id', c.id)
    if (error) {
      setCreators((prev) =>
        prev?.map((x) => (x.id === c.id ? { ...x, status: previous } : x)) ?? null
      )
      toast.error(error.message)
      return
    }
    toast.success(`Marked ${next}`)
  }

  if (!creators) {
    return (
      <main className="grid min-h-[60vh] place-items-center">
        <Loader2 className="size-5 animate-spin text-paper-mute" />
      </main>
    )
  }

  if (creators.length === 0) {
    return (
      <main className="grid min-h-[60vh] place-items-center px-8">
        <div className="max-w-md space-y-3 text-center">
          <p className="smallcaps text-paper-mute">Empty</p>
          <h1 className="font-display text-3xl text-paper">No Creators yet.</h1>
          <p className="text-sm text-paper-mute">
            Drop a CSV on the import page to get started.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="px-8 py-12">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex items-end justify-between gap-4 border-b border-ink-3 pb-6">
          <div className="space-y-2">
            <p className="smallcaps text-paper-mute">Today</p>
            <h1 className="font-display text-4xl text-paper">Top picks.</h1>
            {counts && (
              <p className="font-mono text-xs text-paper-mute">
                {counts.scored.toLocaleString()} scored, {counts.unscored.toLocaleString()} pending
                {counts.errored > 0 && (
                  <span className="text-danger">, {counts.errored.toLocaleString()} errored</span>
                )}
                , {counts.approved.toLocaleString()} approved
              </p>
            )}
          </div>
          {counts && (counts.unscored > 0 || counts.errored > 0) && (
            <Button
              type="button"
              onClick={runScoring}
              disabled={scoring}
              className="smallcaps bg-lime text-lime-ink hover:bg-lime/90"
            >
              {scoring ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Scoring
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-4" />
                  Score {counts.unscored + counts.errored} pending
                </>
              )}
            </Button>
          )}
        </header>

        <section className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label className="smallcaps text-paper-mute">Status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-44 bg-ink-2 border-ink-3 text-paper">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
                <SelectItem value="errored">Errored</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="smallcaps text-paper-mute">Platform</Label>
            <Select
              value={platformFilter}
              onValueChange={(v) => setPlatformFilter(v as PlatformFilter)}
            >
              <SelectTrigger className="w-44 bg-ink-2 border-ink-3 text-paper">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="tiktok">TikTok</SelectItem>
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
            {filtered.length.toLocaleString()} / {creators.length.toLocaleString()}
          </p>
        </section>

        <section className="overflow-x-auto rounded-sm border border-ink-3">
          <Table>
            <TableHeader>
              <TableRow className="border-ink-3 hover:bg-transparent">
                <TableHead className="w-16 smallcaps text-paper-mute">Score</TableHead>
                <TableHead className="smallcaps text-paper-mute">Handle</TableHead>
                <TableHead className="smallcaps text-paper-mute">Platform</TableHead>
                <TableHead className="smallcaps text-paper-mute text-right">Followers</TableHead>
                <TableHead className="smallcaps text-paper-mute text-right">ER</TableHead>
                <TableHead className="smallcaps text-paper-mute">Status</TableHead>
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
                      ) : c.scoring_error ? (
                        <span
                          className="inline-flex h-6 items-center gap-1 rounded-sm border border-danger/40 px-2 text-[11px] text-danger"
                          title={c.scoring_error}
                        >
                          <AlertTriangle className="size-3" />
                          err
                        </span>
                      ) : (
                        <span className="font-mono text-xs text-paper-mute">-</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="font-mono text-sm text-paper">@{c.handle}</div>
                      {c.display_name && (
                        <div className="text-xs text-paper-mute">{c.display_name}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-paper-mute capitalize">
                      {c.platform}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-paper text-right tabular-nums">
                      {formatCount(c.follower_count)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-paper text-right tabular-nums">
                      {formatPct(c.engagement_rate)}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={c.status} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-paper-mute">
              No Creators match these filters.
            </p>
          )}
        </section>
      </div>

      <Sheet
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <SheetContent className="w-full max-w-xl border-l border-ink-3 bg-ink-2 text-paper sm:max-w-xl overflow-y-auto">
          {selected && (
            <CreatorDrawer
              creator={selected}
              onApprove={() => setStatus(selected, 'approved')}
              onReject={() => setStatus(selected, 'rejected')}
              onContacted={() => setStatus(selected, 'contacted')}
            />
          )}
        </SheetContent>
      </Sheet>
    </main>
  )
}

async function loadCreators(setCreators: (c: Creator[]) => void) {
  const { data, error } = await supabase
    .from('creators')
    .select(
      'id, handle, platform, display_name, profile_url, bio, niche, follower_count, following_count, post_count, avg_likes, avg_comments, engagement_rate, score_fit, score_engagement, score_audience, score_recency, score_overall, ai_reasoning, scored_at, scoring_error, status'
    )
    .order('score_overall', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true })
    .returns<Creator[]>()

  if (error) {
    toast.error(error.message)
    setCreators([])
    return
  }
  setCreators(data ?? [])
}

function CreatorDrawer({
  creator,
  onApprove,
  onReject,
  onContacted,
}: {
  creator: Creator
  onApprove: () => void
  onReject: () => void
  onContacted: () => void
}) {
  return (
    <div className="space-y-8">
      <SheetHeader className="space-y-3 pt-2">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <SheetTitle className="font-display text-3xl text-paper">
              @{creator.handle}
            </SheetTitle>
            {creator.display_name && (
              <p className="text-sm text-paper-mute">{creator.display_name}</p>
            )}
            <p className="font-mono text-xs text-paper-mute capitalize">{creator.platform}</p>
          </div>
          {creator.score_overall != null && (
            <span className="score-badge h-10 px-3 text-base">{creator.score_overall}</span>
          )}
        </div>
        {creator.profile_url && (
          <a
            href={creator.profile_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-lime hover:underline"
          >
            Open profile
            <ExternalLink className="size-3" />
          </a>
        )}
      </SheetHeader>

      {creator.scoring_error && (
        <div className="rounded-sm border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          <p className="smallcaps mb-1">Scoring error</p>
          <p className="font-mono">{creator.scoring_error}</p>
        </div>
      )}

      {creator.score_overall != null && (
        <section className="space-y-3">
          <h3 className="smallcaps text-paper-mute">Score breakdown</h3>
          <div className="space-y-2">
            <ScoreBar label="Fit" value={creator.score_fit} weight="40%" />
            <ScoreBar label="Engagement" value={creator.score_engagement} weight="25%" />
            <ScoreBar label="Audience" value={creator.score_audience} weight="20%" />
            <ScoreBar label="Recency" value={creator.score_recency} weight="15%" />
          </div>
        </section>
      )}

      {creator.ai_reasoning && (
        <section className="space-y-2">
          <h3 className="smallcaps text-paper-mute">AI reasoning</h3>
          <p className="font-display text-base text-paper italic leading-relaxed">
            {creator.ai_reasoning}
          </p>
        </section>
      )}

      {creator.bio && (
        <section className="space-y-2">
          <h3 className="smallcaps text-paper-mute">Bio</h3>
          <p className="text-sm text-paper">{creator.bio}</p>
        </section>
      )}

      <section className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Stat label="Niche" value={creator.niche ?? '-'} />
        <Stat label="Followers" value={formatCount(creator.follower_count)} mono />
        <Stat label="Following" value={formatCount(creator.following_count)} mono />
        <Stat label="Posts" value={formatCount(creator.post_count)} mono />
        <Stat label="Avg likes" value={formatCount(creator.avg_likes)} mono />
        <Stat label="Avg comments" value={formatCount(creator.avg_comments)} mono />
        <Stat label="Engagement rate" value={formatPct(creator.engagement_rate)} mono />
        <Stat
          label="Scored at"
          value={creator.scored_at ? new Date(creator.scored_at).toLocaleString() : '-'}
        />
      </section>

      <section className="space-y-3 border-t border-ink-3 pt-6">
        <h3 className="smallcaps text-paper-mute">
          Action <StatusPill status={creator.status} className="ml-2" />
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            onClick={onApprove}
            disabled={creator.status === 'approved'}
            variant={creator.status === 'approved' ? 'default' : 'outline'}
            className={cn(
              'smallcaps',
              creator.status === 'approved' && 'bg-success text-ink hover:bg-success/90'
            )}
          >
            <CheckCircle2 className="mr-1 size-4" />
            Approve
          </Button>
          <Button
            type="button"
            onClick={onContacted}
            disabled={creator.status === 'contacted'}
            variant={creator.status === 'contacted' ? 'default' : 'outline'}
            className={cn(
              'smallcaps',
              creator.status === 'contacted' && 'bg-lime text-lime-ink hover:bg-lime/90'
            )}
          >
            <Sparkles className="mr-1 size-4" />
            Contacted
          </Button>
          <Button
            type="button"
            onClick={onReject}
            disabled={creator.status === 'rejected'}
            variant={creator.status === 'rejected' ? 'default' : 'outline'}
            className={cn(
              'smallcaps',
              creator.status === 'rejected' && 'bg-danger text-ink hover:bg-danger/90'
            )}
          >
            <XCircle className="mr-1 size-4" />
            Reject
          </Button>
        </div>
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
        <span className="font-mono tabular-nums text-paper">
          {value ?? '-'}
        </span>
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
      <p className={cn('text-sm text-paper', mono && 'font-mono tabular-nums')}>{value}</p>
    </div>
  )
}

function StatusPill({
  status,
  className,
}: {
  status: CreatorStatus
  className?: string
}) {
  const dotClass =
    status === 'approved'
      ? 'bg-success'
      : status === 'rejected'
      ? 'bg-danger'
      : status === 'contacted'
      ? 'bg-lime'
      : 'bg-paper-mute'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-caps text-paper-mute',
        className
      )}
    >
      <span className={cn('size-1.5 rounded-full', dotClass)} />
      {status}
    </span>
  )
}

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
