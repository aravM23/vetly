// Vetly send-digest Edge Function
//
// One endpoint, three modes selected by request body:
//
//   {}                  -> Mode: TEST SEND. JWT-authenticated. Pulls top
//                          digest_size unscored-pending Creators for the
//                          calling user, renders the HTML, sends via Resend
//                          to user_settings.recipient_email, marks
//                          included_in_digest_at = now() on every picked
//                          Creator.
//
//   {mark: false}       -> Same as above, but does NOT mark
//                          included_in_digest_at. Useful for the /digest
//                          page's "Send test now" button so the user can
//                          iterate on email formatting without consuming
//                          Creators that should still go in tomorrow's
//                          real digest.
//
//   {preview: true}     -> JWT-authenticated. Returns {html, count, picked}
//                          with the rendered HTML and metadata. Does not
//                          send, does not mark.
//
//   {cron: true}        -> CRON MODE. Authorization header MUST be the
//                          service_role bearer (we verify against
//                          SUPABASE_SERVICE_ROLE_KEY). Loops every
//                          user_settings row where daily_send_enabled is
//                          true and daily_send_hour equals the current UTC
//                          hour, sending to each. Filters by hour
//                          internally so pg_cron only needs ONE entry that
//                          fires every hour at minute 0.
//
// HTML uses inline styles and table layout (the only reliable way to ship
// styled email across Gmail, Outlook, Apple Mail, etc). Web fonts are
// requested via Google Fonts <link> with system fallbacks (serif / sans /
// monospace) so clients that strip web fonts still render readably.
//
// Resend sandbox: from = onboarding@resend.dev, recipient must be the email
// the Resend account was registered with. If user_settings.recipient_email
// differs, Resend returns "You can only send testing emails to your own
// email address" and we surface that error.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4.0.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

const FROM = 'Vetly <onboarding@resend.dev>'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

type SettingsRow = {
  user_id: string
  icp_description: string | null
  recipient_email: string | null
  digest_size: number
  daily_send_enabled: boolean
  daily_send_hour: number
}

type CreatorRow = {
  id: string
  handle: string
  display_name: string | null
  platform: string
  follower_count: number | null
  engagement_rate: number | null
  niche: string | null
  bio: string | null
  ai_reasoning: string | null
  profile_url: string | null
  score_overall: number | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const body = (await req.json().catch(() => ({}))) as {
    cron?: boolean
    preview?: boolean
    mark?: boolean
  }

  // ─── Cron mode ──────────────────────────────────────────────────────────
  if (body.cron === true) {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^bearer\s+/i, '').trim()
    if (token !== SERVICE_ROLE_KEY) {
      return json({ error: 'Cron mode requires the service role bearer' }, 401)
    }
    return await runCron()
  }

  // ─── User-authenticated modes ───────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization' }, 401)

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Invalid JWT' }, 401)
  const userId = userData.user.id

  const { settings, picks, error } = await loadDigest(supabase, userId)
  if (error) return json({ error }, 500)

  if (body.preview === true) {
    return json(
      {
        html: buildEmailHtml(picks),
        count: picks.length,
        picked: picks.map((p) => ({
          id: p.id,
          handle: p.handle,
          score: p.score_overall,
        })),
      },
      200
    )
  }

  // Test send.
  return await sendDigest(supabase, settings, picks, { mark: body.mark !== false })
})

// ─── Loaders ────────────────────────────────────────────────────────────────

async function loadDigest(
  supabase: SupabaseClient,
  userId: string
): Promise<{ settings: SettingsRow; picks: CreatorRow[]; error?: string }> {
  const { data: settings, error: settingsErr } = await supabase
    .from('user_settings')
    .select(
      'user_id, icp_description, recipient_email, digest_size, daily_send_enabled, daily_send_hour'
    )
    .eq('user_id', userId)
    .single<SettingsRow>()

  if (settingsErr || !settings) {
    return {
      settings: {} as SettingsRow,
      picks: [],
      error: settingsErr?.message ?? 'Could not load settings',
    }
  }

  const { data: picks, error: picksErr } = await supabase
    .from('creators')
    .select(
      'id, handle, display_name, platform, follower_count, engagement_rate, niche, bio, ai_reasoning, profile_url, score_overall'
    )
    .not('score_overall', 'is', null)
    .eq('status', 'pending')
    .is('included_in_digest_at', null)
    .order('score_overall', { ascending: false })
    .limit(settings.digest_size)
    .returns<CreatorRow[]>()

  if (picksErr) {
    return { settings, picks: [], error: picksErr.message }
  }

  return { settings, picks: picks ?? [] }
}

// ─── Senders ────────────────────────────────────────────────────────────────

async function sendDigest(
  supabase: SupabaseClient,
  settings: SettingsRow,
  picks: CreatorRow[],
  opts: { mark: boolean }
): Promise<Response> {
  if (!RESEND_API_KEY) {
    return json(
      { error: 'RESEND_API_KEY not set. Run `supabase secrets set RESEND_API_KEY=...`.' },
      500
    )
  }
  if (!settings.recipient_email) {
    return json({ error: 'recipient_email is empty in /settings' }, 400)
  }
  if (picks.length === 0) {
    return json({ sent: false, reason: 'No Creators ready to digest' }, 200)
  }

  const resend = new Resend(RESEND_API_KEY)
  const subject = `Vetly · ${picks.length} top pick${picks.length === 1 ? '' : 's'}`
  const html = buildEmailHtml(picks)

  const result = await resend.emails.send({
    from: FROM,
    to: settings.recipient_email,
    subject,
    html,
  })

  if (result.error) {
    return json(
      {
        error: `Resend: ${result.error.message ?? JSON.stringify(result.error)}`,
        resend_error: result.error,
      },
      500
    )
  }

  let marked = 0
  if (opts.mark) {
    const ids = picks.map((p) => p.id)
    const { error: markErr } = await supabase
      .from('creators')
      .update({ included_in_digest_at: new Date().toISOString() })
      .in('id', ids)
    if (markErr) {
      // The send already succeeded; report the mark failure but don't 500.
      return json(
        {
          message_id: result.data?.id,
          sent_to: settings.recipient_email,
          picked: picks.length,
          marked: 0,
          mark_error: markErr.message,
        },
        200
      )
    }
    marked = ids.length
  }

  return json(
    {
      message_id: result.data?.id,
      sent_to: settings.recipient_email,
      picked: picks.length,
      marked,
    },
    200
  )
}

async function runCron(): Promise<Response> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const currentHour = new Date().getUTCHours()

  const { data: enabled, error: enabledErr } = await admin
    .from('user_settings')
    .select(
      'user_id, icp_description, recipient_email, digest_size, daily_send_enabled, daily_send_hour'
    )
    .eq('daily_send_enabled', true)
    .eq('daily_send_hour', currentHour)
    .returns<SettingsRow[]>()

  if (enabledErr) {
    return json({ error: enabledErr.message }, 500)
  }
  if (!enabled || enabled.length === 0) {
    return json({ users_processed: 0, sent: 0, skipped_empty: 0, errored: 0, hour: currentHour }, 200)
  }

  let sent = 0
  let skippedEmpty = 0
  let errored = 0

  for (const settings of enabled) {
    try {
      const { picks } = await loadDigestForUser(admin, settings.user_id, settings.digest_size)
      if (picks.length === 0) {
        skippedEmpty++
        continue
      }
      const result = await sendDigest(admin, settings, picks, { mark: true })
      if (result.status >= 400) {
        errored++
      } else {
        sent++
      }
    } catch (_e) {
      errored++
    }
  }

  return json(
    {
      users_processed: enabled.length,
      sent,
      skipped_empty: skippedEmpty,
      errored,
      hour: currentHour,
    },
    200
  )
}

// Cron-mode picks loader: same query but without RLS (admin client).
async function loadDigestForUser(
  admin: SupabaseClient,
  userId: string,
  digestSize: number
): Promise<{ picks: CreatorRow[] }> {
  const { data: picks } = await admin
    .from('creators')
    .select(
      'id, handle, display_name, platform, follower_count, engagement_rate, niche, bio, ai_reasoning, profile_url, score_overall'
    )
    .eq('user_id', userId)
    .not('score_overall', 'is', null)
    .eq('status', 'pending')
    .is('included_in_digest_at', null)
    .order('score_overall', { ascending: false })
    .limit(digestSize)
    .returns<CreatorRow[]>()

  return { picks: picks ?? [] }
}

// ─── HTML email template ────────────────────────────────────────────────────
//
// Editorial dark palette mirrored from the app's design tokens:
//   --ink:    #0F0F0E   bg
//   --ink-3:  #232326   divider
//   --paper:  #F5F1E8   text
//   --paper-mute: #A8A39A
//   --lime:   #D4F04A   score badge + accent links
//
// Tables for layout, inline styles only, web fonts loaded via Google Fonts
// link with system fallbacks per family.

function buildEmailHtml(picks: CreatorRow[]): string {
  const date = new Date()
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const headerSection = `
<tr><td style="padding-bottom:32px;">
  <p style="margin:0;color:#A8A39A;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Vetly</p>
  <h1 style="margin:8px 0 0 0;color:#F5F1E8;font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-weight:400;font-size:36px;line-height:1.1;letter-spacing:-0.01em;">Today's top picks.</h1>
  <p style="margin:12px 0 0 0;color:#A8A39A;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;">${escapeHtml(dateStr)} &middot; ${picks.length} Creator${picks.length === 1 ? '' : 's'} ready for review</p>
</td></tr>`

  const creatorsSection = picks.map(creatorHtml).join('')

  const emptySection =
    picks.length === 0
      ? `<tr><td style="padding:32px 0;border-top:1px solid #232326;">
  <p style="margin:0;color:#A8A39A;font-family:'Instrument Serif',Georgia,serif;font-style:italic;font-size:18px;">No Creators ready for review today.</p>
</td></tr>`
      : ''

  const footerSection = `
<tr><td style="padding:32px 0 0 0;border-top:1px solid #232326;">
  <p style="margin:0;color:#A8A39A;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;">Vetly &middot; daily digest</p>
</td></tr>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="dark only">
<meta name="supported-color-schemes" content="dark">
<title>Vetly &middot; Today's top picks</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap">
</head>
<body style="margin:0;padding:0;background:#0F0F0E;color:#F5F1E8;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0F0F0E;">
  <tr>
    <td align="center" style="padding:48px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        ${headerSection}
        ${creatorsSection}
        ${emptySection}
        ${footerSection}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

function creatorHtml(c: CreatorRow): string {
  const score = c.score_overall ?? '-'
  const handle = escapeHtml(c.handle)
  const display = c.display_name ? escapeHtml(c.display_name) : ''
  const platform = capitalize(c.platform ?? '')
  const followers = c.follower_count != null ? formatCount(c.follower_count) + ' followers' : ''
  const er =
    c.engagement_rate != null ? (c.engagement_rate * 100).toFixed(2) + '% ER' : ''
  const niche = c.niche ? escapeHtml(c.niche) : ''
  const reasoning = c.ai_reasoning ? escapeHtml(c.ai_reasoning) : ''
  const url = safeUrl(c.profile_url)

  // Each meta part is either a fixed-vocabulary string (platform), a numeric
  // formatter output (followers, er), or pre-escaped user content (niche).
  // Joining and emitting directly is safe; do NOT wrap in escapeHtml again.
  const metaParts = [platform, followers, er, niche].filter(Boolean)
  const metaLine = metaParts.join(' · ')

  return `
<tr><td style="padding:24px 0;border-top:1px solid #232326;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td valign="top" style="padding-right:16px;width:64px;">
        <span style="display:inline-block;background:#D4F04A;color:#0F0F0E;font-family:'JetBrains Mono','Courier New',monospace;font-weight:500;font-size:14px;padding:6px 10px;border-radius:4px;line-height:1;">${score}</span>
      </td>
      <td valign="top">
        <p style="margin:0;color:#F5F1E8;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;font-size:18px;font-weight:600;line-height:1.2;">@${handle}</p>
        ${display ? `<p style="margin:2px 0 0 0;color:#A8A39A;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;">${display}</p>` : ''}
        ${metaLine ? `<p style="margin:8px 0 0 0;color:#A8A39A;font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;">${metaLine}</p>` : ''}
        ${reasoning ? `<p style="margin:14px 0 0 0;color:#F5F1E8;font-family:'Instrument Serif',Georgia,serif;font-style:italic;font-size:16px;line-height:1.5;">${reasoning}</p>` : ''}
        ${url ? `<p style="margin:12px 0 0 0;"><a href="${url}" style="color:#D4F04A;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;text-decoration:none;">Open profile &rarr;</a></p>` : ''}
      </td>
    </tr>
  </table>
</td></tr>`
}

// ─── helpers ────────────────────────────────────────────────────────────────

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeUrl(url: string | null | undefined): string {
  if (!url) return ''
  const trimmed = String(url).trim()
  if (!/^https?:\/\//i.test(trimmed)) return ''
  return trimmed.replace(/"/g, '%22')
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}
