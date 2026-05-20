/**
 * Two pages, no auth. That's it.
 *
 *   /           → Discover: Run sourcing + browse candidates + shortlist them.
 *   /shortlist  → Club Stanley: the editorial cohort dashboard.
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
        <Route path="/" element={<DiscoverPage />} />
        <Route path="/shortlist" element={<ShortlistPage />} />
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
