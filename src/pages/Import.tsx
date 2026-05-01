import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import Papa from 'papaparse'
import { CheckCircle2, FileText, Loader2, Upload, X } from 'lucide-react'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type RawRow = Record<string, string>
type Mapping = Record<CanonicalField, string | null>

type CanonicalField =
  | 'handle'
  | 'platform'
  | 'profile_url'
  | 'display_name'
  | 'bio'
  | 'niche'
  | 'follower_count'
  | 'following_count'
  | 'post_count'
  | 'avg_likes'
  | 'avg_comments'
  | 'engagement_rate'

type ImportResult = {
  batch_id: string
  row_count: number
  imported_count: number
  dedupe_count: number
  errors: Array<{ index: number; reason: string; row: RawRow }>
}

const FIELD_DEFINITIONS: Array<{
  field: CanonicalField
  label: string
  patterns: RegExp[]
  required?: boolean
}> = [
  {
    field: 'handle',
    label: 'Handle',
    patterns: [/^@?handle$/i, /^username$/i, /^user$/i, /^screen_?name$/i, /^name$/i],
    required: true,
  },
  {
    field: 'platform',
    label: 'Platform',
    patterns: [/^platform$/i, /^network$/i, /^channel$/i, /^source_?platform$/i],
  },
  {
    field: 'profile_url',
    label: 'Profile URL',
    patterns: [/^profile_?url$/i, /^url$/i, /^link$/i, /^profile_?link$/i, /^profile$/i],
  },
  {
    field: 'display_name',
    label: 'Display name',
    patterns: [/^display_?name$/i, /^full_?name$/i],
  },
  { field: 'bio', label: 'Bio', patterns: [/^bio$/i, /^description$/i, /^about$/i] },
  {
    field: 'niche',
    label: 'Niche',
    patterns: [/^niche$/i, /^category$/i, /^topic$/i, /^interests?$/i],
  },
  {
    field: 'follower_count',
    label: 'Followers',
    patterns: [/^follower_?count$/i, /^followers$/i, /^audience$/i, /^subscribers?$/i],
  },
  {
    field: 'following_count',
    label: 'Following',
    patterns: [/^following_?count$/i, /^following$/i],
  },
  { field: 'post_count', label: 'Posts', patterns: [/^post_?count$/i, /^posts$/i] },
  { field: 'avg_likes', label: 'Avg likes', patterns: [/^avg_?likes$/i, /^average_?likes$/i, /^likes$/i] },
  {
    field: 'avg_comments',
    label: 'Avg comments',
    patterns: [/^avg_?comments$/i, /^average_?comments$/i, /^comments$/i],
  },
  {
    field: 'engagement_rate',
    label: 'Engagement rate',
    patterns: [/^engagement_?rate$/i, /^engagement$/i, /^er$/i, /^engagement_?%$/i],
  },
]

const SKIP = '__skip__'
const PREVIEW_ROWS = 10

export default function ImportPage() {
  const { user } = useAuth()
  const [secret, setSecret] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<RawRow[]>([])
  const [mapping, setMapping] = useState<Mapping>(emptyMapping())
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const webhookUrl = `${supabaseUrl}/functions/v1/ingest-creators`

  // Pull the user's webhook secret on mount so the import button has it ready.
  useEffect(() => {
    if (!user) return
    let active = true
    supabase
      .from('user_settings')
      .select('webhook_secret')
      .eq('user_id', user.id)
      .single()
      .then(({ data, error }) => {
        if (!active) return
        if (error || !data) {
          toast.error(error?.message ?? 'Could not load webhook secret.')
          return
        }
        setSecret(data.webhook_secret as string)
      })
    return () => {
      active = false
    }
  }, [user])

  function reset() {
    setFile(null)
    setColumns([])
    setRows([])
    setMapping(emptyMapping())
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleFile(picked: File) {
    setFile(picked)
    setResult(null)
    Papa.parse<RawRow>(picked, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const fields = res.meta.fields ?? []
        setColumns(fields)
        setRows(res.data)
        setMapping(autoDetect(fields))
      },
      error: (err) => {
        toast.error(`Could not parse CSV: ${err.message}`)
        reset()
      },
    })
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  async function runImport() {
    if (!secret) {
      toast.error('Webhook secret not loaded yet, try again in a second.')
      return
    }
    if (!mapping.handle) {
      toast.error('Map a column to Handle before importing.')
      return
    }

    const payload = rows.map((row) => {
      const mapped: Record<string, string> = {}
      for (const [field, source] of Object.entries(mapping)) {
        if (!source) continue
        const value = row[source]
        if (value != null) mapped[field] = String(value)
      }
      return { ...mapped, raw: row }
    })

    setImporting(true)
    let res: Response
    try {
      res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-secret': secret,
        },
        body: JSON.stringify({ creators: payload }),
      })
    } catch (e) {
      setImporting(false)
      toast.error(`Network error: ${e instanceof Error ? e.message : String(e)}`)
      return
    }

    const data = (await res.json().catch(() => null)) as ImportResult | { error: string } | null
    setImporting(false)

    if (!res.ok || !data || 'error' in data) {
      const msg = data && 'error' in data ? data.error : `HTTP ${res.status}`
      toast.error(`Import failed: ${msg}`)
      return
    }

    setResult(data)
    toast.success(
      `Imported ${data.imported_count} of ${data.row_count} (${data.dedupe_count} dedup, ${data.errors.length} errors).`
    )
  }

  return (
    <main className="px-8 py-12">
      <div className="mx-auto max-w-5xl space-y-10">
        <div className="space-y-2">
          <p className="smallcaps text-paper-mute">Import</p>
          <h1 className="font-display text-4xl text-paper">New Creators in.</h1>
          <p className="text-sm text-paper-mute">
            Drop a CSV from Manus, Lessee, or any source. We map columns, parse the messy bits,
            and queue them for scoring.
          </p>
        </div>

        {/* Drop zone or file info */}
        {!file && (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'cursor-pointer rounded-sm border border-dashed border-ink-3 bg-ink-2 px-8 py-16 text-center transition',
              dragOver && 'border-lime bg-ink-2/80'
            )}
          >
            <Upload className="mx-auto mb-3 size-6 text-paper-mute" />
            <p className="font-display text-2xl text-paper">Drop a CSV here.</p>
            <p className="mt-1 text-sm text-paper-mute">
              Or click to pick a file. UTF-8 with a header row.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onPickFile}
              className="hidden"
            />
          </div>
        )}

        {file && !result && (
          <div className="space-y-8">
            <div className="flex items-center justify-between rounded-sm border border-ink-3 bg-ink-2 px-4 py-3">
              <div className="flex items-center gap-3">
                <FileText className="size-5 text-paper-mute" />
                <div>
                  <p className="font-mono text-sm text-paper">{file.name}</p>
                  <p className="font-mono text-xs text-paper-mute">
                    {rows.length.toLocaleString()} rows, {columns.length} columns
                  </p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={reset} className="smallcaps">
                <X className="mr-1 size-4" />
                Discard
              </Button>
            </div>

            <section className="space-y-4">
              <div className="space-y-1">
                <h2 className="font-display text-2xl text-paper">Column mapping</h2>
                <p className="text-sm text-paper-mute">
                  Auto-detected from the header. Override anything that's wrong. Handle is the
                  only required field, platform can be inferred from a profile URL.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3">
                {FIELD_DEFINITIONS.map(({ field, label, required }) => (
                  <div key={field} className="space-y-2">
                    <Label htmlFor={`map-${field}`} className="smallcaps text-paper-mute">
                      {label}
                      {required && <span className="ml-1 text-lime">*</span>}
                    </Label>
                    <Select
                      value={mapping[field] ?? SKIP}
                      onValueChange={(v) =>
                        setMapping((m) => ({ ...m, [field]: v === SKIP ? null : v }))
                      }
                    >
                      <SelectTrigger
                        id={`map-${field}`}
                        className="bg-ink-2 border-ink-3 text-paper"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>(skip)</SelectItem>
                        {columns.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl text-paper">
                Preview <span className="text-paper-mute">({Math.min(PREVIEW_ROWS, rows.length)} of {rows.length})</span>
              </h2>
              <div className="overflow-x-auto rounded-sm border border-ink-3">
                <Table>
                  <TableHeader>
                    <TableRow className="border-ink-3 hover:bg-transparent">
                      {columns.map((c) => (
                        <TableHead key={c} className="font-mono text-[11px] uppercase tracking-caps text-paper-mute">
                          {c}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                      <TableRow key={i} className="border-ink-3 hover:bg-ink-2">
                        {columns.map((c) => (
                          <TableCell
                            key={c}
                            className="font-mono text-xs text-paper whitespace-nowrap max-w-[240px] overflow-hidden text-ellipsis"
                          >
                            {row[c] ?? ''}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            <div className="flex items-center justify-end gap-3 border-t border-ink-3 pt-6">
              <Button type="button" variant="outline" onClick={reset} className="smallcaps">
                Cancel
              </Button>
              <Button
                type="button"
                onClick={runImport}
                disabled={importing || !mapping.handle || !secret}
                className="smallcaps bg-lime text-lime-ink hover:bg-lime/90"
              >
                {importing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  `Import ${rows.length} row${rows.length === 1 ? '' : 's'}`
                )}
              </Button>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-6">
            <div className="rounded-sm border border-ink-3 bg-ink-2 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-5 text-lime" />
                <h2 className="font-display text-2xl text-paper">Import complete.</h2>
              </div>
              <div className="grid grid-cols-4 gap-4">
                <Stat label="Total" value={result.row_count} />
                <Stat label="Imported" value={result.imported_count} accent />
                <Stat label="Dedup" value={result.dedupe_count} />
                <Stat label="Errors" value={result.errors.length} danger />
              </div>
              <p className="font-mono text-xs text-paper-mute">batch {result.batch_id}</p>
            </div>

            {result.errors.length > 0 && (
              <section className="space-y-3">
                <h3 className="font-display text-xl text-paper">Errors</h3>
                <div className="overflow-x-auto rounded-sm border border-ink-3">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-ink-3 hover:bg-transparent">
                        <TableHead className="smallcaps text-paper-mute">Row</TableHead>
                        <TableHead className="smallcaps text-paper-mute">Reason</TableHead>
                        <TableHead className="smallcaps text-paper-mute">Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.errors.map((err) => (
                        <TableRow key={err.index} className="border-ink-3 hover:bg-ink-2">
                          <TableCell className="font-mono text-xs text-paper">{err.index + 1}</TableCell>
                          <TableCell className="text-xs text-danger">{err.reason}</TableCell>
                          <TableCell className="font-mono text-xs text-paper-mute max-w-md truncate">
                            {JSON.stringify(err.row)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}

            <div className="flex items-center justify-between border-t border-ink-3 pt-6">
              <Button
                type="button"
                variant="outline"
                disabled
                className="smallcaps"
                title="Wired in step 6"
              >
                Score pending
              </Button>
              <Button type="button" onClick={reset} className="smallcaps bg-lime text-lime-ink hover:bg-lime/90">
                Import another
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function Stat({
  label,
  value,
  accent,
  danger,
}: {
  label: string
  value: number
  accent?: boolean
  danger?: boolean
}) {
  return (
    <div>
      <p className="smallcaps text-paper-mute">{label}</p>
      <p
        className={cn(
          'font-mono text-3xl tabular-nums',
          accent && 'text-lime',
          danger && value > 0 && 'text-danger',
          !accent && !(danger && value > 0) && 'text-paper'
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  )
}

function emptyMapping(): Mapping {
  return Object.fromEntries(FIELD_DEFINITIONS.map((f) => [f.field, null])) as Mapping
}

function autoDetect(sourceColumns: string[]): Mapping {
  const out = emptyMapping()
  for (const { field, patterns } of FIELD_DEFINITIONS) {
    const match = sourceColumns.find((c) => patterns.some((p) => p.test(c.trim())))
    out[field] = match ?? null
  }
  return out
}
