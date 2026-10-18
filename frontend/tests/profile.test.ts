// Unit tests for the profile answer checks (src/lib/profile.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heightProblem, nameProblem, phoneProblem, textProblem, weightProblem } from '../src/lib/profile.ts'

test('phone: optional; common formats pass', () => {
  for (const ok of ['', '   ', '+1 555 0100', '(555) 010-0123', '020 7946 0958', '+44.20.7946.0958', '5550100']) {
    assert.equal(phoneProblem(ok), null, ok)
  }
})

test('phone: letters, too few or too many digits, or too long are refused', () => {
  for (const bad of ['call me', '555-CALL', '12345', '+1234567890123456', '1   2   3   4   5   6   7   8   9', '++1 555 0100', '555 0100 ext 4']) {
    assert.equal(phoneProblem(bad), 'Check this phone number.', bad)
  }
})

test('height, weight, name and free text', () => {
  assert.equal(heightProblem('', 'metric'), null)
  assert.equal(heightProblem('170', 'metric'), null)
  assert.equal(heightProblem('67', 'imperial'), null)
  assert.ok(heightProblem('300', 'metric'))
  assert.equal(weightProblem('', 'metric'), null)
  assert.ok(weightProblem('', 'metric', true))
  assert.equal(weightProblem('150', 'imperial'), null)
  assert.ok(weightProblem('20', 'metric'))
  assert.ok(nameProblem('  '))
  assert.ok(nameProblem('x'.repeat(81)))
  assert.equal(nameProblem('Aisha'), null)
  assert.equal(textProblem('x'.repeat(2000)), null)
  assert.ok(textProblem('x'.repeat(2001)))
})
