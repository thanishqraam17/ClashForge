import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  History,
  Home,
  ScanLine,
  Settings,
  TrendingUp
} from 'lucide-react'

const navItems: Array<{
  to: string
  label: string
  icon: typeof Home
  end?: boolean
}> = [
  { to: '/', label: 'Overview', icon: Home, end: true },
  { to: '/scan', label: 'Scan Village', icon: ScanLine },
  { to: '/upgrades', label: 'Upgrades', icon: TrendingUp },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings }
]

export function AppShell(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border-subtle bg-surface-1">
        <div className="flex h-12 items-center border-b border-border-subtle px-4">
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            ClashForge
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Main">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted transition-colors',
                  isActive
                    ? 'bg-surface-2 text-foreground'
                    : 'hover:bg-surface-2/60 hover:text-foreground'
                )
              }
            >
              <Icon className="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border-subtle p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Data status
          </p>
          <p className="mt-0.5 text-xs text-foreground/90">Local data</p>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            Your village data is stored locally on this device.
          </p>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
