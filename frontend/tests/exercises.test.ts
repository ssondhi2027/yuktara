// Unit tests for the coach's own exercise form checks (src/lib/exercises.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyExercise, exerciseProblems } from '../src/lib/exercises.ts'

const library = new Set(['back squat', 'push-up'])
const own = new Set(['landmine press'])
const ok = { ...emptyExercise(), name: 'Belt squat', equipment: 'machine', primary: ['quads' as const], secondary: ['glutes' as const] }

test('a complete exercise has no problems', () => {
  assert.deepEqual(exerciseProblems(ok, library, own), {})
})

test('name: 2–80 characters, not a library or own duplicate (any case)', () => {
  assert.ok(exerciseProblems({ ...ok, name: ' x ' }, library, own).name)
  assert.ok(exerciseProblems({ ...ok, name: 'x'.repeat(81) }, library, own).name)
  assert.match(exerciseProblems({ ...ok, name: 'Back Squat' }, library, own).name!, /library already has/)
  assert.match(exerciseProblems({ ...ok, name: 'LANDMINE press ' }, library, own).name!, /already have/)
})

test('muscles: at least one main; none both main and secondary', () => {
  assert.ok(exerciseProblems({ ...ok, primary: [] }, library, own).primary)
  assert.ok(exerciseProblems({ ...ok, secondary: ['quads'] }, library, own).secondary)
})

test('equipment and cue length limits match the database', () => {
  assert.ok(exerciseProblems({ ...ok, equipment: 'x'.repeat(41) }, library, own).equipment)
  assert.equal(exerciseProblems({ ...ok, cue: 'x'.repeat(300) }, library, own).cue, undefined)
  assert.ok(exerciseProblems({ ...ok, cue: 'x'.repeat(301) }, library, own).cue)
})
