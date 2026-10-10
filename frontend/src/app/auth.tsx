import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { consumeAuthRedirect, loadUser, onAuthChange, signOut as doSignOut, type AuthUser, type RedirectNotice } from '@/lib/auth'
import { PageLoading } from '@/components/ui/Loading'
import type { UnitSystem } from '@/types/db'

interface AuthState {
  status: 'loading' | 'ready'
  user: AuthUser | null
  error: unknown
  /** Message from an email link this page was opened with (confirmed, expired…). */
  notice: RedirectNotice | null
  clearNotice: () => void
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [state, setState] = useState<Pick<AuthState, 'status' | 'user' | 'error'>>({ status: 'loading', user: null, error: null })
  const [notice, setNotice] = useState<RedirectNotice | null>(null)

  const refresh = useCallback(async () => {
    try {
      const user = await loadUser()
      setState({ status: 'ready', user, error: null })
    } catch (error) {
      setState({ status: 'ready', user: null, error })
    }
    qc.invalidateQueries() // names and data depend on who is signed in
  }, [qc])

  useEffect(() => {
    let cancelled = false
    let off = () => {}
    // Read a confirm-email link first so the session it carries is in place
    // before the first user load (pending setup answers then save).
    consumeAuthRedirect()
      .catch(() => null)
      .then((n) => {
        if (cancelled) return
        setNotice(n)
        refresh()
        off = onAuthChange(() => { refresh() })
      })
    return () => {
      cancelled = true
      off()
    }
  }, [refresh])

  const signOut = useCallback(async () => {
    await doSignOut()
    qc.clear()
  }, [qc])

  const clearNotice = useCallback(() => setNotice(null), [])
  return <AuthContext.Provider value={{ ...state, notice, clearNotice, refresh, signOut }}>{children}</AuthContext.Provider>
}

/** The signed-in user's kg/lb choice (pounds until they pick). */
export function useUnits(): UnitSystem {
  return useContext(AuthContext)?.user?.units ?? 'imperial'
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>')
  return ctx
}

/** Where each role lives. */
export const homeFor = (role: AuthUser['role']) => (role === 'coach' ? '/coach' : '/')

/** True when `path` belongs to the app for `role` (coach: /coach…, client: everything else). */
export const pathFitsRole = (path: string, role: AuthUser['role']) =>
  (path === '/coach' || path.startsWith('/coach/')) === (role === 'coach')

/**
 * Gate for the client and coach apps, in every mode. Signed-out people go to
 * /login; a client opening /coach… goes to /, a coach opening a client page
 * goes to /coach; clients who haven't finished setup go back to the setup
 * window. This is for convenience only: RLS and the backend's coach checks
 * are what actually protect coach data.
 */
export function RequireAuth({ role, children }: { role: 'client' | 'coach'; children: ReactNode }) {
  const { status, user } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <PageLoading />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />
  if (user.role === 'client' && !user.setupDone) return <Navigate to="/login" replace />
  return <>{children}</>
}
