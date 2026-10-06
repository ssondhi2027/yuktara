import { useEffect, useState } from 'react'
import { resendConfirmation } from '@/lib/auth'

const WAIT_SECONDS = 60
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * "Resend link" for the sign-up confirmation email. After a send it waits
 * 60 seconds before it can be pressed again (Supabase limits resends too).
 */
export function ResendLink({ email, className }: { email: string; className?: string }) {
  const [left, setLeft] = useState(0)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [left])

  const resend = async () => {
    setError(null)
    if (!EMAIL_RE.test(email.trim())) return setError('Enter your email above first.')
    setBusy(true)
    try {
      await resendConfirmation(email.trim())
      setSent(true)
      setLeft(WAIT_SECONDS)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the link. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`resend ${className ?? ''}`}>
      <button type="button" className="auth-btn outline resend-btn" disabled={busy || left > 0} onClick={resend}>
        {busy ? 'Sending…' : left > 0 ? `Resend link (${left}s)` : 'Resend link'}
      </button>
      {sent && !error && <div role="status" className="auth-note ok">Link sent. Check your inbox and spam folder.</div>}
      {error && <div role="alert" className="auth-note err">{error}</div>}
    </div>
  )
}
