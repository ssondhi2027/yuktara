// Workout helpers shared by the demo and live data: this week's plan with what
// happened to each workout, and the summary shown after "Finish workout" and to
// the coach. Pure functions only.

import type { MuscleGroup, UnitSystem } from '@/types/db'
import type { LoggedSet, PlannedExercise, PlannedWorkout, WorkoutSummary } from './api'
import { addDays, weekStart } from './dates'
import { int, kgToLb, lbToKg } from './units'

export interface PlanTemplate { id: string; name: string; day_of_week: number | null; notes: string | null; exercises: PlannedExercise[] }
export interface PlanSession { id: string; workout_template_id: string | null; performed_on: string; finished: boolean }

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
 * "missed"; those workouts stay available.
 */
export function weekPlan(templates: PlanTemplate[], sessions: PlanSession[], todayIso: string, startDate: string): PlannedWorkout[] {
  const monday = weekStart(todayIso)
  const sunday = addDays(monday, 6)
  return templates
    .map((t): PlannedWorkout => {
      const date = t.day_of_week == null ? null : dateInWeek(monday, t.day_of_week)
      const open = sessions.find((s) => s.workout_template_id === t.id && !s.finished)
      const done = sessions.find((s) => s.workout_template_id === t.id && s.finished && s.performed_on >= monday && s.performed_on <= sunday)
      let status: PlannedWorkout['status']
      if (open) status = 'in_progress'
      else if (done) status = 'done'
      else if (date == null) status = 'anytime'
      else if (date === todayIso) status = 'today'
      else if (date > todayIso) status = 'upcoming'
      else status = date >= startDate ? 'missed' : 'anytime'
      return { template_id: t.id, name: t.name, date, notes: t.notes, exercises: t.exercises, status, session_id: open?.id ?? done?.id ?? null }
    })
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
}

export interface SummarySet extends LoggedSet { exercise_id: string; name: string; primary: MuscleGroup[] }

export function summarize(
  s: { id: string; name: string; performed_on: string; finished: boolean; duration_min: number | null; notes: string | null },
  sets: SummarySet[],
): WorkoutSummary {
  const byExercise = new Map<string, { name: string; sets: LoggedSet[] }>()
  const muscles = new Set<MuscleGroup>()
  let volume = 0
  for (const x of sets) {
    const e = byExercise.get(x.exercise_id) ?? { name: x.name, sets: [] }
    e.sets.push({ set_number: x.set_number, weight_kg: x.weight_kg, reps: x.reps, rpe: x.rpe })
    byExercise.set(x.exercise_id, e)
    x.primary.forEach((m) => muscles.add(m))
    volume += (x.weight_kg ?? 0) * (x.reps ?? 0)
  }
  for (const e of byExercise.values()) e.sets.sort((a, b) => a.set_number - b.set_number)
  return {
    ...s,
    sets: sets.length,
    volume_kg: Math.round(volume * 10) / 10, // rounded for display, after any lb conversion
    muscles: [...muscles],
    exercises: [...byExercise.values()],
  }
}

/** Minutes from `startedAt` to now; null if it was left open so long the number means nothing. */
export function minutesSince(startedAt: string | null, now = Date.now()): number | null {
  if (!startedAt) return null
  const min = Math.round((now - new Date(startedAt).getTime()) / 60_000)
  return min >= 0 && min <= 600 ? min : null
}

// ---------- Weight in the client's units (stored in kg) ----------

export const weightUnit = (u: UnitSystem) => (u === 'imperial' ? 'lb' : 'kg')

/** kg → the number shown in an input, in the client's units. */
export function toDisplay(kg: number, u: UnitSystem): string {
  const v = u === 'imperial' ? kgToLb(kg) : kg
  return String(Math.round(v * 10) / 10)
}

/** What the client typed (their units) → kg, rounded to the column's 2 decimals. */
export const toKg = (v: number, u: UnitSystem) => Math.round((u === 'imperial' ? lbToKg(v) : v) * 100) / 100

export const volumeLabel = (kg: number, u: UnitSystem) => `${int(u === 'imperial' ? kgToLb(kg) : kg)} ${weightUnit(u)}`

/** "3 × 80 kg × 6" style line for a list of sets. */
export function setsLine(sets: LoggedSet[], u: UnitSystem): string {
  return sets.map((s) => {
    const w = s.weight_kg != null ? `${toDisplay(s.weight_kg, u)} ${weightUnit(u)}` : 'BW'
    return `${w} × ${s.reps ?? '–'}${s.rpe != null ? ` @${s.rpe}` : ''}`
  }).join(', ')
}

/** Equipment where a set may have no weight. */
export const BODYWEIGHT = new Set(['bodyweight', 'pull-up bar', 'jump rope'])

/** The planned reps if they're a single number ("8"), so a ticked set can use them. */
export function plainReps(reps: string | null | undefined): number | null {
  if (!reps) return null
  return /^\d{1,3}$/.test(reps.trim()) ? Number(reps.trim()) : null
}
