/**
 * Two routes, two programs, no auth.
 *
 *   /              → Club Stanley (incubator sourcing)
 *   /partnerships  → Stanley Partnerships (Ambassador sourcing)
 *
 * Both routes render the same ProgramPage component with a different
 * `program` prop. The backend uses user_id=1 for Club Stanley and
 * user_id=2 for Partnerships; each has its own DiscoverySettings,
 * ICP, and prompt set.
 */
import { Route, Routes } from 'react-router-dom'
import { AppHeader } from '@/components/AppHeader'
import ProgramPage from '@/pages/ProgramPage'

export default function App() {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <Routes>
        <Route path="/" element={<ProgramPage program="club_stanley" />} />
        <Route
          path="/partnerships"
          element={<ProgramPage program="ambassador" />}
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
