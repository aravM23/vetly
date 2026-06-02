import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

const links = [
  { to: '/', label: 'Club Stanley', end: true },
  { to: '/partnerships', label: 'Partnerships', end: false },
] as const

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-3 bg-ink/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3 sm:px-10">
        <div className="flex items-center gap-3">
          <img
            src="/stanley-mascot.png"
            alt="Stanley"
            className="size-10 object-contain drop-shadow-[0_0_22px_rgba(167,139,250,0.55)]"
          />
          <p className="font-display text-2xl tracking-tight text-paper">
            Vetly
          </p>
          <span className="ml-1 hidden text-xs text-paper-mute sm:inline">
            sourcing for Stanley
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {links.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'rounded-full px-4 py-1.5 text-sm font-semibold transition',
                  isActive
                    ? 'bg-lime/[0.14] text-lime'
                    : 'text-paper-mute hover:bg-ink-2 hover:text-paper'
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  )
}
