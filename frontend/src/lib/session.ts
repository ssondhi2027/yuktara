// The signed-in user, for code outside React. Set by lib/auth.ts.
// Also whether this is a guest session (lib/guest.ts): a guest's data stays on
// the device and nothing may reach Supabase or the backend (lib/supabase.ts and
// lib/backend.ts check isGuest() before every use).
import type { AuthUser } from './auth'

let current: AuthUser | null = null
export const getCurrentUser = () => current
export const setCurrentUser = (u: AuthUser | null) => { current = u }

/** Remembers that the device is in a guest session, so a reload stays a guest without asking Supabase. */
export const GUEST_SESSION_KEY = 'yuktara.guest.session'

function readGuestFlag(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(GUEST_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

let guest = readGuestFlag()

/** True while the app runs as a guest (no account; local data only). */
export const isGuest = () => guest

export function setGuest(on: boolean) {
  guest = on
  try {
    if (on) localStorage.setItem(GUEST_SESSION_KEY, '1')
    else localStorage.removeItem(GUEST_SESSION_KEY)
  } catch {
    /* storage blocked: the guest session lasts for this page only */
  }
}

/** Thrown when guest mode tries to reach Supabase or the backend: a bug, never expected. */
export class GuestBoundaryError extends Error {
  constructor(what: string) {
    super(`Guest mode must not use ${what}: a guest's data stays on this device.`)
    this.name = 'GuestBoundaryError'
  }
}

/** Refuses (loudly in development) when a guest session reaches for `what`. */
export function assertNotGuest(what: string) {
  if (!guest) return
  const err = new GuestBoundaryError(what)
  if (import.meta.env?.DEV) console.error(err)
  throw err
}
