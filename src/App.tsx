import { Route, Routes } from 'react-router-dom'
import AuthPage from '@/pages/Auth'
import DashboardPage from '@/pages/Dashboard'
import ImportPage from '@/pages/Import'
import SettingsPage from '@/pages/Settings'
import { ProtectedRoute } from '@/components/ProtectedRoute'

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
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
