import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

// Grouped nav: each program gets its own Discover + Shortlist pair.
const groups = [
  {
    label: 'Club Stanley',
    links: [
      { to: '/', label: 'Discover', end: true },
      { to: '/shortlist', label: 'Cohort', end: false },
    ],
  },
  {
    label: 'Ambassadors',
    links: [
      { to: '/ambassadors', label: 'Discover', end: true },
      { to: '/ambassadors/shortlist', label: 'Cohort', end: false },
    ],
  },
] as const

export function AppHeader() {
  return (
    <header className="border-b border-ink-3">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-8 py-4">
        <div className="flex items-center gap-8">
          <p className="font-display text-xl text-paper">Vetly</p>
          <nav className="flex items-center gap-6">
            {groups.map((g) => (
              <div key={g.label} className="flex items-center gap-2">
                <span className="smallcaps text-paper-mute pr-1 border-r border-ink-3">
                  {g.label}
                </span>
                {g.links.map(({ to, label, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        'smallcaps px-2 py-1 transition',
                        isActive
                          ? 'text-lime'
                          : 'text-paper-mute hover:text-paper'
                      )
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </div>
      </div>
    </header>
  )
}
