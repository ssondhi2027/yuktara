// Unit tests for the program generator (src/lib/programGen.ts).
// Run with `npm test` (Node's built-in test runner; no extra dependencies).
// The exercise library comes from supabase/seed.sql, the same rows the app uses.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  eligible, generateProgram, HEALTH_RANGE, LEVELS, MAJOR_MUSCLES, SCHEDULE, type GenExercise,
} from '../src/lib/programGen.ts'

function libraryFromSeed(): GenExercise[] {
  const sql = readFileSync(new URL('../../supabase/seed.sql', import.meta.url), 'utf8')
  const row = /\('((?:[^']|'')+)', '(beginner|intermediate|advanced)', '([^']+)', '(?:[^']|'')*', '\{([^}]*)\}', '\{([^}]*)\}'\)/g
  const list = (s: string) => (s ? s.split(',') : []) as GenExercise['primary']
  return [...sql.matchAll(row)].map((m) => ({
    id: m[1].replace(/''/g, "'"), name: m[1].replace(/''/g, "'"), level: m[2] as GenExercise['level'],
    equipment: m[3], primary: list(m[4]), secondary: list(m[5]),
  }))
}

const library = libraryFromSeed()
const byId = new Map(library.map((e) => [e.id, e]))
const GOALS = ['fat_loss', 'muscle_gain', 'performance', 'health'] as const
const LEVEL_KEYS = ['beginner', 'intermediate', 'advanced'] as const
const PLACES = ['gym', 'home', 'both'] as const

test('the seed library parsed', () => {
  assert.ok(library.length >= 50, `only ${library.length} exercises parsed`)
})

for (const goal of GOALS) {
  for (const experience of LEVEL_KEYS) {
    for (const days of [2, 3, 4, 5, 6]) {
      for (const place of PLACES) {
        test(`${goal} · ${experience} · ${days} days · ${place}`, () => {
          const p = generateProgram({ goal, experience, training_days: days, train_location: place }, library)

          // Right number of workouts, on distinct weekdays from the schedule.
          assert.equal(p.workouts.length, days)
          assert.equal(p.days_per_week, days)
          assert.deepEqual(p.workouts.map((w) => w.day_of_week), SCHEDULE[days])

          for (const w of p.workouts) {
            assert.ok(w.exercises.length >= 3, `${w.name} has only ${w.exercises.length} exercises`)
            const ids = w.exercises.map((x) => x.exercise_id)
            assert.equal(new Set(ids).size, ids.length, `${w.name} repeats an exercise`)
            for (const x of w.exercises) {
              const e = byId.get(x.exercise_id)
              assert.ok(e, `${x.name} isn't in the library`)
              if (place === 'home') assert.ok(['bodyweight', 'dumbbells'].includes(e.equipment), `${e.name} (${e.equipment}) at home`)
              if (experience === 'beginner') {
                assert.notEqual(e.equipment, 'barbell', `${e.name} for a beginner`)
                assert.equal(e.level, 'beginner', `${e.name} is ${e.level}`)
              }
              assert.ok(x.sets >= 1 && x.sets <= 10, `${x.name}: ${x.sets} sets`)
              assert.ok(x.rpe >= 1 && x.rpe <= 10, `${x.name}: RPE ${x.rpe}`)
              assert.ok(x.reps.trim().length > 0 && x.rest_seconds > 0 && x.notes.length > 0)
            }
          }

          // Weekly hard sets per major muscle: in range when the library has an exercise for it, else a warning.
          const [min, max] = goal === 'health' ? HEALTH_RANGE : LEVELS[experience].range
          const pool = eligible(library, experience, place)
          for (const m of MAJOR_MUSCLES) {
            const sets = p.weekly_sets[m] ?? 0
            const available = pool.some((e) => e.primary.includes(m))
            if (!available) {
              assert.equal(sets, 0)
              assert.ok(p.warnings.some((w) => w.includes(m.replace('_', ' '))), `no warning for missing ${m}`)
            } else if (sets > 0) {
              assert.ok(sets >= min && sets <= max, `${m}: ${sets} weekly sets, expected ${min}–${max}`)
            }
          }
          for (const [m, sets] of Object.entries(p.weekly_sets)) assert.ok((sets ?? 0) <= max, `${m}: ${sets} weekly sets > ${max}`)
        })
      }
    }
  }
}

test('goals change the emphasis', () => {
  const make = (goal: (typeof GOALS)[number]) =>
    generateProgram({ goal, experience: 'intermediate', training_days: 4, train_location: 'gym' }, library)
  const strength = make('performance')
  const size = make('muscle_gain')
  const cut = make('fat_loss')
  const health = generateProgram({ goal: 'health', experience: 'intermediate', training_days: 4, train_location: 'gym' }, library)
  assert.equal(strength.workouts[0].exercises[0].reps, '3–5')
  assert.equal(size.workouts[0].exercises[0].reps, '6–10')
  assert.ok(cut.workouts[0].exercises[0].rest_seconds < size.workouts[0].exercises[0].rest_seconds, 'fat loss rests shorter')
  assert.ok(health.workouts.every((w) => w.name.startsWith('Full body')), 'health stays full body')
  assert.ok(size.workouts.some((w) => w.name.startsWith('Upper')), 'muscle gain at 4 days is upper/lower')
  const total = (p: typeof size) => Object.values(p.weekly_sets).reduce((a, b) => a + (b ?? 0), 0)
  assert.ok(total(health) < total(size), 'health has less volume')
})

test('experience changes volume and equipment', () => {
  const make = (experience: (typeof LEVEL_KEYS)[number]) =>
    generateProgram({ goal: 'muscle_gain', experience, training_days: 3, train_location: 'gym' }, library)
  const beginner = make('beginner')
  const advanced = make('advanced')
  assert.ok(advanced.workouts[0].exercises.length > beginner.workouts[0].exercises.length)
  assert.ok(advanced.workouts.some((w) => w.exercises.some((x) => byId.get(x.exercise_id)?.equipment === 'barbell')))
  assert.ok(beginner.workouts[0].exercises[0].rpe >= 7 && beginner.workouts[0].exercises[0].rpe <= 8)
})

test('missing answers fall back and say so', () => {
  const p = generateProgram({ goal: null, experience: null, training_days: 1, train_location: null }, library)
  assert.equal(p.workouts.length, 2)
  assert.equal(p.goal, 'health')
  assert.equal(p.level, 'beginner')
  assert.ok(p.warnings.length >= 3)
})

test('repeated days vary their exercises', () => {
  const p = generateProgram({ goal: 'muscle_gain', experience: 'advanced', training_days: 4, train_location: 'gym' }, library)
  const [upperA, , upperB] = p.workouts
  assert.notDeepEqual(upperA.exercises.map((x) => x.exercise_id), upperB.exercises.map((x) => x.exercise_id))
})

test('choices do not depend on the order of an exercise\'s muscles', () => {
  // The database returns exercise_muscles in no particular order.
  const shuffled = library.map((e) => ({ ...e, primary: [...e.primary].reverse(), secondary: [...e.secondary].reverse() }))
  const input = { goal: 'fat_loss', experience: 'intermediate', training_days: 4, train_location: 'gym' } as const
  const ids = (lib: GenExercise[]) => generateProgram(input, lib).workouts.map((w) => w.exercises.map((x) => x.exercise_id))
  assert.deepEqual(ids(shuffled), ids(library))
  assert.equal(generateProgram(input, library).workouts[1].exercises[0].name, 'Back squat')
})
