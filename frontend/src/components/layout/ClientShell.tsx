import { NavLink, Outlet } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck, Dumbbell, House, MessageSquare, Salad, TrendingUp } from 'lucide-react'
import { api } from '@/lib/api'
import { useUnreadMessages } from '@/features/messages/useUnreadMessages'
import { LogoMark, Wordmark } from '@/components/ui/Logo'
import { ProfileMenu } from './ProfileMenu'
import './shell.css'

const NAV = [
  { to: '/', end: true, icon: House, short: 'Home', long: 'Home' },
  { to: '/train', icon: Dumbbell, short: 'Train', long: 'Training' },
  { to: '/food', icon: Salad, short: 'Food', long: 'Food' },
  { to: '/check-in', icon: ClipboardCheck, short: 'Check-in', long: 'Check-ins', due: true },
  { to: '/progress', icon: TrendingUp, short: 'Progress', long: 'Progress' },
] as const

/**
 * Client app frame. One nav, three looks:
 *  phone  — bottom tab bar
 *  tablet — icon rail with labels (iPad artboard)
 *  desktop — full sidebar with wordmark, Messages and the coach card
 */
export function ClientShell() {
  const { data } = useQuery({ queryKey: ['client-home'], queryFn: api.clientHome })
  const due = data?.check_in.status === 'due'
  const me = data?.me
  const coach = data?.coach
  const unread = useUnreadMessages()

  return (
    <div className="shell client-shell">
      <aside className="side">
        <div className="side-brand">
          <LogoMark size={44} />
          <span className="only-desktop"><Wordmark height={17} color="var(--ink)" /></span>
        </div>
        <nav className="side-nav" aria-label="Main">
          {NAV.map(({ to, icon: Icon, short, long, ...rest }) => (
            <NavLink key={to} to={to} end={'end' in rest} className="side-link">
              <Icon size={20} strokeWidth={1.8} />
              <span className="hide-desktop">{short}</span>
              <span className="only-desktop grow">{long}</span>
              {'due' in rest && due && <span className="pill warn xs only-desktop">Due</span>}
            </NavLink>
          ))}
          <NavLink to="/messages" className="side-link" aria-label={unread ? `Messages, ${unread} unread` : undefined}>
            <span className="side-icon">
              <MessageSquare size={20} strokeWidth={1.8} />
              {unread > 0 && <span className="unread-dot hide-desktop" />}
            </span>
            <span className="hide-desktop">Messages</span>
            <span className="only-desktop grow">Messages</span>
            {unread > 0 && <span className="badge only-desktop">{unread}</span>}
          </NavLink>
        </nav>
        <div className="side-foot">
          {coach && (
            <div className="coach-card only-desktop">
              <span className="avatar sm" style={{ background: 'var(--forest)', color: 'var(--gold)' }}>{coach.initials}</span>
              <div className="grow">
                <b className="small">{coach.first_name}</b>
                <div className="xs muted">Your coach · replies within a day</div>
              </div>
            </div>
          )}
          <div className="me-row">
            {me && <ProfileMenu align="left" direction="up" />}
            {me && <span className="only-desktop small truncate"><b>{me.full_name}</b></span>}
          </div>
        </div>
      </aside>

      <main className="shell-main">
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="Main">
        {NAV.map(({ to, icon: Icon, short, ...rest }) => (
          <NavLink key={to} to={to} end={'end' in rest} className="tab">
            <span className="tab-icon">
              <Icon size={22} strokeWidth={1.8} />
              {'due' in rest && due && <span className="tab-dot" aria-label="due" />}
            </span>
            <span>{short}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
