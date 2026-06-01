/**
 * Four routes, two programs, no auth.
 *
 * Club Stanley (incubator for emerging social-media coaches):
 *   /                       → Discover candidates
 *   /shortlist              → Club Stanley cohort
 *
 * Stanley Ambassadors (channel-operator program):
 *   /ambassadors            → Discover candidates
 *   /ambassadors/shortlist  → Ambassador cohort
 *
 * Each program is its own user_id on the backend (1 = Club Stanley,
 * 2 = Ambassadors) with its own DiscoverySettings (ICP, hashtag seeds,
 * follower range) and its own LLM prompt set.
 */
import { Route, Routes } from 'react-router-dom'
import { AppHeader } from '@/components/AppHeader'
import DiscoverPage from '@/pages/Dashboard'
import ShortlistPage from '@/pages/Shortlist'

export default function App() {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <Routes>
        <Route path="/" element={<DiscoverPage program="club_stanley" />} />
        <Route path="/shortlist" element={<ShortlistPage program="club_stanley" />} />
        <Route path="/ambassadors" element={<DiscoverPage program="ambassador" />} />
        <Route
          path="/ambassadors/shortlist"
          element={<ShortlistPage program="ambassador" />}
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  )
}

function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center">
      <p className="font-display text-3xl text-paper">404</p>
    </main>
  )
}
