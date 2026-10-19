// Workout helpers shared by the demo and live data: this week's plan with what
// happened to each workout, and the summary shown after "Finish workout" and to
// the coach. Pure functions only.

import type { MuscleGroup, UnitSystem } from '@/types/db'
import type { LoggedSet, PlannedExercise, PlannedWorkout, WorkoutSummary } from './api'
import { addDays, weekStart } from './dates.ts'
import { fromUnit, inputFromKg, int, kgFromInput, LOAD_STEP, loadWeight, roundTo, toUnit, unitLabel } from './units.ts'

export interface PlanTemplate { id: string; name: string; day_of_week: number | null; notes: string | null; exercises: PlannedExercise[] }
export interface PlanSession { id: string; workout_template_id: string | null; performed_on: string; finished: boolean; skipped?: boolean; notes?: string | null }

/** Reasons offered when skipping a workout (free text is fine too). */
export const SKIP_REASONS = ['Sick', 'Injury or pain', 'Travel', 'Busy', 'Needed rest'] as const

/**
 * Workouts done for "X of Y planned": with a program, the distinct planned
 * workouts that have a finished session (an extra workout of the client's own
 * doesn't make up for a missed one); without one, every finished session.
 */
export function workoutsDone(sessions: { status: string; workout_template_id: string | null }[], hasProgram: boolean): number {
  const done = sessions.filter((s) => s.status === 'done')
  return hasProgram ? new Set(done.filter((s) => s.workout_template_id).map((s) => s.workout_template_id)).size : done.length
}

/** Name for a session that isn't from the coach's program. */
export const OWN_WORKOUT = 'Own workout'

/** Date of weekday `dow` (0 = Sunday) in the Monday–Sunday week starting `monday`. */
export const dateInWeek = (monday: string, dow: number) => addDays(monday, (dow + 6) % 7)

/**
 * This week's planned workouts, Monday first. A workout is done once a
 * finished session of it exists this week (whatever day it was done on), so a
 * missed Tuesday can be caught up on Wednesday. Days before `startDate` aren't
 * "missed"; those workouts stay available. A skip (marked by the client) shows
 * as skipped unless the workout was done after all.
 */
export function weekPlan(templates: PlanTemplate[], sessions: PlanSession[], todayIso: string, startDate: string): PlannedWorkout[] {
  const monday = weekStart(todayIso)
  const sunday = addDays(monday, 6)
  return templates
    .map((t): PlannedWorkout => {
      const date = t.day_of_week == null ? null : dateInWeek(monday, t.day_of_week)
      const open = sessions.find((s) => s.workout_template_id === t.id && !s.finished)
      const thisWeek = (s: PlanSession) => s.workout_template_id === t.id && s.finished && s.performed_on >= monday && s.performed_on <= sunday
      const done = sessions.find((s) => thisWeek(s) && !s.skipped)
      const skip = sessions.find((s) => thisWeek(s) && s.skipped)
      let status: PlannedWorkout['status']
      if (open) status = 'in_progress'
      else if (done) status = 'done'
      else if (skip) status = 'skipped'
      else if (date == null) status = 'anytime'
      else if (date === todayIso) status = 'today'
      else if (date > todayIso) status = 'upcoming'
      else status = date >= startDate ? 'missed' : 'anytime'
      return {
        template_id: t.id, name: t.name, date, notes: t.notes, exercises: t.exercises, status,
        session_id: open?.id ?? done?.id ?? skip?.id ?? null,
        skip_reason: !open && !done && skip ? skip.notes || null : null,
      }
    })
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
}

export interface SummarySet extends LoggedSet {
  exercise_id: string
  name: string
  primary: MuscleGroup[]
  /** the planned slot's superset label, if any */
  superset?: string | null
}

// ---------- Drop sets ----------

/** Working sets in order, each followed by its drops (in the order they were logged). */
export function inSetOrder<T extends { set_number: number; drop_of?: number | null }>(sets: T[]): T[] {
  const heads = sets.filter((s) => s.drop_of == null).sort((a, b) => a.set_number - b.set_number)
  const drops = sets.filter((s) => s.drop_of != null).sort((a, b) => a.set_number - b.set_number)
  const out = heads.flatMap((h) => [h, ...drops.filter((d) => d.drop_of === h.set_number)])
  return [...out, ...drops.filter((d) => !out.includes(d))] // a drop whose set is gone, last
}

/** Hard sets: a working set and its drops count as one. (Warm-ups are left out before this.) */
export const hardSets = (sets: { drop_of?: number | null }[]) => sets.filter((s) => s.drop_of == null).length

/** Training volume: every set, drops included (Σ weight × reps, kg). */
export const setVolume = (sets: { weight_kg: number | null; reps: number | null }[]) => sets.reduce((a, s) => a + (s.weight_kg ?? 0) * (s.reps ?? 0), 0)

/**
 * The weight to suggest for a drop: about 22.5% less than the set above,
 * rounded to the user's load step (0.5 kg or 1 lb), as kg. Null for bodyweight.
 */
export function dropSuggestionKg(kg: number | null, u: UnitSystem): number | null {
  if (kg == null || !(kg > 0)) return null
  const shown = roundTo(toUnit(kg * 0.775, u), LOAD_STEP[u])
  return Math.round(fromUnit(Math.max(LOAD_STEP[u], shown), u) * 100) / 100
}

// ---------- Supersets ----------

/** A, B, … Z, AA, AB … for the n-th superset of a workout. */
export const supersetLetter = (n: number): string => (n < 26 ? String.fromCharCode(65 + n) : supersetLetter(Math.floor(n / 26) - 1) + String.fromCharCode(65 + (n % 26)))

/**
 * Tidies superset labels: consecutive exercises sharing a label form one
 * superset; a label on its own is dropped; supersets are relabelled A, B, C… in order.
 */
export function normalizeSupersets<T extends { superset?: string | null }>(xs: T[]): T[] {
  const out = xs.map((x) => ({ ...x, superset: null as string | null }))
  let n = 0
  for (let i = 0; i < xs.length;) {
    let j = i
    while (xs[i].superset && j + 1 < xs.length && xs[j + 1].superset === xs[i].superset) j++
    if (j > i) {
      const label = supersetLetter(n++)
      for (let k = i; k <= j; k++) out[k].superset = label
    }
    i = j + 1
  }
  return out
}

/** Whether exercise i is in a superset with the one after it. */
export const linkedToNext = (xs: { superset?: string | null }[], i: number) => !!xs[i]?.superset && xs[i].superset === xs[i + 1]?.superset

/** Puts exercise i and the next one in the same superset (joining either one's superset). */
export function linkWithNext<T extends { superset?: string | null }>(xs: T[], i: number): T[] {
  if (i < 0 || i + 1 >= xs.length) return xs
  const join = '~'
  const a = xs[i].superset
  const b = xs[i + 1].superset
  const next = xs.map((x, k) => ((k === i || k === i + 1 || (a && x.superset === a) || (b && x.superset === b)) ? { ...x, superset: join } : x))
  return normalizeSupersets(next)
}

/** Splits the superset between exercise i and the next one (a pair becomes two single exercises). */
export function unlinkFromNext<T extends { superset?: string | null }>(xs: T[], i: number): T[] {
  if (!linkedToNext(xs, i)) return xs
  const label = xs[i].superset
  const next = xs.map((x, k) => (k > i && x.superset === label ? { ...x, superset: '~' } : x))
  return normalizeSupersets(next)
}

/** "A1", "A2", … per exercise (null when not in a superset). */
export function supersetTags(xs: { superset?: string | null }[]): (string | null)[] {
  const seen = new Map<string, number>()
  return xs.map((x) => {
    if (!x.superset) return null
    const k = (seen.get(x.superset) ?? 0) + 1
    seen.set(x.superset, k)
    return `${x.superset}${k}`
  })
}

/** Consecutive runs for display: a superset's members together, everything else on its own. */
export function supersetBlocks<T extends { superset?: string | null }>(xs: T[]): { label: string | null; items: T[] }[] {
  const out: { label: string | null; items: T[] }[] = []
  for (const x of xs) {
    const last = out[out.length - 1]
    if (x.superset && last?.label === x.superset) last.items.push(x)
    else out.push({ label: x.superset ?? null, items: [x] })
  }
  return out
}

/**
 * A superset's sets in the order they're done: round 1 is each member's first
 * working set (with its drops), then round 2, and so on. `members` are each
 * member's working sets in order.
 */
export function roundOrder<T>(members: T[][]): { round: number; member: number; set: T }[] {
  const rounds = Math.max(0, ...members.map((m) => m.length))
  const out: { round: number; member: number; set: T }[] = []
  for (let r = 0; r < rounds; r++) members.forEach((m, i) => { if (m[r] !== undefined) out.push({ round: r + 1, member: i, set: m[r] }) })
  return out
}

export function summarize(
  s: { id: string; name: string; performed_on: string; finished: boolean; duration_min: number | null; notes: string | null; effort?: number | null; skipped?: boolean },
  sets: SummarySet[],
): WorkoutSummary {
  const byExercise = new Map<string, { name: string; sets: LoggedSet[]; superset: string | null }>()
  const muscles = new Set<MuscleGroup>()
  for (const x of sets) {
    const e = byExercise.get(x.exercise_id) ?? { name: x.name, sets: [], superset: x.superset ?? null }
    e.sets.push({ set_number: x.set_number, weight_kg: x.weight_kg, reps: x.reps, rpe: x.rpe, drop_of: x.drop_of ?? null })
    byExercise.set(x.exercise_id, e)
    x.primary.forEach((m) => muscles.add(m))
  }
  const exercises = [...byExercise.values()]
  const groups = new Map<string, string[]>()
  for (const e of exercises) if (e.superset) groups.set(e.superset, [...(groups.get(e.superset) ?? []), e.name])
  return {
    ...s,
    effort: s.effort ?? null,
    skipped: s.skipped ?? false,
    // A working set and its drops are one hard set; volume counts every set.
    sets: hardSets(sets),
    volume_kg: Math.round(setVolume(sets) * 10) / 10, // rounded for display, after any lb conversion
    muscles: [...muscles],
    exercises: exercises.map((e) => ({ name: e.name, sets: inSetOrder(e.sets) })),
    supersets: [...groups.values()].filter((g) => g.length > 1),
  }
}

/** Minutes from `startedAt` to now; null if it was left open so long the number means nothing. */
export function minutesSince(startedAt: string | null, now = Date.now()): number | null {
  if (!startedAt) return null
  const min = Math.round((now - new Date(startedAt).getTime()) / 60_000)
  return min >= 0 && min <= 600 ? min : null
}

// ---------- Weight in the client's units (stored in kg) ----------

export const weightUnit = unitLabel

/** kg → the number shown in an input, in the client's units (0.1). */
export const toDisplay = inputFromKg

/** What the client typed (their units) → kg, rounded to the column's 2 decimals. */
export const toKg = kgFromInput

export const volumeLabel = (kg: number, u: UnitSystem) => `${int(toUnit(kg, u))} ${unitLabel(u)}`

/** "80 kg × 6 @8, 60 kg × 8 → 45 kg × 8 → 30 kg × 10": each set, its drops after an arrow (0.1 lb / 0.5 kg). */
export function setsLine(sets: LoggedSet[], u: UnitSystem): string {
  const one = (s: LoggedSet) => `${s.weight_kg != null ? loadWeight(s.weight_kg, u) : 'BW'} × ${s.reps ?? '–'}${s.rpe != null ? ` @${s.rpe}` : ''}`
  const parts: string[] = []
  for (const s of inSetOrder(sets)) {
    if (s.drop_of != null && parts.length) parts[parts.length - 1] += ` → ${one(s)}`
    else parts.push(one(s))
  }
  return parts.join(', ')
}

/** "Superset: Lateral raise + Face pull". */
export const supersetLine = (names: string[]) => `Superset: ${names.join(' + ')}`

/** Equipment where a set may have no weight. */
export const BODYWEIGHT = new Set(['bodyweight', 'pull-up bar', 'jump rope'])

/** The planned reps if they're a single number ("8"), so a ticked set can use them. */
export function plainReps(reps: string | null | undefined): number | null {
  if (!reps) return null
  return /^\d{1,3}$/.test(reps.trim()) ? Number(reps.trim()) : null
}
