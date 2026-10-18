// Unit tests for the insight rules and Insights card text (src/lib/insights.ts).
// Each rule fires on clear data and stays quiet on noisy or thin data.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { progressFrom, type Period, type ProgressRaw } from '../src/lib/progress.ts'
import { INSIGHT_RULES, effectSize, insightsFor, rowFlags, signalsFor, weeksOf } from '../src/lib/insights.ts'
import { forecastWeight } from '../src/lib/forecast.ts'
import type { UnitSystem } from '../src/types/db.ts'

const TODAY = '2026-10-14' // a Wednesday
const START = '2026-07-20' // a Monday, 13 weeks ago

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const DAYS: { date: string; week: number; dow: number }[] = []
for (let d = new Date(`${START}T00:00:00`), i = 0; iso(d) <= TODAY; d.setDate(d.getDate() + 1), i++) {
  DAYS.push({ date: iso(d), week: Math.floor(i / 7), dow: i % 7 }) // dow 0 = Monday
}

const base = (over: Partial<ProgressRaw> = {}): ProgressRaw => ({
  today: TODAY, start_date: START, goal_weight_kg: null, days: [], meals: [], targets: [], programs: [], sessions: [], check_ins: [], ...over,
})
const target = (t: Partial<ProgressRaw['targets'][number]> = {}) => ({ from: START, calories: 2000, protein_g: 140, water_ml: null, steps: 8000, sleep_h: null, ...t })
const day = (date: string, d: Partial<ProgressRaw['days'][number]>) => ({ date, weight_kg: null, steps: null, water_ml: null, sleep_h: null, ...d })

const run = (id: string, raw: ProgressRaw, units: UnitSystem = 'metric', period: Period = 'p12') => {
  const d = progressFrom(raw, period)
  return INSIGHT_RULES.find((r) => r.id === id)!.run(d, weeksOf(d), units)
}

/** Back squat on Mondays and Thursdays; `loadOf(week)` gives the weight. */
const squats = (loadOf: (week: number) => number): ProgressRaw['sessions'] =>
  DAYS.filter((x) => x.dow === 0 || x.dow === 3).map((x) => ({
    date: x.date, template_id: x.dow === 0 ? 'a' : 'b',
    sets: [{ exercise_id: 'squat', name: 'Back squat', kg: loadOf(x.week), reps: 5, rpe: 8, primary: ['quads'] }],
  }))

// ---------- plan streak ----------

test('plan streak: fires after 3+ weeks on plan, quiet with fewer', () => {
  const programs = [{ start_date: START, weeks: 16, planned: 2 }]
  const hit = run('plan_streak', base({ programs, sessions: squats(() => 100) }))
  assert.ok(hit)
  assert.match(hit.text, /^Training plan hit \d+ weeks in a row\.$/)
  const recent = squats(() => 100).filter((s) => s.date >= '2026-09-28') // only the last two full weeks
  assert.equal(run('plan_streak', base({ programs, sessions: recent })), null)
})

// ---------- protein during a plateau ----------

test('protein in a weight plateau: fires under 90% of target, quiet otherwise or with few logged days', () => {
  const days = DAYS.map((x) => day(x.date, { weight_kg: 76 + ((x.week % 2) - 0.5) * 0.2 }))
  const meals = (g: number, from = START) => DAYS.filter((x) => x.date >= from).map((x) => ({ date: x.date, calories: 2000, protein_g: g, on_plan: 'yes' as const }))
  const raw = (g: number, from?: string) => base({ goal_weight_kg: 70, days, meals: meals(g, from), targets: [target()] })
  const low = run('protein_in_plateau', raw(100))
  assert.ok(low)
  assert.equal(low.tone, 'note')
  assert.match(low.text, /^Protein averaged 71% of target over the \d+ weeks weight held steady\.$/)
  assert.equal(run('protein_in_plateau', raw(135)), null) // 96%: fine
  assert.equal(run('protein_in_plateau', raw(100, '2026-10-10')), null) // 5 logged days: too few
  // no plateau (weight still coming down): quiet
  const falling = DAYS.map((x) => day(x.date, { weight_kg: 80 - x.week * 0.5 }))
  assert.equal(run('protein_in_plateau', base({ goal_weight_kg: 70, days: falling, meals: meals(100), targets: [target()] })), null)
})

// ---------- sleep and lifts ----------

test('sleep and lifts: fires when lifts rise more in 7+ h weeks, quiet on noise or thin logs', () => {
  const sleep = (h: (week: number) => number, nights = 7) => DAYS.filter((x) => x.dow < nights).map((x) => day(x.date, { sleep_h: h(x.week) }))
  const good = (w: number) => w % 2 === 0
  // +6 kg in each well-slept week, nothing in the others
  const clear = squats((w) => 100 + 6 * Array.from({ length: w + 1 }, (_, k) => (good(k) ? 1 : 0)).reduce((a, b) => a + b, 0))
  const hit = run('sleep_and_lifts', base({ days: sleep((w) => (good(w) ? 8 : 6)), sessions: clear }))
  assert.ok(hit, 'fires')
  assert.match(hit.text, /^Lifts tended to go up more in weeks with 7\+ hours of sleep \(\+[\d.]+% vs [+−]?[\d.]+% a week\)\.$/)
  // gains unrelated to sleep: +6 kg in weeks 0, 3, 4, 7, 8, 11, 12
  const noise = squats((w) => 100 + 6 * Array.from({ length: w + 1 }, (_, k) => ([0, 3].includes(k % 4) ? 1 : 0)).reduce((a, b) => a + b, 0))
  assert.equal(run('sleep_and_lifts', base({ days: sleep((w) => (good(w) ? 8 : 6)), sessions: noise })), null)
  // only three nights logged a week: too thin
  assert.equal(run('sleep_and_lifts', base({ days: sleep((w) => (good(w) ? 8 : 6), 3), sessions: clear })), null)
})

// ---------- steps and weight ----------

test('steps and weight: fires when weight drops faster in step-target weeks, in kg and lb', () => {
  const hitWeek = (w: number) => w % 2 === 0
  const kgAt = (pattern: (w: number) => number) => (w: number) => 85 - Array.from({ length: w }, (_, k) => pattern(k + 1)).reduce((a, b) => a + b, 0)
  const days = (kg: (w: number) => number, logged = 7) => DAYS.map((x) => day(x.date, { weight_kg: kg(x.week), steps: x.dow < logged ? (hitWeek(x.week) ? 10_000 : 5000) : null }))
  const clear = kgAt((w) => (hitWeek(w) ? 1 : 0.2))
  const raw = (kg: (w: number) => number, logged?: number) => base({ goal_weight_kg: 65, days: days(kg, logged), targets: [target()] })
  const kg = run('steps_and_weight', raw(clear))
  assert.ok(kg, 'fires')
  assert.equal(kg.text, 'Weight tended to come down faster in weeks the step target was reached (−1 kg vs −0.2 kg a week).')
  const lb = run('steps_and_weight', raw(clear), 'imperial')!
  assert.equal(lb.text, 'Weight tended to come down faster in weeks the step target was reached (−2.2 lb vs −0.4 lb a week).')
  // the same losses, unrelated to steps
  assert.equal(run('steps_and_weight', raw(kgAt((w) => ([0, 3].includes(w % 4) ? 1 : 0.2)))), null)
  // steps logged on three days a week: too thin
  assert.equal(run('steps_and_weight', raw(clear, 3)), null)
  // already at or under the goal: quiet
  assert.equal(run('steps_and_weight', base({ goal_weight_kg: 90, days: days(clear), targets: [target()] })), null)
})

// ---------- calories ----------

test('calories on target: good news at 70%+, a gentle note at 40% or less, quiet in between or when thin', () => {
  const meals = (kcal: (i: number) => number, from = '2026-09-14') =>
    DAYS.filter((x) => x.date >= from).map((x, i) => ({ date: x.date, calories: kcal(i), protein_g: 140, on_plan: 'yes' as const }))
  const raw = (kcal: (i: number) => number, from?: string) => base({ meals: meals(kcal, from), targets: [target()] })
  const good = run('calories_on_target', raw(() => 2050), 'metric', 'p4')
  assert.ok(good)
  assert.equal(good.tone, 'good')
  assert.match(good.text, /^Within 10% of the calorie target on (\d+) of \1 logged days\.$/)
  const low = run('calories_on_target', raw(() => 2600), 'metric', 'p4')
  assert.ok(low)
  assert.equal(low.tone, 'note')
  assert.equal(run('calories_on_target', raw((i) => (i % 2 ? 2000 : 2600)), 'metric', 'p4'), null) // about half
  assert.equal(run('calories_on_target', raw(() => 2050, '2026-10-05'), 'metric', 'p4'), null) // 10 days
})

// ---------- together ----------

test('at most three insights, strongest first; wording is about patterns, not causes', () => {
  const programs = [{ start_date: START, weeks: 16, planned: 2 }]
  const days = DAYS.map((x) => day(x.date, { weight_kg: 76 + ((x.week % 2) - 0.5) * 0.2, sleep_h: 7.5, steps: 9000 }))
  const meals = DAYS.map((x) => ({ date: x.date, calories: 2050, protein_g: 100, on_plan: 'yes' as const }))
  const d = progressFrom(base({ goal_weight_kg: 70, programs, sessions: squats(() => 100), days, meals, targets: [target()] }), 'p12')
  const all = insightsFor(d, 'metric')
  assert.ok(all.length >= 2 && all.length <= 3)
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].score >= all[i].score)
  assert.equal(all[0].id, 'protein_in_plateau')
  for (const i of all) assert.doesNotMatch(i.text, /\b(because|caus|should|must|diagnos)/i)
  // the card: weight plateau, the lift steady, a "no goal date" reason
  const s = signalsFor(d, 'metric', 'client')
  assert.ok(s.plateaus.some((p) => p.startsWith('Weight steady for')))
  assert.ok(s.plateaus.some((p) => p.startsWith('Back squat steady for')))
  assert.match(s.goal!, /about flat, so there's no goal date yet/)
})

test('a brand-new client: no forecast, no insights, a clear "not enough data" line', () => {
  const d = progressFrom(base({ start_date: TODAY, goal_weight_kg: 60 }), 'p4')
  const s = signalsFor(d, 'imperial', 'client')
  assert.match(s.goal!, /^Not enough data yet/)
  assert.equal(s.next, null)
  assert.deepEqual(s.plateaus, [])
  assert.deepEqual(s.insights, [])
  for (const t of [s.goal, ...s.insights.map((i) => i.text)]) assert.doesNotMatch(String(t), /NaN|undefined|Infinity/)
})

test('Clients list flags: plateau, away from goal, goal date', () => {
  const weekly = (kgs: number[]) => kgs.map((kg, i) => ({ week: ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'][i], kg }))
  const away = forecastWeight(weekly([66.1, 65.6, 65.9, 66.2, 66.6, 66.9]), 60)
  assert.deepEqual(rowFlags({ forecast: away, plateau: { since: '2026-09-21', weeks: 3 } }), [
    { text: 'Weight steady 3 wk', tone: 'note' }, { text: 'Trend away from goal', tone: 'note' },
  ])
  const toward = forecastWeight(weekly([92, 91.2, 90.3, 89.5, 88.6, 87.7]), 80)
  assert.deepEqual(rowFlags({ forecast: toward, plateau: null }).map((f) => f.tone), ['good'])
  assert.match(rowFlags({ forecast: toward, plateau: null })[0].text, /^Goal ~[A-Z][a-z]{2} \d+$/)
})

test('effect size: big for a steady gap, small for noise', () => {
  assert.ok(effectSize([3, 3.2, 2.9], [1, 1.1, 0.9]) > 5)
  assert.ok(effectSize([3, 0, 2], [1, 2.5, 0.5]) < 0.8)
  assert.equal(effectSize([1, 1], [1, 1]), 0)
})
