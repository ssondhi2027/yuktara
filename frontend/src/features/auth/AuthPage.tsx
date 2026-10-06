import { useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import { Eye, EyeOff } from 'lucide-react'
import { homeFor, pathFitsRole, useAuth } from '@/app/auth'
import { AuthError, DEMO_COACH_EMAIL, sendPasswordReset, signIn, signInWithGoogle, signUp } from '@/lib/auth'
import { isDemo } from '@/lib/supabase'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { PageLoading } from '@/components/ui/Loading'
import { ResendLink } from './ResendLink'
import { SetupSheet } from './SetupSheet'
import './auth.css'

type Tab = 'login' | 'register'

// Google sign-in is off by default so every account confirms a real email address.
const GOOGLE_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE === 'true'

/**
 * Launch screen: Log in / Create account. After sign-up, or when a signed-in
 * client hasn't finished setup, the profile setup window opens on top.
 */
export function AuthPage() {
  const { status, user, notice } = useAuth()
  const location = useLocation()
  const [tab, setTab] = useState<Tab>('login')
  // Set right after Create account, so the sheet can say "Account created for …".
  const [justCreated, setJustCreated] = useState<{ email: string; confirm: boolean } | null>(null)
  // Keeps the sheet up for "You're all set" after setup saves and the user becomes complete.
  const [holdSheet, setHoldSheet] = useState(false)

  if (status === 'loading') return <PageLoading />
  if (user && !holdSheet && (user.role === 'coach' || user.setupDone)) {
    // Go back to the page they asked for only if it belongs to their app.
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && pathFitsRole(from, user.role) ? from : homeFor(user.role)} replace />
  }

  // The setup window is for clients only; coaches never see it.
  const sheetOpen = holdSheet || !!justCreated || (user?.role === 'client' && !user.setupDone)

  return (
    <div className="auth-page">
      <main className="auth-card" aria-hidden={sheetOpen || undefined}>
        <header className="auth-brand">
          <BrandLogo size={76} />
          <h1>Yuktara</h1>
          <p className="muted">Strong weeks, well fed.</p>
        </header>

        <div className="auth-tabs" role="tablist" aria-label="Log in or create an account">
          <button type="button" role="tab" aria-selected={tab === 'login'} onClick={() => setTab('login')}>Log in</button>
          <button type="button" role="tab" aria-selected={tab === 'register'} onClick={() => setTab('register')}>Create account</button>
        </div>

        {tab === 'login'
          ? <LoginForm onRegister={() => setTab('register')} />
          : <RegisterForm onCreated={(email, confirm) => setJustCreated({ email, confirm })} onLogin={() => setTab('login')} />}

        {isDemo && (
          <div className="auth-demo xs muted">
            <p>Demo: log in as <b>{DEMO_COACH_EMAIL}</b> to see the coach app.</p>
            <p>No Supabase keys are set, so nothing leaves this browser.</p>
          </div>
        )}
      </main>

      {sheetOpen && (
        <SetupSheet
          email={justCreated?.email ?? user?.email ?? ''}
          fullName={user?.full_name ?? ''}
          coachFirstName={user?.coachFirstName ?? null}
          justCreated={!!justCreated}
          justConfirmed={!!notice?.confirmed}
          needsConfirm={justCreated?.confirm ?? false}
          onSaving={() => setHoldSheet(true)}
          onClose={() => { setHoldSheet(false); setJustCreated(null) }}
        />
      )}
    </div>
  )
}

function PasswordInput({ value, onChange, autoComplete, id, show, onToggle, invalid }: {
  value: string
  onChange: (v: string) => void
  autoComplete: string
  id: string
  show: boolean
  onToggle: () => void
  invalid?: boolean
}) {
  return (
    <span className="pw-wrap">
      <input id={id} className="auth-input" type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value}
        aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="pw-toggle" aria-label={show ? 'Hide password' : 'Show password'} onClick={onToggle}>
        {show ? <EyeOff size={20} /> : <Eye size={20} />}
      </button>
    </span>
  )
}

function LoginForm({ onRegister }: { onRegister: () => void }) {
  const { refresh, notice, clearNotice } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setUnconfirmed(false)
    if (!email.trim() || !password) return setError('Enter your email and password.')
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      clearNotice()
      await refresh()
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.')
      setUnconfirmed(err instanceof AuthError && err.code === 'unconfirmed')
    } finally {
      setBusy(false)
    }
  }

  const forgot = async () => {
    setError(null)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError('Enter your email above first.')
    try {
      await sendPasswordReset(email.trim())
      setResetSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link.')
    }
  }

  const google = async () => {
    setError(null)
    try {
      await signInWithGoogle()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    }
  }

  return (
    <form className="auth-form" aria-label="Log in" onSubmit={submit} noValidate>
      {notice && !notice.confirmed && (
        <div role={notice.tone === 'err' ? 'alert' : 'status'} className={`auth-note ${notice.tone}`}>{notice.text}</div>
      )}
      <label className="auth-label" htmlFor="li-email">Email
        <input id="li-email" className="auth-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="auth-label" htmlFor="li-pw">Password
        <PasswordInput id="li-pw" value={password} onChange={setPassword} autoComplete="current-password" show={show} onToggle={() => setShow((s) => !s)} />
      </label>
      <button type="button" className="auth-link forgot" onClick={forgot}>Forgot password?</button>
      {resetSent && <div role="status" className="auth-note ok">Reset link sent. Check your email.</div>}
      {error && <div role="alert" className="auth-note err">{error}</div>}
      {(unconfirmed || notice?.offerResend) && <ResendLink email={email} />}
      <button className="auth-btn primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      {GOOGLE_ENABLED && (
        <>
          <div className="auth-or"><span />or<span /></div>
          <button type="button" className="auth-btn outline" onClick={google}>
            <GoogleG /> Continue with Google
          </button>
        </>
      )}
      <p className="auth-switch">New to Yuktara? <button type="button" className="auth-link strong" onClick={onRegister}>Create an account</button></p>
    </form>
  )
}

function strength(pw: string) {
  let score = 0
  if (pw.length >= 8) score++
  if (/[0-9]/.test(pw) && /[A-Za-z]/.test(pw)) score++
  if (pw.length >= 12 || /[^A-Za-z0-9]/.test(pw)) score++
  if (pw.length < 8) score = Math.min(score, pw.length ? 1 : 0)
  const label = !pw.length ? 'At least 8 characters' : ['Too short', 'Weak', 'Good', 'Strong'][score]
  return { score, label, tone: pw.length ? (['', 'bad', 'mid', 'good'] as const)[score] : '' }
}

function RegisterForm({ onCreated, onLogin }: { onCreated: (email: string, confirm: boolean) => void; onLogin: () => void }) {
  const { refresh } = useAuth()
  const [f, setF] = useState({ name: '', email: '', password: '', invite: '' })
  const [terms, setTerms] = useState(false)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<Partial<Record<'name' | 'email' | 'pw' | 'terms' | 'exists' | 'invite' | 'other', string>>>({})
  const s = strength(f.password)
  const set = (k: keyof typeof f) => (v: string) => {
    setF((x) => ({ ...x, [k]: v }))
    setErr((e) => {
      const n = { ...e }
      delete n.other
      delete n[k === 'password' ? 'pw' : k === 'invite' ? 'invite' : k]
      if (k === 'email') delete n.exists
      return n
    })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next: typeof err = {}
    if (!f.name.trim()) next.name = 'Enter your full name.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) next.email = 'Enter a valid email address.'
    if (f.password.length < 8) next.pw = 'Use at least 8 characters.'
    if (!terms) next.terms = 'Please accept the terms to continue.'
    setErr(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const result = await signUp({ name: f.name, email: f.email.trim(), password: f.password, invite: f.invite })
      onCreated(f.email.trim(), result === 'confirm_email')
      await refresh()
    } catch (e2) {
      if (e2 instanceof AuthError && (e2.code === 'exists' || e2.code === 'invite')) setErr({ [e2.code]: e2.message })
      else setErr({ other: e2 instanceof Error ? e2.message : 'Something went wrong. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="auth-form" aria-label="Create an account" onSubmit={submit} noValidate>
      <label className="auth-label" htmlFor="re-name">Full name
        <input id="re-name" className="auth-input" autoComplete="name" value={f.name} aria-invalid={!!err.name || undefined} onChange={(e) => set('name')(e.target.value)} />
      </label>
      {err.name && <span className="field-err">{err.name}</span>}

      <label className="auth-label" htmlFor="re-email">Email
        <input id="re-email" className="auth-input" type="email" autoComplete="email" value={f.email} aria-invalid={!!(err.email || err.exists) || undefined} onChange={(e) => set('email')(e.target.value)} />
      </label>
      {err.email && <span className="field-err">{err.email}</span>}

      <label className="auth-label" htmlFor="re-pw">Password
        <PasswordInput id="re-pw" value={f.password} onChange={set('password')} autoComplete="new-password" show={show} onToggle={() => setShow((v) => !v)} invalid={!!err.pw} />
      </label>
      <div className="pw-meter" aria-live="polite">
        <div className="pw-bars">{[0, 1, 2].map((i) => <i key={i} className={i < s.score ? s.tone : undefined} />)}</div>
        <span className={`pw-label ${s.tone}`}>{s.label}</span>
      </div>
      {err.pw && <span className="field-err">{err.pw}</span>}

      <label className="auth-label" htmlFor="re-invite">
        <span>Coach invite code <span className="auth-hint">Optional. Your coach links you with this.</span></span>
        <input id="re-invite" className="auth-input code" autoCapitalize="characters" spellCheck={false} value={f.invite} aria-invalid={!!err.invite || undefined} onChange={(e) => set('invite')(e.target.value)} />
      </label>
      {err.invite && <span className="field-err">{err.invite}</span>}

      <button type="button" role="checkbox" aria-checked={terms} className="auth-check" onClick={() => { setTerms(!terms); setErr(({ terms: _t, ...r }) => r) }}>
        <span className="box">{terms && <CheckMark />}</span>
        <span>I agree to the Terms and Privacy Policy. Only my coach can see my data.</span>
      </button>
      {err.terms && <span className="field-err">{err.terms}</span>}

      {err.exists && (
        <div role="alert" className="auth-note err">
          {err.exists} <button type="button" className="auth-link" onClick={onLogin}>Log in instead</button>
        </div>
      )}
      {err.other && <div role="alert" className="auth-note err">{err.other}</div>}

      <button className="auth-btn primary" disabled={busy}>{busy ? 'Creating your account…' : 'Create account'}</button>
    </form>
  )
}

export function CheckMark({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
