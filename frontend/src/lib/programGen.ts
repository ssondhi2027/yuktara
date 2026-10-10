// Builds a first-draft program from a client's setup answers. The coach then
// edits it in the builder. Everything here is plain data plus a few small
// functions, runs in the browser, and uses only exercises from the library.
//
//   goal        → split by days, reps, rest, RPE and notes (GOALS, SPLITS)
//   experience  → exercises per workout, sets, levels and equipment allowed (LEVELS)
//   days        → which workouts and on which weekdays (SPLITS, SCHEDULE)
//   location    → home allows bodyweight and dumbbells only (LOCATIONS)
//
// Weekly hard sets are counted like muscle_sets_for_week: each set counts once
// for every primary muscle of its exercise. Injuries are not interpreted; the
// builder shows them to the coach.
//
// Type-only imports keep this module loadable by Node's test runner
// (frontend/tests/programGen.test.ts).

import type { ExerciseLevel, GoalType, MuscleGroup, TrainLocation } from '../types/db'

export interface GenExercise {
  id: string
  name: string
  level: ExerciseLevel
  equipment: string
  primary: MuscleGroup[]
  secondary: MuscleGroup[]
}

export interface GenInput {
  goal: GoalType | null
  experience: ExerciseLevel | null
  training_days: number | null
  train_location: TrainLocation | null
}

export interface GenSlot { exercise_id: string; name: string; sets: number; reps: string; rpe: number; rest_seconds: number; notes: string }
export interface GenWorkout { name: string; day_of_week: number; notes: string; exercises: GenSlot[] }
export interface GenProgram {
  name: string
  weeks: number
  goal: GoalType
  level: ExerciseLevel
  days_per_week: number
  workouts: GenWorkout[]
  /** weekly hard sets per muscle (primary muscles only) */
  weekly_sets: Partial<Record<MuscleGroup, number>>
  /** things the coach should look at (gaps in the library, clamped answers) */
  warnings: string[]
}

type Kind = 'compound' | 'isolation'
interface Slot { muscle: MuscleGroup; kind: Kind }
type DayKey = 'full_a' | 'full_b' | 'full_c' | 'upper' | 'lower' | 'push' | 'pull' | 'legs'

// ---------- Rules (data) ----------

/** Workouts by type; slots in priority order (beginners get the first few). */
export const DAYS: Record<DayKey, { label: string; slots: Slot[] }> = {
  full_a: { label: 'Full body', slots: [
    { muscle: 'quads', kind: 'compound' }, { muscle: 'chest', kind: 'compound' }, { muscle: 'upper_back', kind: 'compound' },
    { muscle: 'hamstrings', kind: 'compound' }, { muscle: 'shoulders', kind: 'isolation' }, { muscle: 'abs', kind: 'isolation' },
    { muscle: 'biceps', kind: 'isolation' },
  ] },
  full_b: { label: 'Full body', slots: [
    { muscle: 'shoulders', kind: 'compound' }, { muscle: 'lats', kind: 'compound' }, { muscle: 'hamstrings', kind: 'compound' },
    { muscle: 'quads', kind: 'compound' }, { muscle: 'triceps', kind: 'isolation' }, { muscle: 'calves', kind: 'isolation' },
    { muscle: 'obliques', kind: 'isolation' },
  ] },
  full_c: { label: 'Full body', slots: [
    { muscle: 'glutes', kind: 'isolation' }, { muscle: 'chest', kind: 'compound' }, { muscle: 'lats', kind: 'compound' },
    { muscle: 'quads', kind: 'isolation' }, { muscle: 'shoulders', kind: 'isolation' }, { muscle: 'abs', kind: 'isolation' },
    { muscle: 'biceps', kind: 'isolation' },
  ] },
  upper: { label: 'Upper', slots: [
    { muscle: 'chest', kind: 'compound' }, { muscle: 'upper_back', kind: 'compound' }, { muscle: 'shoulders', kind: 'compound' },
    { muscle: 'lats', kind: 'compound' }, { muscle: 'triceps', kind: 'isolation' }, { muscle: 'biceps', kind: 'isolation' },
    { muscle: 'shoulders', kind: 'isolation' },
  ] },
  lower: { label: 'Lower', slots: [
    { muscle: 'quads', kind: 'compound' }, { muscle: 'hamstrings', kind: 'compound' }, { muscle: 'glutes', kind: 'isolation' },
    { muscle: 'quads', kind: 'isolation' }, { muscle: 'calves', kind: 'isolation' }, { muscle: 'abs', kind: 'isolation' },
    { muscle: 'hamstrings', kind: 'isolation' },
  ] },
  push: { label: 'Push', slots: [
    { muscle: 'chest', kind: 'compound' }, { muscle: 'shoulders', kind: 'compound' }, { muscle: 'chest', kind: 'compound' },
    { muscle: 'shoulders', kind: 'isolation' }, { muscle: 'triceps', kind: 'isolation' }, { muscle: 'triceps', kind: 'isolation' },
    { muscle: 'abs', kind: 'isolation' },
  ] },
  pull: { label: 'Pull', slots: [
    { muscle: 'lats', kind: 'compound' }, { muscle: 'upper_back', kind: 'compound' }, { muscle: 'biceps', kind: 'isolation' },
    { muscle: 'lats', kind: 'isolation' }, { muscle: 'biceps', kind: 'isolation' }, { muscle: 'traps', kind: 'isolation' },
    { muscle: 'forearms', kind: 'isolation' },
  ] },
  legs: { label: 'Legs', slots: [
    { muscle: 'quads', kind: 'compound' }, { muscle: 'hamstrings', kind: 'compound' }, { muscle: 'glutes', kind: 'isolation' },
    { muscle: 'quads', kind: 'isolation' }, { muscle: 'calves', kind: 'isolation' }, { muscle: 'adductors', kind: 'isolation' },
    { muscle: 'hamstrings', kind: 'isolation' },
  ] },
}

/** [workout type, variant]: variant 1 picks the next-best exercises, so a repeated day isn't identical. */
type Day = [DayKey, number]
const FULL_2: Day[] = [['full_a', 0], ['full_b', 0]]
const FULL_3: Day[] = [['full_a', 0], ['full_b', 0], ['full_c', 0]]
const UL_4: Day[] = [['upper', 0], ['lower', 0], ['upper', 1], ['lower', 1]]
const ULF_5: Day[] = [['upper', 0], ['lower', 0], ['full_a', 0], ['upper', 1], ['lower', 1]]
const PPL_6: Day[] = [['push', 0], ['pull', 0], ['legs', 0], ['push', 1], ['pull', 1], ['legs', 1]]

/** The split for each goal and number of training days (2–6). */
export const SPLITS: Record<GoalType, Record<number, { label: string; days: Day[] }>> = {
  // Hypertrophy splits.
  muscle_gain: {
    2: { label: 'full body', days: FULL_2 }, 3: { label: 'full body', days: FULL_3 }, 4: { label: 'upper/lower', days: UL_4 },
    5: { label: 'push/pull/legs + upper/lower', days: [['push', 0], ['pull', 0], ['legs', 0], ['upper', 1], ['lower', 1]] },
    6: { label: 'push/pull/legs', days: PPL_6 },
  },
  // Full body or upper/lower, short rests.
  fat_loss: {
    2: { label: 'full body', days: FULL_2 }, 3: { label: 'full body', days: FULL_3 }, 4: { label: 'upper/lower', days: UL_4 },
    5: { label: 'upper/lower + full body', days: ULF_5 },
    6: { label: 'upper/lower + full body', days: [...ULF_5, ['full_b', 0]] },
  },
  // Compound strength focus.
  performance: {
    2: { label: 'full body', days: FULL_2 }, 3: { label: 'full body', days: FULL_3 }, 4: { label: 'upper/lower', days: UL_4 },
    5: { label: 'upper/lower + full body', days: ULF_5 }, 6: { label: 'push/pull/legs', days: PPL_6 },
  },
  // Balanced full body, conservative volume.
  health: {
    2: { label: 'full body', days: FULL_2 }, 3: { label: 'full body', days: FULL_3 },
    4: { label: 'full body', days: [...FULL_3, ['full_a', 1]] },
    5: { label: 'full body', days: [...FULL_3, ['full_a', 1], ['full_b', 1]] },
    6: { label: 'full body', days: [...FULL_3, ['full_a', 1], ['full_b', 1], ['full_c', 1]] },
  },
}

/** Weekdays (0 = Sunday) for each number of training days, with rest days spread out. */
export const SCHEDULE: Record<number, number[]> = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6] }

interface Dose { reps: string; rest: number }
export const GOALS: Record<GoalType, {
  name: string
  compound: Dose & { beginnerReps?: string }
  isolation: Dose
  rpe: Record<ExerciseLevel, number>
  setsDelta: number
  notes: Record<Kind, string>
  workoutNote: string
}> = {
  muscle_gain: {
    name: 'Muscle gain',
    compound: { reps: '6–10', rest: 120 }, isolation: { reps: '10–15', rest: 75 },
    rpe: { beginner: 7.5, intermediate: 8, advanced: 8.5 }, setsDelta: 0,
    notes: { compound: 'Add weight once every set reaches the top of the range.', isolation: 'Slow lowering, full range; last set close to failure.' },
    workoutNote: 'Hypertrophy: moderate reps, most sets 1–3 reps short of failure.',
  },
  fat_loss: {
    name: 'Fat loss',
    compound: { reps: '8–12', rest: 75 }, isolation: { reps: '12–15', rest: 45 },
    rpe: { beginner: 7, intermediate: 7.5, advanced: 8 }, setsDelta: 0,
    notes: { compound: 'Keep rests short; start the next set when your breathing settles.', isolation: 'Pair with the next exercise if the gym allows.' },
    workoutNote: 'Higher density: keep to the listed rests, then 10 minutes of brisk walking.',
  },
  performance: {
    name: 'Performance',
    compound: { reps: '3–5', rest: 180, beginnerReps: '5–6' }, isolation: { reps: '8–10', rest: 90 },
    rpe: { beginner: 7.5, intermediate: 8, advanced: 8.5 }, setsDelta: 0,
    notes: { compound: 'Main lift: fast, crisp reps; end the set if the bar speed drops a lot.', isolation: 'Supports the main lifts; leave 2 reps in reserve.' },
    workoutNote: 'Strength focus: warm up to the first work set, then the compounds first.',
  },
  health: {
    name: 'Health',
    compound: { reps: '8–10', rest: 90 }, isolation: { reps: '12–15', rest: 60 },
    rpe: { beginner: 7, intermediate: 7, advanced: 7.5 }, setsDelta: -1,
    notes: { compound: 'Smooth, controlled reps; stop about 3 reps short of failure.', isolation: 'Light and easy on the joints.' },
    workoutNote: 'Balanced and conservative: you should finish feeling better than you started.',
  },
}

/** The usual first choices: these rank ahead of everything else, then by equipment. */
export const STAPLES = [
  'Back squat', 'Leg press', 'Goblet squat', 'Romanian deadlift', 'Lying leg curl', 'Hip thrust', 'Glute bridge',
  'Barbell bench press', 'Dumbbell bench press', 'Bent-over barbell row', 'Seated cable row', 'Chest-supported dumbbell row',
  'Pull-up', 'Lat pulldown', 'Single-arm dumbbell row', 'Overhead press', 'Seated dumbbell shoulder press', 'Lateral raise',
  'Rope pushdown', 'Dumbbell curl', 'Standing calf raise', 'Plank', 'Dead bug',
]

/** Equipment preference: lower ranks first. Unlisted equipment ranks last. */
type Ranking = Partial<Record<string, number>>
const SIMPLE: Ranking = { machine: 0, dumbbells: 1, cable: 2, bodyweight: 3 }
const BARBELL_FIRST: Ranking = { barbell: 0, dumbbells: 1, 'pull-up bar': 1, machine: 2, cable: 2, bodyweight: 3 }
const ISOLATION: Ranking = { cable: 0, dumbbells: 1, machine: 1, barbell: 2, bodyweight: 2.5 }

export const LEVELS: Record<ExerciseLevel, {
  exercises: number
  sets: Record<Kind, number>
  levels: ExerciseLevel[]
  noBarbell: boolean
  rank: Record<Kind, Ranking>
  weeks: number
  /** weekly hard sets per major muscle */
  range: [number, number]
}> = {
  beginner: {
    exercises: 5, sets: { compound: 3, isolation: 2 }, levels: ['beginner'], noBarbell: true,
    rank: { compound: SIMPLE, isolation: SIMPLE }, weeks: 8, range: [4, 12],
  },
  intermediate: {
    exercises: 6, sets: { compound: 3, isolation: 3 }, levels: ['beginner', 'intermediate'], noBarbell: false,
    rank: { compound: BARBELL_FIRST, isolation: ISOLATION }, weeks: 10, range: [6, 16],
  },
  advanced: {
    exercises: 7, sets: { compound: 4, isolation: 3 }, levels: ['beginner', 'intermediate', 'advanced'], noBarbell: false,
    rank: { compound: BARBELL_FIRST, isolation: ISOLATION }, weeks: 12, range: [8, 20],
  },
}

/** Health keeps volume lower whatever the experience. */
export const HEALTH_RANGE: [number, number] = [3, 10]

export const LOCATIONS: Record<TrainLocation, string[] | null> = {
  gym: null, // everything
  both: null,
  home: ['bodyweight', 'dumbbells'],
}

/** Muscles whose weekly sets are balanced into the range. */
export const MAJOR_MUSCLES: MuscleGroup[] = ['chest', 'upper_back', 'lats', 'shoulders', 'quads', 'hamstrings', 'glutes']

const MAX_SETS_PER_EXERCISE = 5
const MIN_SETS_PER_EXERCISE = 2

// ---------- Generator ----------

/** Compound = works several muscles hard (two primaries, or three muscles in all). */
export const kindOf = (e: GenExercise): Kind =>
  e.primary.length >= 2 || e.primary.length + e.secondary.length >= 3 ? 'compound' : 'isolation'

/** Exercises the client can do, given their experience and where they train. */
export function eligible(library: GenExercise[], level: ExerciseLevel, location: TrainLocation): GenExercise[] {
  const lv = LEVELS[level]
  const equipment = LOCATIONS[location]
  return library.filter((e) =>
    lv.levels.includes(e.level)
    && !(lv.noBarbell && e.equipment === 'barbell')
    && (!equipment || equipment.includes(e.equipment)))
}

function candidates(pool: GenExercise[], slot: Slot, level: ExerciseLevel, goal: GoalType): GenExercise[] {
  const working = pool.filter((e) => e.primary.includes(slot.muscle))
  const ofKind = working.filter((e) => kindOf(e) === slot.kind)
  const list = ofKind.length ? ofKind : working
  // Staples first, then equipment: simple kit for health and beginners, barbell compounds for the rest.
  // (Muscle order inside an exercise isn't used: the database doesn't keep one.)
  const rank = goal === 'health' ? SIMPLE : LEVELS[level].rank[slot.kind]
  const score = (e: GenExercise) => (STAPLES.includes(e.name) ? 0 : 10) + (rank[e.equipment] ?? 5)
  return [...list].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))
}

export function weeklySets(workouts: GenWorkout[], library: GenExercise[]): Partial<Record<MuscleGroup, number>> {
  const byId = new Map(library.map((e) => [e.id, e]))
  const out: Partial<Record<MuscleGroup, number>> = {}
  for (const w of workouts) {
    for (const x of w.exercises) for (const m of byId.get(x.exercise_id)?.primary ?? []) out[m] = (out[m] ?? 0) + x.sets
  }
  return out
}

/**
 * Nudges sets so each major muscle lands in the weekly range (when the library
 * allows): sets first, then dropping or adding an exercise (`grow`).
 */
function balance(workouts: GenWorkout[], library: GenExercise[], [min, max]: [number, number], grow: (m: MuscleGroup) => GenSlot | null) {
  const byId = new Map(library.map((e) => [e.id, e]))
  const slots = workouts.flatMap((w) => w.exercises)
  const hits = (x: GenSlot, m: MuscleGroup) => byId.get(x.exercise_id)?.primary.includes(m) ?? false
  for (let guard = 0; guard < 200; guard++) {
    const sets = weeklySets(workouts, library)
    const low = MAJOR_MUSCLES.find((m) => (sets[m] ?? 0) > 0 && (sets[m] ?? 0) < min)
    const high = (Object.keys(sets) as MuscleGroup[]).find((m) => (sets[m] ?? 0) > max)
    if (high) {
      // Take a set from the exercise hitting it that matters least to other muscles.
      const pick = slots.filter((x) => hits(x, high) && x.sets > MIN_SETS_PER_EXERCISE)
        .sort((a, b) => (byId.get(a.exercise_id)?.primary.length ?? 0) - (byId.get(b.exercise_id)?.primary.length ?? 0) || b.sets - a.sets)[0]
      if (pick) { pick.sets--; continue }
      // Every exercise is at its minimum: drop the lowest-priority one (last in its workout) that
      // leaves the workout with 3+ exercises and doesn't push another major muscle under the range.
      const drop = workouts
        .filter((w) => w.exercises.length > 3)
        .flatMap((w) => w.exercises.map((x, i) => ({ w, x, i })))
        .filter(({ x }) => hits(x, high) && (byId.get(x.exercise_id)?.primary ?? []).every((m) =>
          m === high || !MAJOR_MUSCLES.includes(m) || (sets[m] ?? 0) - x.sets >= min))
        .sort((a, b) => b.i - a.i)[0]
      if (drop) {
        drop.w.exercises.splice(drop.i, 1)
        slots.splice(slots.indexOf(drop.x), 1)
        continue
      }
    }
    if (low) {
      const pick = slots.filter((x) => hits(x, low) && x.sets < MAX_SETS_PER_EXERCISE).sort((a, b) => a.sets - b.sets)[0]
      if (pick) { pick.sets++; continue }
      const added = grow(low)
      if (added) { slots.push(added); continue }
    }
    break
  }
}

export function generateProgram(input: GenInput, library: GenExercise[]): GenProgram {
  const warnings: string[] = []
  const goal: GoalType = input.goal ?? 'health'
  const level: ExerciseLevel = input.experience ?? 'beginner'
  const location: TrainLocation = input.train_location ?? 'gym'
  let days = input.training_days ?? 3
  if (!input.goal) warnings.push('No goal in their setup answers: built a balanced (health) program.')
  if (!input.experience) warnings.push('No experience level in their setup answers: built for a beginner.')
  if (days < 2 || days > 6) {
    warnings.push(`They chose ${days} training day${days === 1 ? '' : 's'} a week; this plan uses ${days < 2 ? 2 : 6}. Adjust if needed.`)
    days = Math.min(6, Math.max(2, days))
  }

  const g = GOALS[goal]
  const lv = LEVELS[level]
  const split = SPLITS[goal][days]
  const pool = eligible(library, level, location)
  const perWorkout = goal === 'health' ? Math.min(lv.exercises, 5) : lv.exercises
  const missing = new Set<MuscleGroup>()
  const makeSlot = (e: GenExercise): GenSlot => {
    const kind = kindOf(e)
    const dose = kind === 'compound' ? g.compound : g.isolation
    return {
      exercise_id: e.id,
      name: e.name,
      sets: Math.max(MIN_SETS_PER_EXERCISE, lv.sets[kind] + g.setsDelta),
      reps: kind === 'compound' && level === 'beginner' && g.compound.beginnerReps ? g.compound.beginnerReps : dose.reps,
      rpe: g.rpe[level],
      rest_seconds: dose.rest,
      notes: g.notes[kind],
    }
  }
  const seenLabel: Record<string, number> = {}

  const workouts: GenWorkout[] = split.days.map(([key, variant], i) => {
    const day = DAYS[key]
    const n = (seenLabel[day.label] = (seenLabel[day.label] ?? 0) + 1)
    const used = new Set<string>()
    const exercises: GenSlot[] = []
    for (const slot of day.slots) {
      if (exercises.length >= perWorkout) break
      const list = candidates(pool, slot, level, goal).filter((e) => !used.has(e.id))
      if (!list.length) { missing.add(slot.muscle); continue }
      const e = list[variant % list.length]
      used.add(e.id)
      exercises.push(makeSlot(e))
    }
    return { name: `${day.label} ${'ABCDEF'[n - 1]}`, day_of_week: SCHEDULE[days][i], notes: g.workoutNote, exercises }
  })

  // Adds another exercise for a muscle that's under its range, to the workout with the fewest exercises.
  const grow = (m: MuscleGroup): GenSlot | null => {
    const w = [...workouts].sort((a, b) => a.exercises.length - b.exercises.length)[0]
    if (!w || w.exercises.length >= lv.exercises + 1) return null
    const inWeek = new Set(workouts.flatMap((x) => x.exercises.map((e) => e.exercise_id)))
    const options = candidates(pool, { muscle: m, kind: 'compound' }, level, goal).filter((e) => !w.exercises.some((x) => x.exercise_id === e.id))
    const e = options.find((x) => !inWeek.has(x.id)) ?? options[0]
    if (!e) return null
    const slot = makeSlot(e)
    w.exercises.push(slot)
    return slot
  }
  balance(workouts, library, goal === 'health' ? HEALTH_RANGE : lv.range, grow)

  for (const m of missing) {
    warnings.push(`No ${location === 'home' ? 'home ' : ''}${m.replace('_', ' ')} exercise for this level in the library: add one or train it another way.`)
  }

  return {
    name: `${g.name}: ${split.label}, ${days} days`,
    weeks: lv.weeks,
    goal,
    level,
    days_per_week: days,
    workouts,
    weekly_sets: weeklySets(workouts, library),
    warnings,
  }
}
