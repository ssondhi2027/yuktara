// Program helpers shared by the live and demo data and the coach's builder:
// status, the generator's draft in the builder's shape, validation and the
// weekly sets-per-muscle summary.

import type { MuscleGroup } from '@/types/db'
import type { ClientDetail, LibraryExercise, Program, ProgramStatus } from './api'
import { addDays, parseDate, weekStart } from './dates'
import { generateProgram, HEALTH_RANGE, LEVELS } from './programGen'

/** The coming Monday (today if it's Monday): the default start for a new program. */
export function comingMonday(todayIso: string): string {
  const dow = parseDate(todayIso).getDay()
  return dow === 1 ? todayIso : addDays(todayIso, (8 - dow) % 7)
}

/** Program week (1-based) of `date` for a program starting `start`. */
export function programWeekOf(start: string, date: string): number {
  return Math.round((parseDate(weekStart(date)).getTime() - parseDate(weekStart(start)).getTime()) / (7 * 86_400_000)) + 1
}

export function programStatus(
  p: { is_template: boolean; assigned: boolean; start_date: string | null; weeks: number },
  todayIso: string,
): ProgramStatus {
  if (p.is_template) return 'template'
  if (!p.assigned) return 'draft'
  if (!p.start_date) return 'ended' // replaced before it began
  if (p.start_date > todayIso) return 'upcoming'
  return programWeekOf(p.start_date, todayIso) > p.weeks ? 'ended' : 'active'
}

/** A first draft from the client's setup answers, ready for the builder (not saved). */
export function draftFromAnswers(detail: ClientDetail, library: LibraryExercise[], todayIso: string): Program {
  const gen = generateProgram(
    { goal: detail.goal, experience: detail.experience, training_days: detail.training_days, train_location: detail.train_location },
    library,
  )
  return {
    id: null,
    client_id: detail.client.id,
    name: gen.name,
    weeks: gen.weeks,
    goal: gen.goal,
    level: gen.level,
    days_per_week: gen.days_per_week,
    status: 'draft',
    start_date: null,
    draft_start: comingMonday(todayIso),
    week: null,
    workouts: gen.workouts.map((w) => ({
      id: null,
      name: w.name,
      day_of_week: w.day_of_week,
      notes: w.notes,
      exercises: w.exercises.map((x) => ({
        id: null, exercise_id: x.exercise_id, name: x.name, sets: x.sets, reps: x.reps, rpe: x.rpe,
        rest_seconds: x.rest_seconds, notes: x.notes,
      })),
    })),
    warnings: gen.warnings,
  }
}

/** Weekly hard sets per muscle for the workouts that have a day (counted like muscle_sets_for_week). */
export function plannedSets(p: Program, library: LibraryExercise[]): Partial<Record<MuscleGroup, number>> {
  const byId = new Map(library.map((e) => [e.id, e]))
  const out: Partial<Record<MuscleGroup, number>> = {}
  for (const w of p.workouts) {
    if (w.day_of_week == null) continue
    for (const x of w.exercises) for (const m of byId.get(x.exercise_id)?.primary ?? []) out[m] = (out[m] ?? 0) + x.sets
  }
  return out
}

/** The weekly sets range the generator aims for, for this program's goal and level. */
export function setsRange(p: Pick<Program, 'goal' | 'level'>): [number, number] {
  return p.goal === 'health' ? HEALTH_RANGE : LEVELS[p.level ?? 'intermediate'].range
}

/** What's wrong with the program, if anything (shown before saving). */
export function programProblems(p: Program): string[] {
  const out: string[] = []
  if (!p.name.trim()) out.push('Give the program a name.')
  if (!(Number.isInteger(p.weeks) && p.weeks >= 4 && p.weeks <= 16)) out.push('Weeks: 4 to 16.')
  if (!p.workouts.length) out.push('Add at least one workout.')
  p.workouts.forEach((w, i) => {
    const label = w.name.trim() || `Workout ${i + 1}`
    if (!w.name.trim()) out.push(`Workout ${i + 1} needs a name.`)
    w.exercises.forEach((x) => {
      if (!(Number.isInteger(x.sets) && x.sets >= 1 && x.sets <= 10)) out.push(`${label} · ${x.name}: sets 1 to 10.`)
      if (!x.reps.trim()) out.push(`${label} · ${x.name}: reps are required (e.g. 8–10).`)
      else if (x.reps.trim().length > 20) out.push(`${label} · ${x.name}: reps up to 20 characters.`)
      if (x.rpe != null && !(x.rpe >= 1 && x.rpe <= 10)) out.push(`${label} · ${x.name}: RPE 1 to 10.`)
      if (x.rest_seconds != null && !(x.rest_seconds >= 0 && x.rest_seconds <= 900)) out.push(`${label} · ${x.name}: rest 0 to 900 seconds.`)
    })
  })
  return out
}

/** Extra checks before a program goes to the client. */
export function assignProblems(p: Program): string[] {
  const out = programProblems(p)
  if (!p.workouts.some((w) => w.day_of_week != null && w.exercises.length)) out.push('Give at least one workout a day and some exercises.')
  return out
}
