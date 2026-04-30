import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { useAuth } from '@/lib/auth'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center">
        <Loader2 className="size-5 animate-spin text-paper-mute" />
      </main>
    )
  }

  if (!session) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      {children}
    </div>
  )
}
