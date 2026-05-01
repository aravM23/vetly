import { supabase } from './supabase'

export type ScoringResult = {
  scored: number
  errored: number
  total: number
}

// Calls the score-creators Edge Function with the user's JWT. The function
// runs synchronously: it returns counts when every chunk has been processed.
// Network timeout is whatever the platform allows; partial scoring is
// preserved row-by-row, so a timeout still leaves successfully-scored rows
// in place.
export async function triggerScoring(): Promise<ScoringResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch(`${supabaseUrl}/functions/v1/score-creators`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  })

  const body = (await res.json().catch(() => null)) as
    | ScoringResult
    | { error: string }
    | null

  if (!res.ok || !body || 'error' in body) {
    const msg = body && 'error' in body ? body.error : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body
}
