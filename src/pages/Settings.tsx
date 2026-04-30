import { useEffect, useState, type FormEvent } from 'react'
import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

type SettingsRow = {
  product_description: string | null
  icp_description: string | null
  follower_min: number | null
  follower_max: number | null
  min_engagement_rate: number | null
  recipient_email: string | null
  daily_send_enabled: boolean
  daily_send_hour: number
  digest_size: number
  webhook_secret: string
}

type FormState = {
  productDescription: string
  icpDescription: string
  followerMin: string
  followerMax: string
  minEngagementPct: string
  recipientEmail: string
  dailySendEnabled: boolean
  dailySendHour: number
  digestSize: number
}

export default function SettingsPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [webhookSecret, setWebhookSecret] = useState('')
  const [form, setForm] = useState<FormState | null>(null)

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const webhookUrl = `${supabaseUrl}/functions/v1/ingest-creators`

  useEffect(() => {
    if (!user) return
    let active = true

    supabase
      .from('user_settings')
      .select(
        'product_description, icp_description, follower_min, follower_max, min_engagement_rate, recipient_email, daily_send_enabled, daily_send_hour, digest_size, webhook_secret'
      )
      .eq('user_id', user.id)
      .single<SettingsRow>()
      .then(({ data, error }) => {
        if (!active) return
        if (error || !data) {
          toast.error(error?.message ?? 'Could not load settings.')
          setLoading(false)
          return
        }
        setWebhookSecret(data.webhook_secret)
        setForm({
          productDescription: data.product_description ?? '',
          icpDescription: data.icp_description ?? '',
          followerMin: data.follower_min == null ? '' : String(data.follower_min),
          followerMax: data.follower_max == null ? '' : String(data.follower_max),
          minEngagementPct:
            data.min_engagement_rate == null ? '' : String(data.min_engagement_rate * 100),
          recipientEmail: data.recipient_email ?? '',
          dailySendEnabled: data.daily_send_enabled,
          dailySendHour: data.daily_send_hour,
          digestSize: data.digest_size,
        })
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [user])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!user || !form) return

    const followerMin = parseIntOrNull(form.followerMin)
    const followerMax = parseIntOrNull(form.followerMax)
    if (followerMin != null && followerMax != null && followerMin > followerMax) {
      toast.error('Follower min cannot be greater than max.')
      return
    }

    const minErPct = parseFloatOrNull(form.minEngagementPct)
    if (minErPct != null && (minErPct < 0 || minErPct > 100)) {
      toast.error('Min engagement rate must be between 0 and 100 percent.')
      return
    }

    setSaving(true)
    const { error } = await supabase
      .from('user_settings')
      .update({
        product_description: nullIfEmpty(form.productDescription),
        icp_description: nullIfEmpty(form.icpDescription),
        follower_min: followerMin,
        follower_max: followerMax,
        min_engagement_rate: minErPct == null ? null : minErPct / 100,
        recipient_email: nullIfEmpty(form.recipientEmail),
        daily_send_enabled: form.dailySendEnabled,
        daily_send_hour: form.dailySendHour,
        digest_size: form.digestSize,
      })
      .eq('user_id', user.id)
    setSaving(false)

    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Settings saved.')
  }

  if (loading || !form) {
    return (
      <main className="grid min-h-[60vh] place-items-center">
        <Loader2 className="size-5 animate-spin text-paper-mute" />
      </main>
    )
  }

  return (
    <main className="px-8 py-12">
      <form onSubmit={handleSave} className="mx-auto max-w-3xl space-y-12">
        <div className="space-y-2">
          <p className="smallcaps text-paper-mute">Settings</p>
          <h1 className="font-display text-4xl text-paper">How Vetly thinks for you.</h1>
        </div>

        <Section
          title="Product and ICP"
          hint="The model uses these every time it scores a Creator. Be specific."
        >
          <div className="space-y-2">
            <Label htmlFor="product" className="smallcaps text-paper-mute">
              Product description
            </Label>
            <Textarea
              id="product"
              rows={5}
              value={form.productDescription}
              onChange={(e) => setForm({ ...form, productDescription: e.target.value })}
              className="bg-ink-2 border-ink-3 text-paper"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="icp" className="smallcaps text-paper-mute">
              Ideal Creator profile
            </Label>
            <Textarea
              id="icp"
              rows={5}
              value={form.icpDescription}
              onChange={(e) => setForm({ ...form, icpDescription: e.target.value })}
              className="bg-ink-2 border-ink-3 text-paper"
            />
          </div>
        </Section>

        <Section
          title="Filters"
          hint="Hard floors and ceilings. The score function uses these to weight fit."
        >
          <div className="grid grid-cols-2 gap-4">
            <Field
              id="follower_min"
              label="Follower min"
              type="number"
              value={form.followerMin}
              onChange={(v) => setForm({ ...form, followerMin: v })}
              placeholder="10000"
            />
            <Field
              id="follower_max"
              label="Follower max"
              type="number"
              value={form.followerMax}
              onChange={(v) => setForm({ ...form, followerMax: v })}
              placeholder="500000"
            />
          </div>
          <Field
            id="min_er"
            label="Min engagement rate"
            type="number"
            step="0.01"
            value={form.minEngagementPct}
            onChange={(v) => setForm({ ...form, minEngagementPct: v })}
            suffix="%"
            hint="Percent. 2 means 2%."
          />
        </Section>

        <Section title="Delivery" hint="Where the digest goes and when it lands.">
          <Field
            id="recipient_email"
            label="Recipient email"
            type="email"
            value={form.recipientEmail}
            onChange={(v) => setForm({ ...form, recipientEmail: v })}
          />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hour" className="smallcaps text-paper-mute">
                Daily send hour
              </Label>
              <Select
                value={String(form.dailySendHour)}
                onValueChange={(v) => setForm({ ...form, dailySendHour: Number(v) })}
              >
                <SelectTrigger id="hour" className="bg-ink-2 border-ink-3 text-paper">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {hourOptions.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field
              id="digest_size"
              label="Digest size"
              type="number"
              value={String(form.digestSize)}
              onChange={(v) => setForm({ ...form, digestSize: Number(v) || 0 })}
              hint="Top N Creators per day."
            />
          </div>
          <div className="flex items-center justify-between rounded-sm border border-ink-3 bg-ink-2 px-4 py-3">
            <div>
              <p className="text-sm text-paper">Daily send</p>
              <p className="text-xs text-paper-mute">
                Pause this if you want to hold the digest temporarily.
              </p>
            </div>
            <Switch
              checked={form.dailySendEnabled}
              onCheckedChange={(checked) => setForm({ ...form, dailySendEnabled: checked })}
            />
          </div>
        </Section>

        <Section
          title="Webhook"
          hint="POST CSV or JSON Creators to this URL with the secret in the x-webhook-secret header."
        >
          <CopyField label="Endpoint URL" value={webhookUrl} />
          <SecretField
            value={webhookSecret}
            onRegenerate={async () => {
              if (!user) return
              const next = generateSecret()
              const { error } = await supabase
                .from('user_settings')
                .update({ webhook_secret: next })
                .eq('user_id', user.id)
              if (error) {
                toast.error(error.message)
                return
              }
              setWebhookSecret(next)
              toast.success('Webhook secret regenerated.')
            }}
          />
        </Section>

        <div className="flex justify-end border-t border-ink-3 pt-6">
          <Button
            type="submit"
            disabled={saving}
            className="smallcaps bg-lime text-lime-ink hover:bg-lime/90"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : 'Save changes'}
          </Button>
        </div>
      </form>
    </main>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="font-display text-2xl text-paper">{title}</h2>
        {hint && <p className="text-sm text-paper-mute">{hint}</p>}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

type FieldProps = {
  id: string
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  step?: string
  placeholder?: string
  suffix?: string
  hint?: string
}

function Field({ id, label, type, value, onChange, step, placeholder, suffix, hint }: FieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="smallcaps text-paper-mute">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={type}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="bg-ink-2 border-ink-3 text-paper placeholder:text-paper-mute focus-visible:ring-lime"
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-paper-mute">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-paper-mute">{hint}</p>}
    </div>
  )
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-2">
      <Label className="smallcaps text-paper-mute">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={value}
          className="bg-ink-2 border-ink-3 font-mono text-xs text-paper"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          aria-label="Copy"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  )
}

function SecretField({ value, onRegenerate }: { value: string; onRegenerate: () => Promise<void> }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [open, setOpen] = useState(false)

  const masked = value ? '•'.repeat(Math.min(48, value.length)) : ''

  return (
    <div className="space-y-2">
      <Label className="smallcaps text-paper-mute">Webhook secret</Label>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={revealed ? value : masked}
          className="bg-ink-2 border-ink-3 font-mono text-xs text-paper"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? 'Hide' : 'Reveal'}
        >
          {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          aria-label="Copy"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" aria-label="Regenerate">
              <RefreshCw className="size-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">Regenerate webhook secret?</DialogTitle>
              <DialogDescription>
                Anything still posting to the old secret will start failing. You'll need to update
                Manus, Lessee, or any other producer with the new value.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={regenerating}
                onClick={async () => {
                  setRegenerating(true)
                  await onRegenerate()
                  setRegenerating(false)
                  setOpen(false)
                }}
                className="smallcaps bg-lime text-lime-ink hover:bg-lime/90"
              >
                {regenerating ? <Loader2 className="size-4 animate-spin" /> : 'Regenerate'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

const hourOptions = buildHourOptions()

function buildHourOptions() {
  const out: Array<{ value: number; label: string }> = []
  for (let h = 0; h < 24; h++) {
    const d = new Date()
    d.setUTCHours(h, 0, 0, 0)
    const local = d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
    const utc = `${String(h).padStart(2, '0')}:00 UTC`
    out.push({ value: h, label: `${utc} (${local})` })
  }
  return out
}

function generateSecret() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function parseIntOrNull(v: string): number | null {
  if (!v.trim()) return null
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

function parseFloatOrNull(v: string): number | null {
  if (!v.trim()) return null
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function nullIfEmpty(v: string): string | null {
  return v.trim() ? v : null
}
