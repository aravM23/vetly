/**
 * Tracked Creators — the destination of every Discover → Approve action.
 *
 * Promoted candidates land here as `TrackedCreator` rows in the FastAPI
 * Postgres DB. The backend's velocity-alerts pipeline then ingests their
 * recent posts on a schedule, so this list is the live signal of "who are
 * we actually watching right now".
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Radar,
  RefreshCcw,
  Trash2,
  Users,
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
import { trackedApi, type TrackedCreator } from '@/lib/trackedApi'
import { cn } from '@/lib/utils'

export default function TrackedPage() {
  const [rows, setRows] = useState<TrackedCreator[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await trackedApi.list()
      setRows(list)
      setError(null)
    } catch (e) {
      setRows([])
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  async function untrack(c: TrackedCreator) {
    const prev = rows
    setRows((r) => r?.filter((x) => x.id !== c.id) ?? null)
    try {
      await trackedApi.untrack(c.id)
      toast.success(`Untracked @${c.instagram_handle}`)
    } catch (e) {
      setRows(prev)
      toast.error(`Couldn't untrack: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const stats = useMemo(() => {
    if (!rows) return null
    const totalReach = rows.reduce((s, c) => s + (c.follower_count ?? 0), 0)
    const totalAvgViews = rows.reduce((s, c) => s + (c.avg_views ?? 0), 0)
    return {
      count: rows.length,
      reach: totalReach,
      avgViews: rows.length ? Math.round(totalAvgViews / rows.length) : 0,
    }
  }, [rows])

  return (
    <main className="px-8 py-12">
      <div className="mx-auto max-w-6xl space-y-10">
        <Header
          count={stats?.count ?? 0}
          refreshing={refreshing}
          onRefresh={refresh}
        />

        {stats && (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi
              label="Tracked"
              value={stats.count.toLocaleString()}
              hint="active creators · live in backend"
              accent
            />
            <Kpi
              label="Combined reach"
              value={formatCount(stats.reach)}
              hint="sum of followers"
            />
            <Kpi
              label="Avg views/post"
              value={formatCount(stats.avgViews)}
              hint="across the cohort"
            />
          </section>
        )}

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !rows ? (
          <div className="grid min-h-[40vh] place-items-center">
            <Loader2 className="size-5 animate-spin text-paper-mute" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          <CreatorTable rows={rows} onUntrack={untrack} />
        )}
      </div>
    </main>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────

function Header({
  count,
  refreshing,
  onRefresh,
}: {
  count: number
  refreshing: boolean
  onRefresh: () => void
}) {
  return (
    <header className="space-y-4 border-b border-ink-3 pb-6">
      <div className="flex items-center justify-between gap-4">
        <nav className="flex items-center gap-1 font-mono text-xs text-paper-mute">
          <NavLink to="/discover" className="hover:text-paper">
            Discover
          </NavLink>
          <span>/</span>
          <NavLink to="/sourcing" className="hover:text-paper">
            Sourcing
          </NavLink>
          <span>/</span>
          <span className="text-paper">Tracked</span>
        </nav>
        <div className="flex items-center gap-2">
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
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="smallcaps text-paper-mute">Where creators end up</p>
          <h1 className="font-display text-4xl text-paper sm:text-5xl">
            Tracked creators.
          </h1>
          <p className="font-mono text-xs text-paper-mute">
            {count.toLocaleString()} active · promoted from Discover → Approved
          </p>
        </div>
      </div>
    </header>
  )
}

function Kpi({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
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
      <div className="flex items-center gap-2 text-paper-mute">
        <Users className="size-4" />
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
    </div>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────

function CreatorTable({
  rows,
  onUntrack,
}: {
  rows: TrackedCreator[]
  onUntrack: (c: TrackedCreator) => void
}) {
  return (
    <section className="overflow-x-auto rounded-sm border border-ink-3">
      <Table>
        <TableHeader>
          <TableRow className="border-ink-3 hover:bg-transparent">
            <TableHead className="smallcaps text-paper-mute">Handle</TableHead>
            <TableHead className="smallcaps text-paper-mute text-right">
              Followers
            </TableHead>
            <TableHead className="smallcaps text-paper-mute text-right">
              Avg views
            </TableHead>
            <TableHead className="smallcaps text-paper-mute text-right">
              Avg likes
            </TableHead>
            <TableHead className="smallcaps text-paper-mute text-right">
              Avg comments
            </TableHead>
            <TableHead className="smallcaps text-paper-mute">Added</TableHead>
            <TableHead className="smallcaps text-paper-mute">Last scraped</TableHead>
            <TableHead className="smallcaps text-paper-mute text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow
              key={c.id}
              className="border-ink-3 hover:bg-ink-2"
            >
              <TableCell className="py-3">
                <a
                  href={`https://instagram.com/${c.instagram_handle}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center gap-1 font-mono text-sm text-paper hover:text-lime"
                  title={`Open @${c.instagram_handle} on Instagram`}
                >
                  @{c.instagram_handle}
                  <ExternalLink className="size-3 opacity-0 transition group-hover:opacity-100" />
                </a>
                {c.display_name && (
                  <div className="text-xs text-paper-mute">{c.display_name}</div>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums text-paper">
                {formatCount(c.follower_count)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums text-paper">
                {formatCount(c.avg_views)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums text-paper">
                {formatCount(c.avg_likes)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums text-paper">
                {formatCount(c.avg_comments)}
              </TableCell>
              <TableCell className="font-mono text-[11px] text-paper-mute">
                {relativeTime(c.created_at)}
              </TableCell>
              <TableCell className="font-mono text-[11px] text-paper-mute">
                {c.last_scraped_at ? relativeTime(c.last_scraped_at) : '—'}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onUntrack(c)}
                  title="Untrack creator"
                  className="text-paper-mute hover:text-danger"
                >
                  <Trash2 className="size-4" />
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

function EmptyState() {
  return (
    <div className="rounded-sm border border-dashed border-ink-3 px-8 py-16 text-center">
      <p className="smallcaps text-paper-mute">Nothing tracked yet</p>
      <h2 className="mt-3 font-display text-3xl text-paper">
        Approve a creator to see them here.
      </h2>
      <p className="mt-2 max-w-md mx-auto text-sm text-paper-mute">
        Head to Discover, run a sourcing pass, then approve the creators you
        want to start tracking. They'll show up on this page within seconds
        and the backend will start ingesting their recent posts.
      </p>
      <NavLink to="/discover" className="mt-6 inline-block">
        <Button type="button" className="smallcaps bg-lime text-lime-ink hover:bg-lime/90">
          <Radar className="mr-2 size-4" />
          Go to Discover
        </Button>
      </NavLink>
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
        <code className="font-mono text-paper">localhost:8000</code> (locally
        it's proxied via Vite's <code className="font-mono text-paper">/api</code>)
        or set <code className="font-mono text-paper">VITE_DISCOVER_API_BASE</code>{' '}
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

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatCount(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return Math.round(n).toLocaleString()
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
