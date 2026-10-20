import { useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'
import { Smartphone, Trash2, UserPlus } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { leaveGuest } from '@/lib/auth'
import { guestStore } from '@/lib/guestStore'
import { Sheet } from '@/components/ui/Sheet'
import './guest.css'

/** True in a guest session (no account; data on this device only). */
export const useIsGuest = () => !!useAuth().user?.guest

/** 'not_kept' when the browser won't let us save (blocked or full storage): the data lasts for this visit only. */
export const useGuestSaveStatus = () => useSyncExternalStore((cb) => guestStore.subscribe(cb), () => guestStore.status, () => 'saved' as const)

/** Leaves guest mode (keeping the data on this device) and opens Create account. */
export function useCreateAccount() {
  const navigate = useNavigate()
  return () => {
    leaveGuest()
    navigate('/login', { replace: true, state: { tab: 'register' } })
  }
}

/** "Delete my data" / signing out of a guest session: confirms, then deletes everything on this device. */
export function GuestDeleteSheet({ onClose }: { onClose: () => void }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  return (
    <Sheet title="Delete your guest data?" onClose={onClose}>
      <p className="small">
        Everything you logged as a guest (meals, workouts, habits, weight, photos) is removed from this device, and you're signed out. This can't be undone.
      </p>
      <p className="xs muted">To keep using Yuktara with your data backed up, create an account instead.</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" disabled={busy}
          onClick={async () => { setBusy(true); await signOut(); navigate('/login', { replace: true }) }}>
          <Trash2 size={16} /> {busy ? 'Deleting…' : 'Delete and sign out'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  )
}

/** The guest-mode banner at the top of the client app. */
export function GuestBanner() {
  const status = useGuestSaveStatus()
  const createAccount = useCreateAccount()
  const [confirm, setConfirm] = useState(false)
  return (
    <section className={`guest-banner${status === 'not_kept' ? ' warn' : ''}`} role="note" aria-label="Guest mode">
      <Smartphone size={18} aria-hidden className="guest-banner-icon" />
      <div className="grow">
        <b className="small">Guest mode:</b> <span className="small">your data stays on this device only. It isn't backed up or synced.</span>
        {status === 'not_kept' && (
          <div className="xs guest-banner-warn">This browser isn't letting us save, so what you log now will be gone when you close this page.</div>
        )}
      </div>
      <div className="guest-banner-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={createAccount}><UserPlus size={15} /> Create an account</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(true)}>Delete my data</button>
      </div>
      {confirm && <GuestDeleteSheet onClose={() => setConfirm(false)} />}
    </section>
  )
}

/**
 * Where a coach or an account is needed (messages, check-ins, targets, meal
 * plans, programs): a friendly card instead of an error. `compact` fits inside
 * another card.
 */
export function GuestCard({ title = 'Create an account to work with a coach', text, compact }: { title?: string; text: string; compact?: boolean }) {
  const createAccount = useCreateAccount()
  return (
    <section className={compact ? 'guest-card compact' : 'card guest-card'}>
      <span className="guest-card-icon" aria-hidden><UserPlus size={compact ? 16 : 20} /></span>
      <div className="grow stack" style={{ gap: 6 }}>
        <b className={compact ? 'small' : undefined}>{title}</b>
        <p className="small muted" style={{ margin: 0 }}>{text}</p>
        <button type="button" className={`btn ${compact ? 'btn-ghost btn-sm' : 'btn-primary'}`} style={{ alignSelf: 'flex-start' }} onClick={createAccount}>
          Create an account
        </button>
      </div>
    </section>
  )
}

/** A whole page that needs an account (Messages, Check-in). */
export function GuestPage({ title, text }: { title: string; text: string }) {
  return (
    <div className="page">
      <header className="page-head"><div><h1>{title}</h1></div></header>
      <GuestCard text={text} />
    </div>
  )
}
