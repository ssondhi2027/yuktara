// Sign-up, log-in and profile setup.
//
// With Supabase configured this talks to Supabase Auth and the tables in
// supabase/migrations (see 0010_onboarding.sql). Without it, a small demo
// account lives in localStorage so the whole flow can be tried offline.

import type { BodyModel, ExerciseLevel, GoalType, UnitSystem } from '@/types/db'
import { DEMO_ACCOUNTS } from './demo'
import { setCurrentUser } from './session'
import { supabase } from './supabase'
import { lbToKg } from './units'

export type Role = 'client' | 'coach'

export interface AuthUser {
  id: string
  email: string
  full_name: string
  first_name: string
  initials: string
  role: Role
  setupDone: boolean
  coachFirstName: string | null
}

export interface SetupAnswers {
  date_of_birth: string
  body_model: BodyModel
  units: UnitSystem
  height: string // in the chosen units
  phone: string
  goal: GoalType
  weight: string
  goal_weight: string
  check_in_day: number // 0 = Sunday … 6 = Saturday (Postgres convention)
  experience: ExerciseLevel
  training_days: number
  train_location: 'gym' | 'home' | 'both'
  injuries: string
  diet: 'none' | 'vegetarian' | 'eggetarian' | 'vegan' | 'halal' | 'other'
  foods_to_avoid: string
  meals_per_day: number
  cleared_to_exercise: boolean
}

export class AuthError extends Error {
  constructor(public code: 'exists' | 'invite' | 'credentials' | 'unconfirmed' | 'other', message: string) {
    super(message)
  }
}

const redirectTo = () => `${window.location.origin}/login`
const toUser = (p: Omit<AuthUser, 'first_name' | 'initials'>): AuthUser => {
  const parts = p.full_name.trim().split(/\s+/).filter(Boolean)
  return {
    ...p,
    first_name: parts[0] ?? '',
    initials: (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? p.email).slice(0, 2)).toUpperCase(),
  }
}

// ---------- Change notifications ----------
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export function onAuthChange(cb: () => void) {
  listeners.add(cb)
  // Deferred: calling Supabase inside this callback can deadlock its auth lock.
  const sub = supabase?.auth.onAuthStateChange(() => { setTimeout(cb, 0) })
  return () => {
    listeners.delete(cb)
    sub?.data.subscription.unsubscribe()
  }
}


// ---------- Pending setup (email confirmation turned on) ----------
// If sign-up needs a confirmed email there is no session yet, so the answers
// wait here and are saved the first time this email logs in.
const PENDING_KEY = 'yuktara.pendingSetup'
function readPending(): { email: string; answers: SetupAnswers } | null {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null')
  } catch {
    return null
  }
}
function writePending(v: { email: string; answers: SetupAnswers } | null) {
  try {
    if (v) localStorage.setItem(PENDING_KEY, JSON.stringify(v))
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    /* storage blocked: the client answers again after logging in */
  }
}

// ---------- Demo accounts ----------
// Demo mode only (no Supabase keys). Two kinds of account, passwords not checked:
//   coach@demo.test → the coach app; any other email → a client.
// With Supabase the role comes from public.users.role and nothing else.
const DEMO_KEY = 'yuktara.demoAuth'
export const DEMO_COACH_EMAIL = DEMO_ACCOUNTS.coach.email
const isDemoCoach = (email: string) => email.trim().toLowerCase() === DEMO_COACH_EMAIL
const demoCoach = () => toUser({ ...DEMO_ACCOUNTS.coach, role: 'coach', setupDone: true, coachFirstName: null })

function demoRead(): AuthUser | null {
  let stored: AuthUser | null
  try {
    stored = JSON.parse(localStorage.getItem(DEMO_KEY) ?? 'null')
  } catch {
    return null
  }
  if (!stored?.email) return null
  // Never trust a role saved in the browser: rebuild it from the demo account list.
  return isDemoCoach(stored.email) ? demoCoach() : { ...stored, role: 'client' }
}
function demoWrite(u: AuthUser | null) {
  try {
    if (u) localStorage.setItem(DEMO_KEY, JSON.stringify(u))
    else localStorage.removeItem(DEMO_KEY)
  } catch {
    /* demo session just won't survive a reload */
  }
  emit()
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Demo stand-in for "Confirm email" being on: these addresses never get a session. */
const demoNeedsConfirm = (email: string) => /@unconfirmed\.test$/i.test(email.trim())
const UNCONFIRMED_MSG = 'Confirm your email first. Open the link we sent you, then log in.'
const demoClient = () => toUser({ ...DEMO_ACCOUNTS.client, role: 'client', setupDone: true, coachFirstName: DEMO_ACCOUNTS.coach.full_name.split(' ')[0] })

// ---------- API ----------
export async function loadUser(): Promise<AuthUser | null> {
  if (!supabase) {
    const u = demoRead()
    setCurrentUser(u)
    return u
  }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    setCurrentUser(null)
    return null
  }
  const uid = session.user.id
  const { data: u, error } = await supabase.from('users').select('id, email, full_name, role').eq('id', uid).single()
  if (error) throw error

  let setupDone = true
  let coachFirstName: string | null = null
  if (u.role === 'client') {
    const { data: p } = await supabase.from('client_profiles').select('coach_id, setup_completed_at').eq('user_id', uid).maybeSingle()
    setupDone = !!p?.setup_completed_at
    if (p?.coach_id) {
      const { data: c } = await supabase.from('users').select('full_name').eq('id', p.coach_id).maybeSingle()
      coachFirstName = c?.full_name?.split(' ')[0] ?? null
    }
    const pending = readPending()
    if (!setupDone && pending && pending.email.toLowerCase() === u.email.toLowerCase()) {
      await saveSetup(uid, pending.answers)
      writePending(null)
      setupDone = true
    }
  }
  const user = toUser({ id: u.id, email: u.email, full_name: u.full_name, role: u.role, setupDone, coachFirstName })
  setCurrentUser(user)
  return user
}

export async function signIn(email: string, password: string) {
  if (!supabase) {
    await pause(500)
    if (demoNeedsConfirm(email)) throw new AuthError('unconfirmed', UNCONFIRMED_MSG)
    if (isDemoCoach(email)) return demoWrite(demoCoach())
    const existing = demoRead()
    demoWrite(existing && existing.role === 'client' && existing.email.toLowerCase() === email.trim().toLowerCase() ? existing : demoClient())
    return
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    // Supabase: "Email not confirmed" (code email_not_confirmed).
    if (error.code === 'email_not_confirmed' || /confirm/i.test(error.message)) throw new AuthError('unconfirmed', UNCONFIRMED_MSG)
    if (/invalid/i.test(error.message)) throw new AuthError('credentials', "That email and password don't match.")
    throw new AuthError('other', error.message)
  }
}

export async function signInWithGoogle() {
  if (!supabase) {
    await pause(400)
    demoWrite(demoClient())
    return
  }
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } })
  if (error) throw new AuthError('other', error.message)
}

export async function sendPasswordReset(email: string) {
  if (!supabase) return pause(400)
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() })
  if (error) throw new AuthError('other', error.message)
}

/** Sends the sign-up confirmation link again. */
export async function resendConfirmation(email: string) {
  if (!supabase) return pause(600)
  const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo() } })
  if (error) {
    if (error.status === 429 || /rate limit|security purposes/i.test(error.message)) {
      throw new AuthError('other', 'Too many emails just now. Wait a minute, then try again.')
    }
    throw new AuthError('other', error.message)
  }
}

// ---------- Returning from an email link ----------
export interface RedirectNotice {
  tone: 'ok' | 'err'
  text: string
  /** Show "Resend link" with it (expired or already-used confirmation link). */
  offerResend: boolean
  /** The link signed the person in (their email is now confirmed). */
  confirmed?: boolean
}

const AUTH_PARAMS = [
  'access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'provider_token',
  'provider_refresh_token', 'code', 'error', 'error_code', 'error_description', 'sb',
]

function authParams(): Record<string, string> {
  const url = new URL(window.location.href)
  const out: Record<string, string> = {}
  new URLSearchParams(url.hash.replace(/^#/, '')).forEach((v, k) => { out[k] = v })
  url.searchParams.forEach((v, k) => { out[k] = v })
  return out
}

function clearAuthParams() {
  const url = new URL(window.location.href)
  AUTH_PARAMS.forEach((k) => url.searchParams.delete(k))
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  if (AUTH_PARAMS.some((k) => hash.has(k)) || url.hash === '#') url.hash = ''
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
}

/** Plain-words version of the error Supabase puts on a failed email link. */
function linkErrorText(p: Record<string, string>) {
  const code = p.error_code ?? ''
  const desc = (p.error_description ?? '').replace(/\+/g, ' ')
  if (code === 'otp_expired' || /expired|invalid/i.test(desc)) {
    return "That confirmation link has expired or was already used. Enter your email below and we'll send a new one."
  }
  if (code === 'access_denied' || p.error === 'access_denied') {
    return "We couldn't confirm your email from that link. Enter your email below and we'll send a new one."
  }
  return `That link didn't work${desc ? ` (${desc})` : ''}. Enter your email below and we'll send a new one.`
}

/**
 * Call once at start-up. supabase-js has already picked up a session from the
 * confirm link (detectSessionInUrl); this waits for it, exchanges a PKCE
 * ?code= if one is present, turns link errors into plain words and removes
 * the auth parameters from the address bar.
 */
let redirectOnce: Promise<RedirectNotice | null> | null = null
export function consumeAuthRedirect(): Promise<RedirectNotice | null> {
  // Once per page load: a ?code= can only be exchanged once.
  redirectOnce ??= readAuthRedirect()
  return redirectOnce
}

async function readAuthRedirect(): Promise<RedirectNotice | null> {
  const p = authParams()
  if (!AUTH_PARAMS.some((k) => k in p)) return null

  let notice: RedirectNotice | null = null
  if (p.error || p.error_code || p.error_description) {
    notice = { tone: 'err', text: linkErrorText(p), offerResend: true }
  } else if (supabase) {
    // Resolves after supabase-js has finished reading the URL.
    let { data: { session } } = await supabase.auth.getSession()
    if (!session && p.code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(p.code)
      session = data.session
      // Opened in another browser: the email is confirmed but this browser
      // can't finish the sign-in, so ask for a normal log-in.
      if (error) notice = { tone: 'ok', text: 'Your email is confirmed. Log in to continue.', offerResend: false }
    }
    if (session) notice = { tone: 'ok', text: 'Your email is confirmed.', offerResend: false, confirmed: true }
  }
  clearAuthParams()
  return notice
}

/** Returns 'signed_in', or 'confirm_email' when Supabase wants the address confirmed first. */
export async function signUp(input: { name: string; email: string; password: string; invite: string }): Promise<'signed_in' | 'confirm_email'> {
  const invite = input.invite.trim().toUpperCase()
  if (!supabase) {
    await pause(900)
    if (/^taken@/i.test(input.email) || isDemoCoach(input.email)) throw new AuthError('exists', 'That email already has an account.')
    if (invite && invite !== DEMO_ACCOUNTS.invite_code) throw new AuthError('invite', "We couldn't find that invite code. Check it with your coach.")
    if (demoNeedsConfirm(input.email)) return 'confirm_email' // no session until the (pretend) link is opened
    demoWrite(toUser({
      id: `demo-${Date.now()}`, email: input.email, full_name: input.name.trim(), role: 'client',
      setupDone: false, coachFirstName: invite ? DEMO_ACCOUNTS.coach.full_name.split(' ')[0] : null,
    }))
    return 'signed_in'
  }

  if (invite) {
    const { data: ok, error } = await supabase.rpc('invite_code_valid', { code: invite })
    if (error) throw new AuthError('other', error.message)
    if (!ok) throw new AuthError('invite', "We couldn't find that invite code. Check it with your coach.")
  }
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: redirectTo(),
      data: {
        full_name: input.name.trim(),
        invite_code: invite || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    },
  })
  if (error) {
    if (/already/i.test(error.message)) throw new AuthError('exists', 'That email already has an account.')
    throw new AuthError('other', error.message)
  }
  // With email confirmation on, Supabase hides existing accounts by returning a user with no identities.
  if (data.user && data.user.identities?.length === 0) throw new AuthError('exists', 'That email already has an account.')
  return data.session ? 'signed_in' : 'confirm_email'
}

/** Returns 'saved', or 'pending' when the answers wait for email confirmation. */
export async function completeSetup(answers: SetupAnswers, email: string): Promise<'saved' | 'pending'> {
  if (!supabase) {
    await pause(700)
    const u = demoRead()
    if (!u) {
      writePending({ email, answers })
      return 'pending'
    }
    demoWrite({ ...u, setupDone: true })
    return 'saved'
  }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    writePending({ email, answers })
    return 'pending'
  }
  await saveSetup(session.user.id, answers)
  emit()
  return 'saved'
}

async function saveSetup(uid: string, a: SetupAnswers) {
  const db = supabase!
  const imperial = a.units === 'imperial'
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const kg = (v: string) => { const n = num(v); return n == null ? null : +(imperial ? lbToKg(n) : n).toFixed(1) }
  const cm = (v: string) => { const n = num(v); return n == null ? null : +(imperial ? n * 2.54 : n).toFixed(1) }

  const { error: uErr } = await db.from('users').update({ unit_system: a.units }).eq('id', uid)
  if (uErr) throw uErr

  const row = {
    date_of_birth: a.date_of_birth || null,
    body_model: a.body_model,
    height_cm: cm(a.height),
    phone: a.phone.trim() || null,
    goal: a.goal,
    start_date: new Date().toLocaleDateString('en-CA'), // local YYYY-MM-DD
    start_weight_kg: kg(a.weight),
    goal_weight_kg: kg(a.goal_weight),
    check_in_day: a.check_in_day,
    experience: a.experience,
    training_days: a.training_days,
    train_location: a.train_location,
    injuries: a.injuries.trim() || null,
    diet: a.diet,
    foods_to_avoid: a.foods_to_avoid.trim() || null,
    meals_per_day: a.meals_per_day,
    cleared_to_exercise: a.cleared_to_exercise,
    setup_completed_at: new Date().toISOString(),
  }
  // The row is created at sign-up; insert only for accounts made before that.
  const { data, error } = await db.from('client_profiles').update(row).eq('user_id', uid).select('user_id')
  if (error) throw error
  if (!data?.length) {
    const { error: iErr } = await db.from('client_profiles').insert({ user_id: uid, ...row })
    if (iErr) throw iErr
  }
}

export async function signOut() {
  if (!supabase) return demoWrite(null)
  await supabase.auth.signOut()
  emit()
}
