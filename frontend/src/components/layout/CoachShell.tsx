import { NavLink, Outlet } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck, Dumbbell, LayoutGrid, MessageSquare, Salad, Settings, SlidersHorizontal, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/app/auth'
import { LogoMark, Wordmark } from '@/components/ui/Logo'
import { ProfileMenu } from './ProfileMenu'
import './shell.css'

/**
 * Coach admin frame (forest sidebar).
 *  desktop — full sidebar with counts
 *  tablet  — icon rail
 *  phone   — dark bottom bar: Dashboard, Clients, Check-ins, Messages, More
 */
export function CoachShell() {
  const { data } = useQuery({ queryKey: ['coach-dashboard'], queryFn: api.coachDashboard })
  const waiting = data?.stats.waiting ?? 0
  const unread = 2
  // The signed-in coach, not the demo data.
  const { user } = useAuth()

  const NAV = [
    { to: '/coach', end: true, icon: LayoutGrid, label: 'Dashboard', rail: true },
    { to: '/coach/clients', icon: Users, label: 'Clients', rail: true },
    { to: '/coach/check-ins', icon: ClipboardCheck, label: 'Check-ins', count: waiting, gold: true, rail: true },
    { to: '/coach/programs', icon: Dumbbell, label: 'Programs', rail: true },
    { to: '/coach/nutrition', icon: Salad, label: 'Nutrition plans' },
    { to: '/coach/messages', icon: MessageSquare, label: 'Messages', count: unread, rail: true },
    { to: '/coach/settings', icon: SlidersHorizontal, label: 'Settings' },
  ]

  return (
    <div className="shell coach-shell">
      <aside className="side dark-side">
        <div className="side-brand">
          <span className="hide-desktop"><LogoMark size={44} tile={false} fg="#F3EFE4" /></span>
          <span className="only-desktop brand-row">
            <LogoMark size={34} tile={false} fg="#F3EFE4" />
            <span>
              <Wordmark height={15} color="#F3EFE4" />
              <span className="coach-badge">COACH</span>
            </span>
          </span>
        </div>
        <nav className="side-nav" aria-label="Coach">
          {NAV.map(({ to, icon: Icon, label, count, gold, rail, ...rest }) => (
            <NavLink key={to} to={to} end={'end' in rest} className={`side-link${rail ? '' : ' only-desktop'}`} title={label}>
              <Icon size={20} strokeWidth={1.8} />
              <span className="only-desktop grow">{label}</span>
              {!!count && <span className={`badge only-desktop${gold ? '' : ' muted-badge'}`}>{count}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          {user && (
            <div className="row">
              <ProfileMenu align="left" direction="up" className="avatar gold" />
              <div className="only-desktop">
                <b className="small">{user.first_name || user.full_name}</b>
                <div className="xs" style={{ opacity: 0.7 }}>Coach · admin</div>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Phones have no sidebar: the account menu (and Log out) sits in a top bar. */}
      <header className="coach-topbar">
        <span className="row" style={{ gap: 8 }}>
          <LogoMark size={30} tile={false} fg="#F3EFE4" />
          <span className="coach-badge">COACH</span>
        </span>
        <ProfileMenu className="avatar gold sm" />
      </header>

      <main className="shell-main">
        <Outlet />
      </main>

      <nav className="bottom-nav dark" aria-label="Coach">
        {[
          { to: '/coach', end: true, icon: LayoutGrid, label: 'Dashboard' },
          { to: '/coach/clients', icon: Users, label: 'Clients' },
          { to: '/coach/check-ins', icon: ClipboardCheck, label: 'Check-ins' },
          { to: '/coach/messages', icon: MessageSquare, label: 'Messages' },
          { to: '/coach/settings', icon: Settings, label: 'More' },
        ].map(({ to, icon: Icon, label, ...rest }) => (
          <NavLink key={to} to={to} end={'end' in rest} className="tab">
            <span className="tab-icon"><Icon size={22} strokeWidth={1.8} /></span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
