import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemePref } from '@/app/hooks'
import { useAuth } from '@/app/auth'

/** Avatar button for the signed-in person: who they are, theme, log out. */
export function ProfileMenu({
  align = 'right', direction = 'down', className = 'avatar',
}: {
  align?: 'left' | 'right'
  direction?: 'up' | 'down'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useTheme()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  if (!user) return null

  const opts: { v: ThemePref; icon: React.ReactNode; label: string }[] = [
    { v: 'system', icon: <Monitor size={16} />, label: 'Auto' },
    { v: 'light', icon: <Sun size={16} />, label: 'Light' },
    { v: 'dark', icon: <Moon size={16} />, label: 'Dark' },
  ]

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Account: ${user.full_name || user.email}`} onClick={() => setOpen((o) => !o)}>
        {user.initials}
      </button>
      {open && (
        <div className={`menu menu-${align} menu-${direction}`} role="menu">
          <div className="menu-who">
            <b className="truncate">{user.full_name || user.email}</b>
            <span className="xs muted truncate">{user.role === 'coach' ? 'Coach' : user.email}</span>
          </div>
          <div className="eyebrow">Appearance</div>
          <div className="seg light block" role="group" aria-label="Theme">
            {opts.map((o) => (
              <button key={o.v} type="button" aria-pressed={theme === o.v} onClick={() => setTheme(o.v)} title={o.label}>
                {o.icon}
                <span className="sr-only">{o.label}</span>
              </button>
            ))}
          </div>
          <button role="menuitem" type="button" className="menu-item"
            onClick={async () => { setOpen(false); await signOut(); navigate('/login', { replace: true }) }}>
            <LogOut size={16} /> Log out
          </button>
        </div>
      )}
    </div>
  )
}
