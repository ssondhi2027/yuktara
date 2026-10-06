// Helpers shared by the live (Supabase) client and coach data.
// Every query runs as the signed-in user, so RLS decides what comes back.

import type { PostgrestError } from '@supabase/supabase-js'
import type { MealType } from '@/types/db'
import type { CoachNote, Person, Targets } from '../api'
import { ApiError } from '../backend'
import { addDays, monthDay, parseDate, toISODate, weekStart } from '../dates'
import { supabase } from '../supabase'

export const db = () => {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

export async function myId(): Promise<string> {
  const { data: { session } } = await db().auth.getSession()
  if (!session) throw new ApiError(401, 'Your session has ended. Log in again.')
  return session.user.id
}

/** Unwraps a Supabase result, turning errors into ApiError. */
export function must<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) {
    const status = res.error.code === '42501' ? 403 : 500
    throw new ApiError(status, status === 403 ? "You don't have access to that." : 'Something went wrong loading your data.', res.error.code)
  }
  return res.data as T
}

export function person(id: string, full_name: string | null | undefined): Person {
  const name = (full_name ?? '').trim() || 'Unnamed'
  const parts = name.split(/\s+/)
  const initials = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase()
  return { id, full_name: name, first_name: parts[0], initials }
}

// ---------- Weeks ----------
// Day 1 is the client's start_date. Program week 1 is the Monday–Sunday week
// containing it; check-ins and every "since start" number count from there.

/** 1-based program week of `date` for someone who started on `start`. */
export function programWeek(start: string, date: string): number {
  const days = (parseDate(weekStart(date)).getTime() - parseDate(weekStart(start)).getTime()) / 86_400_000
  return Math.max(1, Math.round(days / 7) + 1)
}

/** Monday of program week `n`. */
export const weekMonday = (start: string, n: number) => addDays(weekStart(start), (n - 1) * 7)

/** ISO timestamps for local midnight at the start and end of `date`. */
export function dayBounds(date: string): [string, string] {
  const from = parseDate(date)
  const to = parseDate(addDays(date, 1))
  return [from.toISOString(), to.toISOString()]
}

/** Local calendar date of a timestamp. */
export const localDate = (ts: string) => toISODate(new Date(ts))

/**
 * When the next check-in opens (same rule as roll_check_ins in 0012):
 * the next check-in day whose reviewed week has at least 3 of the client's days.
 */
export function nextCheckInDate(start: string, checkInDay: number, from: string): string {
  for (let i = 0; i < 21; i++) {
    const d = addDays(from, i)
    if (parseDate(d).getDay() !== checkInDay) continue
    const ws = weekStart(addDays(d, -6))
    const firstDay = start > ws ? start : ws
    const daysIn = (parseDate(addDays(ws, 6)).getTime() - parseDate(firstDay).getTime()) / 86_400_000 + 1
    if (daysIn >= 3) return d
  }
  return from
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The meals a client planned to eat a day, from their setup answer. */
export function plannedMeals(perDay: number | null): MealType[] {
  switch (perDay) {
    case 2: return ['breakfast', 'dinner']
    case 4:
    case 5: return ['breakfast', 'snack', 'lunch', 'dinner']
    default: return ['breakfast', 'lunch', 'dinner']
  }
}

// ---------- Targets ----------

interface TargetRow {
  calories: number; protein_g: number; carbs_g: number; fat_g: number
  water_ml: number | null; steps: number | null; sleep_hours: number | null; effective_from: string
}

export const targetsFromRow = (r: TargetRow): Targets => ({
  calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g,
  water_ml: r.water_ml ?? 0, steps: r.steps ?? 0, sleep_h: r.sleep_hours != null ? Number(r.sleep_hours) : 0,
})

/** Targets in force for `client` on `date` (versioned by effective_from), or null. */
export async function targetsOn(client: string, date: string): Promise<{ targets: Targets; from: string } | null> {
  const rows = must(await db()
    .from('nutrition_targets')
    .select('calories, protein_g, carbs_g, fat_g, water_ml, steps, sleep_hours, effective_from')
    .eq('client_id', client)
    .lte('effective_from', date)
    .order('effective_from', { ascending: false })
    .limit(1))
  return rows.length ? { targets: targetsFromRow(rows[0] as TargetRow), from: rows[0].effective_from } : null
}

// ---------- Photos ----------

/** Signed URLs (1 hour) for photo paths in the private buckets, keyed by path. */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const byBucket: Record<string, string[]> = {}
  for (const p of paths) {
    const bucket = p.split('/')[1] === 'meals' ? 'meal-photos' : 'progress-photos'
    ;(byBucket[bucket] ??= []).push(p)
  }
  await Promise.all(Object.entries(byBucket).map(async ([bucket, list]) => {
    const { data } = await db().storage.from(bucket).createSignedUrls(list, 3600)
    for (const item of data ?? []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl
  }))
  return out
}

// ---------- Messages ----------

/** The coach's most recent message to this client, for the "your coach" card. */
export async function lastCoachMessage(client: string, coach: Person | null): Promise<CoachNote | null> {
  if (!coach) return null
  const rows = must(await db()
    .from('messages')
    .select('body, created_at, check_in_id')
    .eq('client_id', client)
    .eq('sender_id', coach.id)
    .order('created_at', { ascending: false })
    .limit(1))
  if (!rows.length) return null
  const m = rows[0]
  return { coach, title: m.check_in_id ? 'Check-in feedback' : 'Message', date: monthDay(localDate(m.created_at)), body: m.body }
}

export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
export const round1 = (x: number) => Math.round(x * 10) / 10
