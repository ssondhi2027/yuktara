// Personal records and milestone badges. Pure functions with type-only imports;
// unit-tested in tests/records.test.ts. Weights are kg here; screens convert.
//
// Records, per exercise, from working sets only (no warm-ups, no drops):
//   weight   heavier than any earlier set
//   reps     more reps than ever at that weight or heavier
//   e1rm     a higher estimated 1RM (oneRepMax in lib/forecast.ts, same rules)
//   bw_reps  bodyweight exercises: more reps in one bodyweight set than ever
// and for cardio, per bout (not a warm-up, with a time):
//   distance the longest distance in one bout (value in km)
//   duration the longest bout (value in minutes)
//   pace     the fastest average pace over a bout of 1 km or more (value in s/km)
// The first workout with an exercise (for each kind) sets the baseline and isn't
// a record; a tie isn't a record. Within one workout only the set that matters
// counts: the heaviest for weight, the best estimate for 1RM, the most reps for
// bodyweight, and for reps every set no other set of that workout matches or beats.
//
// Milestones (the lists below) are earned once, the first time they're reached,
// from the first workout on.

import type { UnitSystem } from '../types/db'
import { oneRepMax } from './forecast.ts'
import { kgToLb, loadWeight } from './units.ts'
import { clock, distanceText, paceText } from './cardio.ts'

export type RecordKind = 'weight' | 'reps' | 'e1rm' | 'bw_reps' | 'distance' | 'duration' | 'pace' | 'milestone'
/** Record kinds of cardio bouts. */
export const CARDIO_KINDS: RecordKind[] = ['distance', 'duration', 'pace']

/** A logged set, as the records see it. */
export interface RecordSet {
  exercise_id: string
  set_number: number
  weight_kg: number | null
  reps: number | null
  rpe: number | null
  is_warmup?: boolean
  drop_of?: number | null
  /** cardio: the bout's time and distance */
  duration_s?: number | null
  distance_m?: number | null
}

/** A finished workout and its sets. */
export interface RecordSession {
  id: string
  date: string
  /** orders two workouts on the same day */
  started_at?: string | null
  sets: RecordSet[]
}

/** Name, whether it's done without weight (equipment in lib/workouts.ts BODYWEIGHT) and whether it's cardio, by exercise id. */
export type ExerciseInfo = Map<string, { name: string; bodyweight: boolean; cardio?: boolean }>

/** The best so far for one exercise, from earlier workouts' working sets. */
export interface Bests {
  /** heaviest set, kg */
  kg: number | null
  /** best estimated 1RM, kg */
  e1rm: number | null
  /** [kg, reps], heaviest first: each has more reps than every heavier one */
  reps_at: [number, number][]
  /** most reps in one bodyweight set */
  bw_reps: number | null
  /** cardio: the longest distance (m) and the longest time (s) in one bout */
  dist_m?: number | null
  dur_s?: number | null
  /** cardio: the fastest pace (s/km) over a bout of PACE_MIN_M or more */
  pace?: number | null
}

export interface PersonalRecord {
  session_id: string
  /** null for a workout-count milestone */
  exercise_id: string | null
  /** the exercise's name ('' for a workout-count milestone) */
  exercise: string
  kind: RecordKind
  /** milestones: "load:bench:100kg", "bw:squat:1.5", "reps:pull-up:10", "workouts:50" */
  milestone: string | null
  /** kg for weight, e1rm and load milestones; reps for reps, bw_reps and rep milestones; a count for workouts */
  value: number
  /** the best before (same measure); null for milestones */
  previous: number | null
  set_number: number | null
  weight_kg: number | null
  reps: number | null
  rpe: number | null
  /** cardio records and milestones: the bout */
  duration_s?: number | null
  distance_m?: number | null
  date: string
}

// ---------- Milestones (data) ----------

/** Plate milestones for the main lifts, in each unit (shown in the viewer's unit). */
export const LOAD_MILESTONES: { lift: string; key: string; short: string; kg: number[]; lb: number[] }[] = [
  { lift: 'Barbell bench press', key: 'bench', short: 'bench press', kg: [40, 60, 80, 100, 120, 140], lb: [95, 135, 185, 225, 275, 315] },
  { lift: 'Back squat', key: 'squat', short: 'squat', kg: [60, 100, 140, 180], lb: [135, 225, 315, 405] },
  { lift: 'Deadlift', key: 'deadlift', short: 'deadlift', kg: [60, 100, 140, 180, 220], lb: [135, 225, 315, 405, 495] },
  { lift: 'Overhead press', key: 'press', short: 'overhead press', kg: [40, 60, 80], lb: [95, 135, 185] },
]

/** Lifting a multiple of body weight (the latest weigh-in on or before that day). */
export const BODYWEIGHT_MILESTONES: { lift: string; key: string; times: number; label: string }[] = [
  { lift: 'Barbell bench press', key: 'bench', times: 1, label: 'Bodyweight bench press' },
  { lift: 'Back squat', key: 'squat', times: 1.5, label: '1.5× bodyweight squat' },
  { lift: 'Deadlift', key: 'deadlift', times: 2, label: '2× bodyweight deadlift' },
]

/** Reps in one set. */
export const REP_MILESTONES: { lift: string; key: string; reps: number[]; one: string; many: string }[] = [
  { lift: 'Pull-up', key: 'pull-up', reps: [1, 5, 10, 15], one: 'First pull-up', many: 'pull-ups' },
  { lift: 'Push-up', key: 'push-up', reps: [10, 25, 50], one: 'First push-up', many: 'push-ups' },
]

/** Finished workouts. */
export const WORKOUT_MILESTONES = [10, 25, 50, 100, 250]

/** Distance in one bout, km. */
export const DISTANCE_MILESTONES: { lifts: string[]; key: string; km: number[]; noun: string }[] = [
  { lifts: ['Treadmill run', 'Outdoor run'], key: 'run', km: [5, 10, 21.1, 42.2], noun: 'run' },
  { lifts: ['Cycling', 'Stationary bike'], key: 'ride', km: [20, 50, 100], noun: 'ride' },
  { lifts: ['Swimming'], key: 'swim', km: [1, 2, 5], noun: 'swim' },
]

/** A pace record needs a bout at least this long (shorter ones aren't comparable). */
export const PACE_MIN_M = 1000

// ---------- Comparing ----------

// Weights within 0.05 kg are the same load: a set typed in lb is shown to 0.1 lb
// and saved to 0.01 kg, so the same load can come back a few hundredths off.
const EPS = 0.05
/** An estimated 1RM has to beat the best by more than this to count. */
const E1RM_EPS = 0.1
const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100

/** A working set: not a warm-up, not a drop, at least one rep. */
export const isWorking = (s: RecordSet) => !s.is_warmup && s.drop_of == null && s.reps != null && s.reps >= 1
/** A cardio bout: not a warm-up or a drop, with a time. */
export const isBout = (s: RecordSet) => !s.is_warmup && s.drop_of == null && s.duration_s != null && s.duration_s >= 1
const paceOf = (s: RecordSet) => (s.distance_m != null && s.distance_m >= PACE_MIN_M ? s.duration_s! / (s.distance_m / 1000) : null)
const weighted = (s: RecordSet) => s.weight_kg != null && s.weight_kg > 0
/** The set's estimated 1RM, kg (null when lib/forecast.ts can't estimate one). */
const estimate = (s: RecordSet) => oneRepMax(s.weight_kg, s.reps, s.rpe)

export const emptyBests = (): Bests => ({ kg: null, e1rm: null, reps_at: [], bw_reps: null })

/** Most reps logged at `kg` or heavier, or null if nothing that heavy was logged. */
export function repsAtOrAbove(b: Bests | undefined, kg: number): number | null {
  let best: number | null = null
  for (const [k, reps] of b?.reps_at ?? []) if (k >= kg - EPS && (best == null || reps > best)) best = reps
  return best
}

type Kind = { bodyweight?: boolean; cardio?: boolean } | undefined

/** Bests after one more set (`kind`: the exercise's ExerciseInfo entry). */
export function addToBests(b: Bests, s: RecordSet, kind: Kind): Bests {
  if (kind?.cardio) {
    if (!isBout(s)) return b
    const pace = paceOf(s)
    return {
      ...b,
      dist_m: s.distance_m != null ? Math.max(b.dist_m ?? 0, s.distance_m) : b.dist_m ?? null,
      dur_s: Math.max(b.dur_s ?? 0, s.duration_s!),
      pace: pace == null ? b.pace ?? null : b.pace == null ? pace : Math.min(b.pace, pace),
    }
  }
  const bodyweight = !!kind?.bodyweight
  if (!isWorking(s)) return b
  if (!weighted(s)) return bodyweight ? { ...b, bw_reps: Math.max(b.bw_reps ?? 0, s.reps!) } : b
  const kg = s.weight_kg!
  const est = estimate(s)
  const pairs = [...b.reps_at, [kg, s.reps!] as [number, number]].sort((x, y) => y[0] - x[0] || y[1] - x[1])
  // Keep only pairs with more reps than every heavier one.
  const frontier: [number, number][] = []
  for (const p of pairs) if (!frontier.length || p[1] > frontier[frontier.length - 1][1]) frontier.push(p)
  return { kg: b.kg == null ? kg : Math.max(b.kg, kg), e1rm: est == null ? b.e1rm : b.e1rm == null ? est : Math.max(b.e1rm, est), reps_at: frontier, bw_reps: b.bw_reps }
}

/** Each exercise's bests from these workouts. */
export function bestsFrom(sessions: RecordSession[], info: ExerciseInfo): Record<string, Bests> {
  const out: Record<string, Bests> = {}
  for (const s of sessions) for (const x of s.sets) out[x.exercise_id] = addToBests(out[x.exercise_id] ?? emptyBests(), x, info.get(x.exercise_id))
  return out
}

/**
 * The records one workout sets against the bests before it (`before`, by
 * exercise). Sets of exercises with no history set the baseline: no records.
 */
export function sessionRecords(before: Record<string, Bests>, session: RecordSession, info: ExerciseInfo): PersonalRecord[] {
  const out: PersonalRecord[] = []
  const byExercise = new Map<string, RecordSet[]>()
  for (const x of session.sets) {
    if (info.get(x.exercise_id)?.cardio ? isBout(x) : isWorking(x)) byExercise.set(x.exercise_id, [...(byExercise.get(x.exercise_id) ?? []), x])
  }
  for (const [id, sets] of byExercise) {
    const b = before[id]
    if (!b) continue
    const e = info.get(id)
    const rec = (kind: RecordKind, s: RecordSet, value: number, previous: number | null) => out.push({
      session_id: session.id, exercise_id: id, exercise: e?.name ?? 'Exercise', kind, milestone: null, value, previous,
      set_number: s.set_number, weight_kg: s.weight_kg, reps: s.reps, rpe: s.rpe,
      duration_s: s.duration_s ?? null, distance_m: s.distance_m ?? null, date: session.date,
    })
    if (e?.cardio) {
      const first = <T,>(xs: T[]) => xs[0]
      // Distance: the longest bout (5 m either way is the same distance).
      const far = first(sets.filter((s) => s.distance_m != null).sort((a, c) => c.distance_m! - a.distance_m! || a.set_number - c.set_number))
      if (far && b.dist_m != null && far.distance_m! > b.dist_m + 5) rec('distance', far, r2(far.distance_m! / 1000), r2(b.dist_m / 1000))
      // Duration: the longest bout.
      const long = first([...sets].sort((a, c) => c.duration_s! - a.duration_s! || a.set_number - c.set_number))
      if (long && b.dur_s != null && long.duration_s! > b.dur_s) rec('duration', long, r2(long.duration_s! / 60), r2(b.dur_s / 60))
      // Pace: the fastest bout of 1 km or more, a second per km or more faster.
      const fast = first(sets.filter((s) => paceOf(s) != null).sort((a, c) => paceOf(a)! - paceOf(c)! || a.set_number - c.set_number))
      if (fast && b.pace != null && paceOf(fast)! < b.pace - 1) rec('pace', fast, r1(paceOf(fast)!), r1(b.pace))
      continue
    }
    const heavy = sets.filter(weighted).sort((a, c) => c.weight_kg! - a.weight_kg! || c.reps! - a.reps! || a.set_number - c.set_number)
    // Weight: the heaviest set, if it's heavier than ever.
    if (heavy.length && b.kg != null && heavy[0].weight_kg! > b.kg + EPS) rec('weight', heavy[0], heavy[0].weight_kg!, b.kg)
    // Reps: each set beating the most reps ever at its weight or heavier, unless
    // another set of this workout was as heavy with as many reps.
    for (const s of heavy) {
      const prev = repsAtOrAbove(b, s.weight_kg!)
      if (prev == null || s.reps! <= prev) continue
      const matched = heavy.some((o) => o !== s && o.weight_kg! >= s.weight_kg! - EPS && o.reps! >= s.reps! && (o.weight_kg! > s.weight_kg! + EPS || o.reps! > s.reps! || o.set_number < s.set_number))
      if (!matched) rec('reps', s, s.reps!, prev)
    }
    // Estimated 1RM: the best estimate, if it's higher than ever.
    const ests = heavy.map((s) => ({ s, est: estimate(s) })).filter((x): x is { s: RecordSet; est: number } => x.est != null)
      .sort((a, c) => c.est - a.est || a.s.set_number - c.s.set_number)
    if (ests.length && b.e1rm != null && ests[0].est > b.e1rm + E1RM_EPS) rec('e1rm', ests[0].s, r1(ests[0].est), r1(b.e1rm))
    // Bodyweight reps: the set with the most reps, if more than ever.
    if (e?.bodyweight && b.bw_reps != null) {
      const top = sets.filter((s) => !weighted(s)).sort((a, c) => c.reps! - a.reps! || a.set_number - c.set_number)[0]
      if (top && top.reps! > b.bw_reps) rec('bw_reps', top, top.reps!, b.bw_reps)
    }
  }
  return out
}

/** Record kinds by set, for the logger's badges: "exerciseId:setNumber" → kinds. */
export function setBadges(before: Record<string, Bests>, sets: RecordSet[], info: ExerciseInfo): Map<string, RecordKind[]> {
  const out = new Map<string, RecordKind[]>()
  for (const r of sessionRecords(before, { id: '', date: '', sets }, info)) {
    const k = `${r.exercise_id}:${r.set_number}`
    out.set(k, [...(out.get(k) ?? []), r.kind])
  }
  return out
}

// ---------- Milestones ----------

const sameLift = (name: string | undefined, lift: string) => !!name && name.trim().toLowerCase() === lift.toLowerCase()

/** Body weight on a day: the latest weigh-in on or before it. */
export function bodyWeightOn(weighIns: { date: string; kg: number }[], date: string): number | null {
  let best: { date: string; kg: number } | null = null
  for (const w of weighIns) if (w.date <= date && w.kg > 0 && (!best || w.date > best.date)) best = w
  return best?.kg ?? null
}

/** Milestones this workout reaches that aren't in `earned` (which it then adds to). `count` is this workout's number. */
export function sessionMilestones(session: RecordSession, info: ExerciseInfo, earned: Set<string>, count: number, weighIns: { date: string; kg: number }[]): PersonalRecord[] {
  const out: PersonalRecord[] = []
  const add = (key: string, exerciseId: string | null, s: RecordSet | null, value: number) => {
    if (earned.has(key)) return
    earned.add(key)
    out.push({
      session_id: session.id, exercise_id: exerciseId, exercise: exerciseId ? info.get(exerciseId)?.name ?? 'Exercise' : '', kind: 'milestone', milestone: key,
      value, previous: null, set_number: s?.set_number ?? null, weight_kg: s?.weight_kg ?? null, reps: s?.reps ?? null, rpe: s?.rpe ?? null,
      duration_s: s?.duration_s ?? null, distance_m: s?.distance_m ?? null, date: session.date,
    })
  }
  const working = session.sets.filter(isWorking)
  // The set that gets the milestone: the heaviest (or most reps), the earlier on a tie.
  const top = (sets: RecordSet[], by: (s: RecordSet) => number) => [...sets].sort((a, c) => by(c) - by(a) || a.set_number - c.set_number)[0]
  for (const m of LOAD_MILESTONES) {
    const sets = working.filter((s) => weighted(s) && sameLift(info.get(s.exercise_id)?.name, m.lift))
    if (!sets.length) continue
    const best = top(sets, (s) => s.weight_kg!)
    const kg = best.weight_kg!
    for (const t of m.kg) if (kg >= t - 0.005) add(`load:${m.key}:${t}kg`, best.exercise_id, best, kg)
    // 0.05 lb leeway: 135 lb is stored as 61.23 kg (134.99 lb).
    for (const t of m.lb) if (kgToLb(kg) >= t - 0.05) add(`load:${m.key}:${t}lb`, best.exercise_id, best, kg)
  }
  const bw = bodyWeightOn(weighIns, session.date)
  if (bw != null) {
    for (const m of BODYWEIGHT_MILESTONES) {
      const sets = working.filter((s) => weighted(s) && sameLift(info.get(s.exercise_id)?.name, m.lift) && s.weight_kg! >= m.times * bw - 0.005)
      if (sets.length) {
        const best = top(sets, (s) => s.weight_kg!)
        add(`bw:${m.key}:${m.times}`, best.exercise_id, best, best.weight_kg!)
      }
    }
  }
  for (const m of REP_MILESTONES) {
    const sets = working.filter((s) => sameLift(info.get(s.exercise_id)?.name, m.lift))
    if (!sets.length) continue
    const best = top(sets, (s) => s.reps!)
    for (const t of m.reps) if (best.reps! >= t) add(`reps:${m.key}:${t}`, best.exercise_id, best, best.reps!)
  }
  for (const m of DISTANCE_MILESTONES) {
    const bouts = session.sets.filter((s) => isBout(s) && s.distance_m != null && m.lifts.some((l) => sameLift(info.get(s.exercise_id)?.name, l)))
    if (!bouts.length) continue
    const best = top(bouts, (s) => s.distance_m!)
    for (const km of m.km) if (best.distance_m! >= km * 1000 - 5) add(`dist:${m.key}:${km}`, best.exercise_id, best, km)
  }
  for (const n of WORKOUT_MILESTONES) if (count === n) add(`workouts:${n}`, null, null, n)
  return out
}

// ---------- The whole history ----------

/** Workouts in the order they were done (date, then start time, then id). */
export const inWorkoutOrder = <T extends { id: string; date: string; started_at?: string | null }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => a.date.localeCompare(b.date) || (a.started_at ?? '').localeCompare(b.started_at ?? '') || a.id.localeCompare(b.id))

/**
 * Every record and milestone in these finished workouts, oldest first. Pass
 * every finished workout (with or without sets) so workout counts are right.
 */
export function findRecords(sessions: RecordSession[], info: ExerciseInfo, weighIns: { date: string; kg: number }[] = []): PersonalRecord[] {
  const out: PersonalRecord[] = []
  const bests: Record<string, Bests> = {}
  const earned = new Set<string>()
  inWorkoutOrder(sessions).forEach((s, i) => {
    out.push(...sessionRecords(bests, s, info), ...sessionMilestones(s, info, earned, i + 1, weighIns))
    for (const x of s.sets) bests[x.exercise_id] = addToBests(bests[x.exercise_id] ?? emptyBests(), x, info.get(x.exercise_id))
  })
  return out
}

// ---------- Showing them ----------

export const RECORD_LABEL: Record<Exclude<RecordKind, 'milestone'>, string> = {
  weight: 'Weight PR', reps: 'Rep PR', e1rm: '1RM PR', bw_reps: 'Rep PR', distance: 'Distance PR', duration: 'Duration PR', pace: 'Pace PR',
}

/** Load milestones show in the viewer's unit only (both are earned). */
export function shownTo(r: PersonalRecord, u: UnitSystem): boolean {
  if (r.kind !== 'milestone' || !r.milestone?.startsWith('load:')) return true
  return r.milestone.endsWith(u === 'imperial' ? 'lb' : 'kg')
}

/** The records a viewer sees, newest first (records before milestones on the same day). */
export const visibleRecords = (rs: PersonalRecord[], u: UnitSystem) =>
  rs.filter((r) => shownTo(r, u)).sort((a, b) => b.date.localeCompare(a.date) || Number(a.kind === 'milestone') - Number(b.kind === 'milestone'))

/** "Weight PR", "100 kg bench press", "1.5× bodyweight squat", "10 pull-ups", "50 workouts logged". */
export function recordTitle(r: PersonalRecord): string {
  if (r.kind !== 'milestone') return RECORD_LABEL[r.kind]
  const [type, key, n] = (r.milestone ?? '').split(':')
  if (type === 'load') {
    const m = LOAD_MILESTONES.find((x) => x.key === key)
    const unit = n.endsWith('lb') ? 'lb' : 'kg'
    return `${parseFloat(n)} ${unit} ${m?.short ?? r.exercise.toLowerCase()}`
  }
  if (type === 'bw') return BODYWEIGHT_MILESTONES.find((x) => x.key === key && String(x.times) === n)?.label ?? 'Bodyweight milestone'
  if (type === 'reps') {
    const m = REP_MILESTONES.find((x) => x.key === key)
    return Number(n) === 1 ? m?.one ?? 'First rep' : `${n} ${m?.many ?? 'reps'}`
  }
  if (type === 'workouts') return `${key} workouts logged`
  if (type === 'dist') {
    const m = DISTANCE_MILESTONES.find((x) => x.key === key)
    if (key === 'run' && n === '21.1') return 'Half-marathon distance'
    if (key === 'run' && n === '42.2') return 'Marathon distance'
    return `${n} km ${m?.noun ?? 'bout'}`
  }
  return 'Milestone'
}

/** The set, in the viewer's unit: "85 kg × 6", "BW × 12", "5.2 km in 28:30". */
export function recordSet(r: PersonalRecord, u: UnitSystem): string {
  if (r.duration_s != null) return r.distance_m ? `${distanceText(r.distance_m, u)} in ${clock(r.duration_s)}` : clock(r.duration_s)
  return r.reps == null ? '' : `${r.weight_kg != null && r.weight_kg > 0 ? loadWeight(r.weight_kg, u) : 'BW'} × ${r.reps}${r.rpe != null ? ` @${r.rpe}` : ''}`
}

/** What it beat: "was 82.5 kg", "was 7 reps", "est. 1RM 99 kg, was 96 kg". */
export function recordChange(r: PersonalRecord, u: UnitSystem): string {
  if (r.kind === 'weight') return r.previous != null ? `was ${loadWeight(r.previous, u)}` : ''
  if (r.kind === 'e1rm') return `est. 1RM ${loadWeight(r.value, u)}${r.previous != null ? `, was ${loadWeight(r.previous, u)}` : ''}`
  if (r.kind === 'reps' || r.kind === 'bw_reps') return r.previous != null ? `was ${r.previous} rep${r.previous === 1 ? '' : 's'}` : ''
  if (r.kind === 'distance') return r.previous != null ? `was ${distanceText(r.previous * 1000, u)}` : ''
  if (r.kind === 'duration') return r.previous != null ? `was ${clock(r.previous * 60)}` : ''
  if (r.kind === 'pace') return `${paceText(r.value, u)}${r.previous != null ? `, was ${paceText(r.previous, u)}` : ''}`
  return ''
}

/** Records grouped by the set that made them (a set can be a weight and a 1RM record), in the given order. */
export function bySet(rs: PersonalRecord[]): { key: string; first: PersonalRecord; records: PersonalRecord[] }[] {
  const out: { key: string; first: PersonalRecord; records: PersonalRecord[] }[] = []
  for (const r of rs) {
    const key = r.set_number != null ? `${r.session_id}:${r.exercise_id}:${r.set_number}` : `${r.session_id}:${r.milestone}`
    const g = out.find((x) => x.key === key)
    if (g) g.records.push(r)
    else out.push({ key, first: r, records: [r] })
  }
  return out
}

/** "1 new personal record", "3 new personal records" (milestones included). */
export const recordCount = (n: number) => `${n} new personal record${n === 1 ? '' : 's'}`

/** Records on or after `from` (YYYY-MM-DD). */
export const recordsSince = (rs: PersonalRecord[], from: string) => rs.filter((r) => r.date >= from)
