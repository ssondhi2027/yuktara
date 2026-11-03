// Daylight saving: date maths must step calendar days, not 24-hour blocks.
// On Nov 1, 2026 (US clocks go back) midnight + 24 h is 11 pm the same day, so
// "Nov 1 + 1 day" used to come out as Nov 1 and the Progress and Check-in
// pages hung in an endless day-by-day loop for anyone in a DST time zone.
// Node applies a TZ set at runtime; each test file runs in its own process.
process.env.TZ = 'America/New_York'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, programWeek, weekStart } from '../src/lib/dates.ts'
import { mondayOf, periodWeeks, plusDays, progressFrom } from '../src/lib/progress.ts'
import { windowStart } from '../src/lib/forecast.ts'

test('the time zone has a clock change on Nov 1 (the test is meaningful)', () => {
  assert.notEqual(new Date(2026, 10, 1).getTimezoneOffset(), new Date(2026, 10, 2).getTimezoneOffset())
})

test('adding days across the autumn and spring clock changes', () => {
  for (const add of [addDays, plusDays]) {
    assert.equal(add('2026-11-01', 1), '2026-11-02')
    assert.equal(add('2026-10-26', 7), '2026-11-02')
    assert.equal(add('2026-11-02', -7), '2026-10-26')
    assert.equal(add('2027-03-14', 1), '2027-03-15')
    assert.equal(add('2027-03-15', -1), '2027-03-14')
    assert.equal(add('2027-03-08', 7), '2027-03-15')
  }
})

test('a day-by-day loop through a clock change ends', () => {
  let n = 0
  for (let d = '2026-10-30'; d <= '2026-11-03' && n < 100; d = plusDays(d, 1)) n++
  assert.equal(n, 5)
})

test('Mondays and program weeks stay right after a clock change', () => {
  assert.equal(weekStart('2026-11-03'), '2026-11-02')
  assert.equal(mondayOf('2026-11-08'), '2026-11-02')
  assert.equal(programWeek('2027-03-08', '2027-03-15'), 2) // spring: the week is an hour short
  assert.equal(windowStart('2026-11-03', '2026-11-02'), '2026-11-02')
  const { weeks } = periodWeeks('p4', '2026-11-03', '2026-09-01')
  assert.deepEqual(weeks, ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'])
})

test('the Progress numbers build for a week spanning the clock change', () => {
  const d = progressFrom({
    today: '2026-11-03', start_date: '2026-10-19', goal_weight_kg: 70,
    days: ['2026-10-20', '2026-10-27', '2026-11-01', '2026-11-02', '2026-11-03'].map((date, i) => ({ date, weight_kg: 75 - i * 0.3, steps: 8000, water_ml: 2000, sleep_h: 7 })),
    meals: [], targets: [], programs: [], sessions: [], check_ins: [],
  }, 'p4')
  assert.deepEqual(d.weeks, ['2026-10-19', '2026-10-26', '2026-11-02'])
  assert.equal(new Set(d.habits.map((h) => h.date)).size, d.habits.length) // no repeated days
})
