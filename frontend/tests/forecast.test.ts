// Unit tests for the forecasts and plateau checks (src/lib/forecast.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bandAt, brzycki, epley, ewma, forecastLift, forecastWeight, liftPlateau, oneRepMax, pctAtFailure, RULES,
  smoothLift, theilSen, weeklyWeights, weightPlateau, weightSignals, windowStart, type LiftPoint,
} from '../src/lib/forecast.ts'
import { goalText, nextText } from '../src/lib/insights.ts'

const near = (a: number | null, b: number, tol = 0.01) => assert.ok(a != null && Math.abs(a - b) <= tol, `${a} ≉ ${b}`)
const mondays = (from: string, n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${from}T00:00:00`)
  d.setDate(d.getDate() + 7 * i)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})
const weekly = (kgs: (number | null)[], from = '2026-07-20') => mondays(from, kgs.length).map((week, i) => ({ week, kg: kgs[i] }))

// ---------- 1RM ----------

test('reps-at-RPE table: 1 rep at RPE 10 is the 1RM, interpolated between rows, nothing outside it', () => {
  assert.equal(pctAtFailure(1), 100)
  assert.equal(pctAtFailure(5), 86.3)
  near(pctAtFailure(1.5), (100 + 95.5) / 2)
  assert.equal(pctAtFailure(0), null)
  assert.equal(pctAtFailure(17), null)
})

test('1RM with RPE: weight ÷ % at reps + reps in reserve', () => {
  assert.equal(oneRepMax(100, 1, 10), 100) // a true single
  near(oneRepMax(100, 5, 10), (100 * 100) / 86.3) // 5 reps to failure
  near(oneRepMax(100, 3, 8), (100 * 100) / 86.3) // 3 reps with 2 in reserve = 5 to failure
  near(oneRepMax(100, 1, 8), (100 * 100) / 92.2) // a single with 2 in reserve
  near(oneRepMax(100, 6, 7.5), (100 * 100) / ((78.6 + 76.2) / 2)) // half points: 8.5 reps to failure
  near(oneRepMax(60, 12, 9), (60 * 100) / 65.3) // 12 reps allowed with RPE
  assert.equal(oneRepMax(60, 13, 9), null) // above 12 reps
})

test('1RM without RPE: mean of Epley and Brzycki, up to 10 reps', () => {
  assert.equal(oneRepMax(100, 1), 100)
  near(oneRepMax(100, 5), (epley(100, 5) + brzycki(100, 5)) / 2)
  near(oneRepMax(100, 5), (116.667 + 112.5) / 2)
  near(oneRepMax(80, 10), (epley(80, 10) + brzycki(80, 10)) / 2)
  assert.equal(oneRepMax(80, 11), null) // above 10 reps
  // RPE too far from failure to trust: the formulas, with their 10-rep limit
  near(oneRepMax(100, 5, 5), (epley(100, 5) + brzycki(100, 5)) / 2)
  assert.equal(oneRepMax(100, 12, 5), null)
})

test('1RM skips bodyweight and incomplete sets', () => {
  assert.equal(oneRepMax(null, 10), null)
  assert.equal(oneRepMax(0, 10), null)
  assert.equal(oneRepMax(100, null), null)
  assert.equal(oneRepMax(100, 0), null)
})

test('smoothing moves 40% of the way to each new value', () => {
  assert.deepEqual(ewma([100, 110]), [100, 104])
  near(ewma([100, 110, 110])[2], 106.4)
  assert.deepEqual(ewma([]), [])
  const pts = smoothLift([{ date: '2026-09-01', raw: 100, kg: 80, reps: 8, rpe: 8 }, { date: '2026-09-04', raw: 110, kg: 85, reps: 8, rpe: 8 }])
  assert.equal(pts[1].raw, 110)
  assert.equal(pts[1].smooth, 104)
})

// ---------- Trend and range ----------

test('robust slope ignores one odd week; the range widens further out', () => {
  const pts = Array.from({ length: 8 }, (_, x) => ({ x, y: 80 - 0.5 * x }))
  pts[3].y += 4 // a one-off: travel, a salty meal, a scale on carpet
  const fit = theilSen(pts, RULES.weight.minSpreadKg)!
  near(fit.slope, -0.5, 0.05)
  assert.equal(fit.spread, RULES.weight.minSpreadKg) // the odd week doesn't widen the range either
  // least squares would be pulled noticeably
  const mx = 3.5
  const my = pts.reduce((a, p) => a + p.y, 0) / 8
  const ls = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / pts.reduce((a, p) => a + (p.x - mx) ** 2, 0)
  assert.ok(Math.abs(ls + 0.5) > Math.abs(fit.slope + 0.5))
  assert.ok(bandAt(fit, 9) < bandAt(fit, 12))
  assert.ok(bandAt(fit, 12) < bandAt(fit, 16))
  assert.equal(theilSen([{ x: 1, y: 70 }, { x: 1, y: 71 }]), null)
})

test('weight forecast: band widens week by week, horizon capped at 8 weeks', () => {
  const f = forecastWeight(weekly([80, 79.6, 79.1, 78.4, 78.1, 77.4, 77.1, 76.4]), null, 20)
  assert.equal(f.enough, true)
  assert.equal(f.points.length, RULES.weight.horizonWeeks)
  near(f.slope_kg_week, -0.5, 0.06)
  const widths = f.points.map((p) => p.hi - p.lo)
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] >= widths[i - 1], `width ${i}`)
  assert.ok(f.points.every((p) => p.lo <= p.kg && p.kg <= p.hi))
  assert.equal(f.points[0].week, '2026-09-14') // the Monday after the last week
  assert.equal(f.goal_note, 'no_goal')
})

test('goal date: heading toward it, with a likely range around it', () => {
  const f = forecastWeight(weekly([80, 79.6, 79.1, 78.4, 78.1, 77.4, 77.1, 76.4]), 74)
  assert.ok(f.goal)
  assert.ok(f.goal.early <= f.goal.date)
  assert.ok(f.goal.late == null || f.goal.late >= f.goal.date)
  // about 2.5 kg to go at about 0.5 kg a week: about five weeks after Sep 7
  assert.ok(f.goal.date >= '2026-10-05' && f.goal.date <= '2026-10-19', f.goal.date)
  assert.equal(f.goal_note, null)
})

test('goal date: none when reached, heading away, too flat or too far', () => {
  const down = weekly([80, 79.6, 79.1, 78.4, 78.1, 77.4, 77.1, 76.4])
  assert.equal(forecastWeight(down, 76.5).goal_note, 'reached')
  const away = forecastWeight(down, 82)
  assert.equal(away.goal, null)
  assert.equal(away.goal_note, 'away')
  const flat = forecastWeight(weekly([75, 75.1, 74.9, 75, 75.05, 74.95]), 70)
  assert.equal(flat.goal, null)
  assert.equal(flat.goal_note, 'flat')
  const slow = forecastWeight(weekly([90, 89.85, 89.7, 89.55, 89.4, 89.25]), 70) // 0.15 kg a week, 19 kg to go
  assert.equal(slow.goal_note, 'far')
})

test('weight forecast needs weigh-ins in 4 weeks spread over 3+', () => {
  assert.equal(forecastWeight(weekly([80, 79.5, 79]), 70).enough, false)
  assert.equal(forecastWeight(weekly([80, null, null, 79]), 70).enough, false)
  assert.equal(forecastWeight(weekly([80, 79.5, 79, 78.5]), 70).enough, true)
  assert.equal(forecastWeight(weekly([80, null, 79.5, 79, null, 78.5]), 70).enough, true)
  assert.equal(forecastWeight([], 70).enough, false)
})

// ---------- Lifts ----------

const lift = (days: number[], raws: number[]): LiftPoint[] =>
  smoothLift(days.map((d, i) => ({ date: mondays('2026-08-03', 1)[0].replace(/\d\d$/, String(3 + d).padStart(2, '0')), raw: raws[i], kg: 80, reps: 5, rpe: 8 })))

test('lift forecast needs 5+ sessions over 3+ weeks; projects 4 and 8 weeks from the smoothed line', () => {
  assert.equal(forecastLift(lift([0, 3, 7, 10], [100, 101, 102, 103])).enough, false) // 4 sessions
  assert.equal(forecastLift(lift([0, 3, 7, 10, 14], [100, 101, 102, 103, 104])).enough, false) // 14 days
  const f = forecastLift(lift([0, 3, 7, 10, 14, 17, 21], [100, 101, 102, 103, 104, 105, 106]))
  assert.equal(f.enough, true)
  assert.equal(f.points.length, 2)
  assert.equal(f.points[0].week, '2026-09-21') // 4 weeks after Aug 24
  assert.ok(f.slope_kg_week! > 1.5 && f.slope_kg_week! < 2.5)
  assert.ok(f.points[1].kg > f.points[0].kg)
  assert.ok(f.points[1].hi - f.points[1].lo > f.points[0].hi - f.points[0].lo)
  assert.equal(forecastLift([]).enough, false)
})

// ---------- Plateaus ----------

test('weight plateau: flat for 3+ weeks while 1+ kg from goal', () => {
  const p = weightPlateau(weekly([78, 77.2, 76.4, 76.3, 76.5, 76.2, 76.4]), 70)
  assert.deepEqual(p, { since: '2026-08-03', weeks: 5 })
  assert.equal(weightPlateau(weekly([78, 77.5, 77, 76.5, 76, 75.5]), 70), null) // falling
  assert.equal(weightPlateau(weekly([70, 70.5, 71, 71.5, 72, 72.5]), 65), null) // rising
  assert.equal(weightPlateau(weekly([76.3, 76.5, 76.2, 76.4]), 76), null) // at goal: maintaining
  assert.equal(weightPlateau(weekly([76.3, 76.5, 76.2, 76.4]), null), null) // no goal
  assert.equal(weightPlateau(weekly([76.3, 76.5]), 70), null) // two weeks
})

test('lift plateau: smoothed 1RM up under 1% (or down) for 21+ days', () => {
  const flat = liftPlateau(lift([0, 3, 7, 10, 14, 17, 21, 24], [100, 100.5, 100, 100.4, 100.2, 100.3, 99.8, 100.1]))
  assert.ok(flat && flat.weeks >= 3, JSON.stringify(flat))
  assert.equal(liftPlateau(lift([0, 3, 7, 10, 14, 17, 21, 24], [100, 102, 104, 106, 108, 110, 112, 114])), null) // rising
  const falling = liftPlateau(lift([0, 3, 7, 10, 14, 17, 21, 24], [110, 109, 108, 107, 106, 105, 104, 103]))
  assert.ok(falling && falling.since === '2026-08-03', JSON.stringify(falling)) // down counts
  assert.equal(liftPlateau(lift([0, 3, 7, 10], [100, 100, 100, 100])), null) // only 10 days
})

// ---------- Window and units ----------

test('forecasts look at the last 12 weeks, from the start week at the earliest', () => {
  assert.equal(windowStart('2026-10-14', '2026-01-05'), '2026-07-27')
  assert.equal(windowStart('2026-10-14', '2026-09-30'), '2026-09-28')
  const w = weeklyWeights([{ date: '2026-09-28', kg: 70 }, { date: '2026-09-30', kg: 71 }, { date: '2026-10-13', kg: 69.5 }, { date: '2026-10-20', kg: 60 }], '2026-10-14', '2026-09-28')
  assert.deepEqual(w, [{ week: '2026-09-28', kg: 70.5 }, { week: '2026-10-05', kg: null }, { week: '2026-10-12', kg: 69.5 }])
  const s = weightSignals([], '2026-10-14', '2026-09-28', 65)
  assert.equal(s.forecast.enough, false)
  assert.equal(s.plateau, null)
})

test('forecast text in kg and lb, always worded as an estimate range', () => {
  const f = forecastWeight(weekly([80, 79.6, 79.1, 78.4, 78.1, 77.4, 77.1, 76.4]), 74)
  const kg = goalText(f, 74, 'metric', 'client', '2026-09-07')!
  assert.match(kg, /^At this pace you reach 74 kg around [A-Z][a-z]{2} \d+ \(likely /)
  const lb = goalText(f, 74, 'imperial', 'coach', '2026-09-07')!
  assert.match(lb, /^At this pace: 163\.1 lb around /)
  assert.match(nextText(f, 'imperial', '2026-09-07')!, /^Around \d+(\.\d)? lb by [A-Z][a-z]{2} \d+ \(likely \d+(\.\d)?–\d+(\.\d)? lb\)\.$/)
  assert.match(goalText(forecastWeight(weekly([80, 79.5]), 74), 74, 'metric', 'client')!, /^Not enough data yet/)
  assert.match(goalText(forecastWeight(weekly([80, 79.6, 79.1, 78.4, 78.1, 77.4, 77.1, 76.4]), 82), 82, 'imperial', 'client')!, /heading away from 180\.8 lb/)
  assert.equal(goalText(f, null, 'metric', 'client'), null)
})
