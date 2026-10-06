// The signed-in user, for code outside React. Set by lib/auth.ts.
import type { AuthUser } from './auth'

let current: AuthUser | null = null
export const getCurrentUser = () => current
export const setCurrentUser = (u: AuthUser | null) => { current = u }
