// Unit tests for the Progress page calculations (src/lib/progress.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  doneIn, epley, mondayOf, pctOf, periodWeeks, planStreak, plannedIn, progressFrom, rawFrom, slope, trend, volumeKg,
  type ProgressRaw,
} from '../src/lib/progress.ts'
import { loadValue, toUnit } from '../src/lib/units.ts'

const TODAY = '2026-10-14' // a Wednesday

test('periods are whole weeks, with the same number before them to compare', () => {
  const p4 = periodWeeks('p4', TODAY, '2026-06-01')
  assert.deepEqual(p4.weeks, ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'])
  assert.deepEqual(p4.previous, ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14'])
  // A client who started three weeks ago: four-week period shrinks, nothing before it.
  const fresh = periodWeeks('p4', TODAY, '2026-09-30')
  assert.deepEqual(fresh.weeks, ['2026-09-28', '2026-10-05', '2026-10-12'])
  assert.deepEqual(fresh.previous, [])
  // Since start never has a previous period.
  assert.equal(periodWeeks('all', TODAY, '2026-06-01').previous.length, 0)
  assert.equal(periodWeeks('all', TODAY, '2026-06-01').weeks[0], mondayOf('2026-06-01'))
  assert.equal(rawFrom('p4', TODAY, '2026-06-01'), '2026-08-24')
})

test('estimated 1RM (Epley)', () => {
  assert.equal(epley(100, 1), 100)
  assert.equal(epley(100, 5), 100 * (1 + 5 / 30))
  assert.ok(Math.abs(epley(80, 10) - 106.67) < 0.01)
  assert.equal(epley(0, 10), 0)
  assert.equal(epley(60, 0), 0)
})

test('volume is sets Ã— reps Ã— weight, shown in the user\'s unit', () => {
  const sets = [{ kg: 80, reps: 5 }, { kg: 80, reps: 5 }, { kg: null, reps: 15 }, { kg: 20, reps: null }]
  assert.equal(volumeKg(sets), 800)
  assert.equal(Math.round(toUnit(volumeKg(sets), 'imperial')), 1764)
  assert.equal(loadValue(volumeKg(sets), 'metric'), 800)
})

test('adherence percentages', () => {
  assert.equal(pctOf(3, 4), 75)
  assert.equal(pctOf(0, 4), 0)
  assert.equal(pctOf(3, 0), null) // nothing planned: no percentage, not 0 or 100
  assert.equal(pctOf(null, 4), null)
})

test('planned and done per week: distinct planned workouts, capped at the plan', () => {
  const programs = [{ start_date: '2026-09-02', weeks: 4, planned: 3 }, { start_date: '2026-10-05', weeks: 8, planned: 4 }]
  assert.equal(plannedIn(programs, '2026-08-31'), 3) // first program's first week
  assert.equal(plannedIn(programs, '2026-10-12'), 4) // the newer program wins
  assert.equal(plannedIn(programs, '2026-08-24'), 0)
  const sessions = [
    { date: '2026-10-12', template_id: 'a', sets: [] },
    { date: '2026-10-13', template_id: 'a', sets: [] }, // the same workout twice counts once
    { date: '2026-10-14', template_id: null, sets: [] }, // an extra workout doesn't count
    { date: '2026-10-06', template_id: 'b', sets: [] }, // last week
  ]
  assert.equal(doneIn(sessions, '2026-10-12', 4), 1)
  assert.equal(doneIn([...sessions, { date: '2026-10-14', template_id: 'b', sets: [] }, { date: '2026-10-15', template_id: 'c', sets: [] }], '2026-10-12', 2), 2)
})

test('streak of weeks hitting the plan', () => {
  const w = (week: string, done: number, planned = 3) => ({ week, done, planned })
  assert.equal(planStreak([w('2026-09-21', 3), w('2026-09-28', 3), w('2026-10-05', 3), w('2026-10-12', 1)], TODAY), 3) // this week still open
  assert.equal(planStreak([w('2026-09-28', 3), w('2026-10-05', 2), w('2026-10-12', 3)], TODAY), 1)
  assert.equal(planStreak([w('2026-10-05', 3), w('2026-10-12', 3)], TODAY), 2)
  assert.equal(planStreak([w('2026-10-05', 0, 0), w('2026-10-12', 0, 0)], TODAY), 0) // no plan, no streak
})

test('trend vs the previous period', () => {
  assert.equal(trend({ value: 80, previous: 70 }), 'up')
  assert.equal(trend({ value: 70, previous: 80 }), 'down')
  assert.equal(trend({ value: 70.1, previous: 70 }, 0.2), 'flat')
  assert.equal(trend({ value: 70, previous: null }), null)
  assert.equal(trend({ value: null, previous: 70 }), null)
})

test('slope needs three points', () => {
  assert.equal(slope([{ x: 0, y: 1 }, { x: 1, y: 2 }]), null)
  assert.equal(slope([{ x: 0, y: 3 }, { x: 1, y: 2 }, { x: 2, y: 1 }]), -1)
})

const raw = (over: Partial<ProgressRaw> = {}): ProgressRaw => ({
  today: TODAY, start_date: '2026-09-21', goal_weight_kg: 68, days: [], meals: [], targets: [], programs: [], sessions: [], check_ins: [], ...over,
})

test('a brand-new client gets empty values, never made-up numbers', () => {
  const p = progressFrom(raw({ start_date: TODAY }), 'p4')
  assert.deepEqual(p.weeks, ['2026-10-12'])
  for (const k of ['weight', 'workouts', 'calories', 'protein', 'meals_on_plan', 'steps', 'water', 'sleep'] as const) {
    assert.equal(p.kpis[k].value, null, k)
    assert.equal(p.kpis[k].previous, null, k)
  }
  assert.equal(p.weight.projection, null)
  assert.deepEqual(p.strength, [])
  assert.equal(p.kpis.workouts.streak, 0)
})

test('KPIs from a few weeks of logs', () => {
  const days = ['2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'].map((date, i) => ({ date, weight_kg: 74 - i * 0.5, steps: 8000 + i * 1000, water_ml: 2000, sleep_h: 7 }))
  const p = progressFrom(raw({
    days,
    targets: [{ from: '2026-09-21', calories: 2000, protein_g: 150, water_ml: 2500, steps: 9000, sleep_h: 7.5 }],
    meals: [
      { date: '2026-10-13', calories: 600, protein_g: 50, on_plan: 'yes' },
      { date: '2026-10-13', calories: 900, protein_g: 40, on_plan: 'partly' },
      { date: '2026-10-14', calories: 2000, protein_g: 160, on_plan: 'no' },
    ],
    programs: [{ start_date: '2026-09-21', weeks: 8, planned: 2 }],
    sessions: [
      { date: '2026-09-22', template_id: 'a', sets: [{ exercise_id: 'sq', name: 'Back squat', kg: 80, reps: 5, primary: ['quads', 'glutes'] }] },
      { date: '2026-09-24', template_id: 'b', sets: [{ exercise_id: 'sq', name: 'Back squat', kg: 82.5, reps: 5, primary: ['quads', 'glutes'] }] },
      { date: '2026-09-30', template_id: 'a', sets: [{ exercise_id: 'sq', name: 'Back squat', kg: 85, reps: 3, primary: ['quads', 'glutes'] }] },
    ],
  }), 'p4')
  assert.equal(p.kpis.weight.value, 72.5)
  assert.equal(p.kpis.weight.change, -1.5)
  assert.equal(p.kpis.weight.to_goal, 4.5)
  assert.equal(p.kpis.workouts.done, 3)
  assert.equal(p.kpis.workouts.planned, 8)
  assert.equal(p.kpis.workouts.value, 38)
  assert.equal(p.kpis.workouts.streak, 0) // week 2 missed one; weeks 3 and 4 nothing
  assert.equal(p.kpis.calories.value, 1750) // two logged days: 1500 and 2000
  assert.equal(p.kpis.calories.target, 2000)
  assert.equal(p.kpis.meals_on_plan.value, 50) // yes + partly (half) + no
  assert.equal(p.kpis.steps.value, 9500)
  assert.equal(p.training.weekly[0].volume_kg, 813) // 400 + 412.5, rounded
  assert.equal(p.training.muscles[0].sets, 3)
  assert.equal(p.strength[0].name, 'Back squat')
  assert.equal(p.strength[0].points.length, 3)
  assert.ok(p.weight.projection && p.weight.projection.kg < 72.5) // trending down
})

test('averages come out without float noise', () => {
  const p = progressFrom(raw({
    days: [{ date: '2026-10-13', weight_kg: 71.8, steps: null, water_ml: null, sleep_h: 7.1 }, { date: '2026-10-14', weight_kg: 71.8, steps: null, water_ml: null, sleep_h: 7.1 }],
    goal_weight_kg: 68.1,
  }), 'p4')
  assert.equal(p.kpis.sleep.value, 7.1) // not 7.1000000000000005
  assert.equal(p.kpis.weight.to_goal, 3.7) // not 3.6999999999999957
  assert.equal(String(p.kpis.weight.value), '71.8')
})
