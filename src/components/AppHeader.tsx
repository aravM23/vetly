import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

const links = [
  { to: '/', label: 'Discover', end: true },
  { to: '/shortlist', label: 'Club Stanley', end: false },
] as const

export function AppHeader() {
  return (
    <header className="border-b border-ink-3">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-8 py-4">
        <div className="flex items-center gap-8">
          <p className="font-display text-xl text-paper">Vetly</p>
          <nav className="flex items-center gap-1">
            {links.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'smallcaps px-3 py-1.5 transition',
                    isActive ? 'text-paper' : 'text-paper-mute hover:text-paper'
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </header>
  )
}
