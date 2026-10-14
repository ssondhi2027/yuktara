// Unit tests for the targets helpers (src/lib/targets.ts) and profile validation (src/lib/profile.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calorieMismatch, effectiveFromProblem, macroCalories, targetsProblem } from '../src/lib/targets.ts'
import { heightProblem, nameProblem, textProblem, weightProblem } from '../src/lib/profile.ts'

const base = { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 67, water_ml: 2500, steps: 9000, sleep_h: 7.5 }

test('calories from macros: 4 / 4 / 9', () => {
  assert.equal(macroCalories({ protein_g: 150, carbs_g: 200, fat_g: 67 }), 150 * 4 + 200 * 4 + 67 * 9)
  assert.equal(macroCalories({ protein_g: 0, carbs_g: 0, fat_g: 0 }), 0)
  assert.equal(macroCalories({ protein_g: 10.4, carbs_g: 0, fat_g: 0 }), 42) // rounded
})

test('no warning within about 5%', () => {
  assert.equal(calorieMismatch(base), null) // macros = 2003 kcal
  assert.equal(calorieMismatch({ ...base, calories: 2100 }), null) // 4.6% under
  assert.equal(calorieMismatch({ ...base, calories: 1910 }), null) // 4.9% over
})

test('a warning past 5%, saying which way', () => {
  const under = calorieMismatch({ ...base, calories: 2400 })
  assert.match(under ?? '', /2,003 kcal, 17% less than the calorie target/)
  const over = calorieMismatch({ ...base, calories: 1700 })
  assert.match(over ?? '', /18% more/)
})

test('nothing to compare until calories and a macro are in', () => {
  assert.equal(calorieMismatch({ calories: 0, protein_g: 150, carbs_g: 0, fat_g: 0 }), null)
  assert.equal(calorieMismatch({ calories: 2000, protein_g: 0, carbs_g: 0, fat_g: 0 }), null)
})

test('targets validation', () => {
  assert.equal(targetsProblem(base), null)
  assert.match(targetsProblem({ ...base, calories: 500 }) ?? '', /800 and 8,000/)
  assert.match(targetsProblem({ ...base, fat_g: 500 }) ?? '', /macro/)
  assert.match(targetsProblem({ ...base, steps: 200_000 }) ?? '', /Steps/)
  assert.match(targetsProblem({ ...base, sleep_h: 2 }) ?? '', /Sleep/)
  assert.equal(targetsProblem({ ...base, sleep_h: 0 }), null) // no sleep target is fine
  assert.match(targetsProblem({ ...base, water_ml: 20_000 }) ?? '', /Water/)
})

test('targets start today or later', () => {
  assert.equal(effectiveFromProblem('2026-10-14', '2026-10-14'), null)
  assert.equal(effectiveFromProblem('2026-10-19', '2026-10-14'), null)
  assert.match(effectiveFromProblem('2026-10-13', '2026-10-14') ?? '', /today or later/)
  assert.match(effectiveFromProblem('', '2026-10-14') ?? '', /Pick/)
})

test('height in cm or inches', () => {
  assert.equal(heightProblem('', 'metric'), null)
  assert.equal(heightProblem('170', 'metric'), null)
  assert.ok(heightProblem('70', 'metric'))
  assert.equal(heightProblem('70', 'imperial'), null)
  assert.ok(heightProblem('170', 'imperial'))
})

test('weight in kg or lb', () => {
  assert.equal(weightProblem('', 'imperial'), null)
  assert.equal(weightProblem('', 'imperial', true), 'Enter your current weight.')
  assert.equal(weightProblem('160', 'imperial'), null)
  assert.equal(weightProblem('72.5', 'metric'), null)
  assert.ok(weightProblem('50', 'imperial')) // 50 lb is too low
  assert.ok(weightProblem('400', 'metric'))
})

test('name and free text', () => {
  assert.ok(nameProblem('  '))
  assert.equal(nameProblem('Aisha Rahman'), null)
  assert.ok(nameProblem('x'.repeat(81)))
  assert.equal(textProblem('Sore knee'), null)
  assert.ok(textProblem('x'.repeat(2001)))
})
