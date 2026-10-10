// Unit tests for weight conversion and rounding (src/lib/units.ts).
// Weights are stored in kg (two decimals) and shown in each user's unit.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bodyValue, bodyWeight, inputFromKg, kgFromInput, kgToLb, lbToKg, loadValue, loadWeight, roundTo, unitLabel, weightChange,
} from '../src/lib/units.ts'

/** Every value from `from` to `to` in steps of 0.1, without float drift. */
const tenths = (from: number, to: number) => Array.from({ length: Math.round((to - from) * 10) + 1 }, (_, i) => roundTo(from + i / 10, 0.1))

test('the factor is exact', () => {
  assert.equal(lbToKg(1), 0.45359237)
  assert.ok(Math.abs(kgToLb(lbToKg(123.4)) - 123.4) < 1e-9)
})

test('a weight typed in lb comes back exactly (0.1 lb steps, 20–700 lb)', () => {
  for (const lb of tenths(20, 700)) {
    const stored = kgFromInput(lb, 'imperial')
    assert.equal(Number(inputFromKg(stored, 'imperial')), lb, `${lb} lb → ${stored} kg → ${inputFromKg(stored, 'imperial')} lb`)
    assert.equal(bodyValue(stored, 'imperial'), lb)
  }
})

test('a weight typed in kg comes back exactly (0.1 kg steps, 10–320 kg)', () => {
  for (const kg of tenths(10, 320)) {
    const stored = kgFromInput(kg, 'metric')
    assert.equal(stored, kg)
    assert.equal(Number(inputFromKg(stored, 'metric')), kg)
  }
})

test('kg → lb → kg doesn\'t drift when an edited value is saved again', () => {
  for (const kg of [...tenths(30, 200), 79.38, 82.55, 72.57]) {
    let stored = kg
    // Show in lb, save it back unchanged, a few times over: the value settles at once and stays.
    const first = kgFromInput(Number(inputFromKg(stored, 'imperial')), 'imperial')
    assert.ok(Math.abs(first - kg) <= 0.03, `${kg} kg moved to ${first} kg`)
    for (let i = 0; i < 5; i++) stored = kgFromInput(Number(inputFromKg(stored, 'imperial')), 'imperial')
    assert.equal(stored, first)
    // And switching back to kg shows the same tenth.
    assert.equal(Number(inputFromKg(stored, 'metric')), roundTo(kg, 0.1))
  }
})

test('display rounding: body weight to 0.1, loads to 0.1 lb or 0.5 kg', () => {
  assert.equal(bodyWeight(71.63, 'metric'), '71.6 kg')
  assert.equal(bodyWeight(72.57, 'imperial'), '160 lb')
  assert.equal(bodyWeight(71.6, 'imperial'), '157.9 lb')
  assert.equal(loadWeight(82.5, 'metric'), '82.5 kg')
  assert.equal(loadWeight(79.38, 'metric'), '79.5 kg')
  assert.equal(loadWeight(81.2, 'metric'), '81 kg')
  assert.equal(loadWeight(82.5, 'imperial'), '181.9 lb')
  assert.equal(loadValue(20, 'imperial'), 44.1)
})

test('changes keep their sign and unit', () => {
  assert.equal(weightChange(-2.8, 'metric'), '−2.8 kg')
  assert.equal(weightChange(-2.8, 'imperial'), '−6.2 lb')
  assert.equal(weightChange(0.3, 'imperial'), '+0.7 lb')
  assert.equal(unitLabel('imperial'), 'lb')
  assert.equal(unitLabel('metric'), 'kg')
})

test('roundTo has no float noise', () => {
  assert.equal(roundTo(0.1 + 0.2, 0.1), 0.3)
  assert.equal(roundTo(72.60000001, 0.1), 72.6)
  assert.equal(roundTo(81.24, 0.5), 81)
  assert.equal(roundTo(81.26, 0.5), 81.5)
})
