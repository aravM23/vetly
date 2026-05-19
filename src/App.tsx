import { Route, Routes } from 'react-router-dom'
import AuthPage from '@/pages/Auth'
import DashboardPage from '@/pages/Dashboard'
import DigestPage from '@/pages/Digest'
import DiscoverPage from '@/pages/Discover'
import ImportPage from '@/pages/Import'
import SettingsPage from '@/pages/Settings'
import SourcingPage from '@/pages/Sourcing'
import TrackedPage from '@/pages/Tracked'
import { ProtectedRoute } from '@/components/ProtectedRoute'

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      {/*
        Discovery is intentionally a public route so the Stan FastAPI demo
        works without needing Supabase credentials configured. The page talks
        to the local FastAPI backend at /api (proxied by Vite).
      */}
      <Route path="/discover" element={<DiscoverPage />} />
      {/* Sourcing metrics — public so it works without Supabase auth */}
      <Route path="/sourcing" element={<SourcingPage />} />
      {/* Tracked creators — destination of every Discover -> Approve action */}
      <Route path="/tracked" element={<TrackedPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/import"
        element={
          <ProtectedRoute>
            <ImportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/digest"
        element={
          <ProtectedRoute>
            <DigestPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center">
      <p className="font-display text-3xl text-paper">404</p>
    </main>
  )
}
