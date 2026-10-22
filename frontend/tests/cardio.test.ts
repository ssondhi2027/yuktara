// Unit tests for cardio (src/lib/cardio.ts): units, typed times, pace, plan
// text; cardio records and milestones (src/lib/records.ts); cardio kept out of
// the strength numbers (src/lib/workouts.ts, src/lib/progress.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  boutText, cardioTargetProblems, cardioTargetText, cardioTotals, clock, distanceText, inputFromMetres, inputFromSeconds, isCardioTarget,
  metresFromInput, minutesText, paceSecPerKm, paceText, parseDuration, speedText,
} from '../src/lib/cardio.ts'
import { bestsFrom, findRecords, recordChange, recordSet, recordTitle, setBadges, type ExerciseInfo, type RecordSession, type RecordSet } from '../src/lib/records.ts'
import { hardSets, setsLine, summarize, type SummarySet } from '../src/lib/workouts.ts'
import { progressFrom, type ProgressRaw } from '../src/lib/progress.ts'

// ---------- units and typing ----------

test('typed times: minutes, mm:ss, h:mm:ss; nonsense is refused', () => {
  assert.equal(parseDuration('30'), 1800)
  assert.equal(parseDuration('30.5'), 1830)
  assert.equal(parseDuration('30,5'), 1830)
  assert.equal(parseDuration('30:15'), 1815)
  assert.equal(parseDuration('1:05:30'), 3930)
  assert.equal(parseDuration('90:00'), 5400) // 90 minutes as mm:ss is fine
  for (const bad of ['', '0', '0:00', 'abc', '30:75', '1:60:00', '-5', '1:2:3:4']) assert.equal(parseDuration(bad), null, bad)
  assert.equal(clock(1800), '30:00')
  assert.equal(clock(245), '4:05')
  assert.equal(clock(3930), '1:05:30')
  assert.equal(inputFromSeconds(1800), '30')
  assert.equal(inputFromSeconds(1815), '30:15')
  assert.equal(minutesText(2700), '45 min')
  assert.equal(minutesText(5400), '1 h 30 min')
  assert.equal(minutesText(7200), '2 h')
})

test('distance in km or miles, stored in metres', () => {
  assert.equal(metresFromInput('5.2', 'metric'), 5200)
  assert.equal(metresFromInput('3.1', 'imperial'), 4989)
  assert.equal(metresFromInput('', 'metric'), null)
  assert.equal(metresFromInput('0', 'metric'), null)
  assert.equal(metresFromInput('x', 'metric'), null)
  assert.equal(distanceText(5200, 'metric'), '5.2 km')
  assert.equal(distanceText(5000, 'imperial'), '3.11 mi')
  assert.equal(inputFromMetres(4989, 'imperial'), '3.1')
})

test('pace and speed', () => {
  const pace = paceSecPerKm(1800, 5000)!
  assert.equal(pace, 360)
  assert.equal(paceText(pace, 'metric'), '6:00 /km')
  assert.equal(paceText(pace, 'imperial'), '9:39 /mi')
  assert.equal(paceSecPerKm(1800, null), null)
  assert.equal(speedText(1800, 5000, 'metric'), '10 km/h')
  assert.equal(speedText(3600, 1609.344 * 6.5, 'imperial'), '6.5 mph')
  assert.equal(boutText({ duration_s: 1800, distance_m: 5000, level: 2, avg_hr: 148, rpe: 7 }, 'metric'), '30:00 · 5 km · 6:00 /km · level 2 · 148 bpm @7')
  assert.equal(boutText({ duration_s: 600 }, 'metric'), '10:00')
  assert.deepEqual(cardioTotals([{ duration_s: 600, distance_m: 2000 }, { duration_s: 300 }, {}]), { seconds: 900, metres: 2000, bouts: 2 })
})

test('planned cardio text and checks', () => {
  assert.equal(cardioTargetText({ sets: 1, minutes: 20, zone: 'easy' }, 'metric'), '20 min · easy')
  assert.equal(cardioTargetText({ sets: 1, distance_m: 5000, zone: 'moderate' }, 'imperial'), '3.11 mi · moderate')
  assert.equal(cardioTargetText({ sets: 5, minutes: 1, zone: 'hard', rest_seconds: 90 }, 'metric'), '5 × 1 min hard, 1.5 min easy between')
  assert.equal(cardioTargetText({ sets: 8, minutes: 0.5, zone: 'max', rest_seconds: 30 }, 'metric'), '8 × 30 s all out, 30 s easy between')
  assert.equal(cardioTargetText({ sets: 1, minutes: 30, distance_m: 5000 }, 'metric'), '30 min or 5 km')
  assert.ok(isCardioTarget({ minutes: 10 }) && !isCardioTarget({ minutes: null, distance_m: null, zone: null }))
  assert.deepEqual(cardioTargetProblems({ sets: 1, minutes: 20 }), [])
  assert.deepEqual(cardioTargetProblems({ sets: 1 }), ['a time or a distance is required'])
  assert.deepEqual(cardioTargetProblems({ sets: 12, minutes: 700 }), ['minutes: up to 600', 'rounds: 1 to 10'])
})

// ---------- records ----------

const info: ExerciseInfo = new Map([
  ['run', { name: 'Treadmill run', bodyweight: false, cardio: true }],
  ['row', { name: 'Rowing machine', bodyweight: false, cardio: true }],
  ['bench', { name: 'Barbell bench press', bodyweight: false }],
])
let n = 0
const bout = (exercise_id: string, duration_s: number, distance_m: number | null = null, extra: Partial<RecordSet> = {}): RecordSet =>
  ({ exercise_id, set_number: ++n, weight_kg: null, reps: null, rpe: null, duration_s, distance_m, ...extra })
const day = (i: number) => `2026-09-${String(i).padStart(2, '0')}`
const workout = (i: number, sets: RecordSet[]): RecordSession => ({ id: `w${i}`, date: day(i), started_at: `${day(i)}T07:00:00`, sets })
const kinds = (rs: ReturnType<typeof findRecords>) => rs.map((r) => `${r.date.slice(8)} ${r.kind === 'milestone' ? r.milestone : `${r.kind} ${r.value}`}`)

test('cardio records: longest distance, longest time, fastest pace; first time is the baseline', () => {
  const rs = findRecords([
    workout(1, [bout('run', 1500, 4000)]), // baseline: 4 km in 25:00, 6:15 /km
    workout(3, [bout('run', 1500, 4000)]), // tie
    workout(5, [bout('run', 1800, 5000)]), // 5 km in 30:00: distance, duration, pace 6:00
    workout(7, [bout('run', 900, 2600)]), // 2.6 km in 15:00, 5:46 /km: pace only
    workout(9, [bout('run', 2400, null)]), // 40 min, no distance: duration only
  ], info)
  assert.deepEqual(kinds(rs), [
    '05 distance 5', '05 duration 30', '05 pace 360', '05 dist:run:5',
    '07 pace 346.2',
    '09 duration 40',
  ])
  const pace = rs.find((r) => r.kind === 'pace' && r.date === day(7))!
  assert.equal(recordTitle(pace), 'Pace PR')
  assert.equal(recordSet(pace, 'metric'), '2.6 km in 15:00')
  assert.equal(recordChange(pace, 'metric'), '5:46 /km, was 6:00 /km')
  const dist = rs.find((r) => r.kind === 'distance')!
  assert.equal(recordChange(dist, 'imperial'), 'was 2.49 mi')
  assert.equal(recordChange(rs.find((r) => r.kind === 'duration')!, 'metric'), 'was 25:00')
})

test('pace needs a bout of 1 km or more; warm-ups never count; within 5 m is the same distance', () => {
  const rs = findRecords([
    workout(1, [bout('row', 600, 2000)]),
    workout(3, [bout('row', 120, 600), bout('row', 900, 3000, { is_warmup: true })]), // sprint under 1 km; a warm-up
    workout(5, [bout('row', 610, 2004)]), // 4 m further: not a distance record; slower; longer
  ], info)
  assert.deepEqual(kinds(rs), ['05 duration 10.17'])
})

test('each bout of intervals is its own set; the best one gets the badge', () => {
  const before = bestsFrom([workout(1, [bout('row', 60, 300), bout('row', 60, 310)])], info)
  const b = setBadges(before, [
    { exercise_id: 'row', set_number: 1, weight_kg: null, reps: null, rpe: null, duration_s: 60, distance_m: 320 },
    { exercise_id: 'row', set_number: 2, weight_kg: null, reps: null, rpe: null, duration_s: 60, distance_m: 330 },
  ], info)
  assert.deepEqual([...b.entries()], [['row:2', ['distance']]])
})

test('distance milestones: 5 km, 10 km, half marathon', () => {
  const rs = findRecords([workout(1, [bout('run', 1700, 5000)]), workout(3, [bout('run', 7300, 21100)])], info)
  assert.deepEqual(kinds(rs).filter((k) => k.includes('dist:')), ['01 dist:run:5', '03 dist:run:10', '03 dist:run:21.1'])
  assert.deepEqual(rs.filter((r) => r.kind === 'milestone').map(recordTitle), ['5 km run', '10 km run', 'Half-marathon distance'])
})

test('cardio and strength records stay apart', () => {
  const rs = findRecords([
    workout(1, [bout('run', 1500, 4000), { exercise_id: 'bench', set_number: 99, weight_kg: 60, reps: 5, rpe: null }]),
    workout(3, [bout('run', 1600, 4100), { exercise_id: 'bench', set_number: 98, weight_kg: 62.5, reps: 5, rpe: null }]),
  ], info).filter((r) => r.kind !== 'milestone')
  assert.deepEqual(rs.map((r) => `${r.exercise_id} ${r.kind}`).sort(), ['bench e1rm', 'bench weight', 'run distance', 'run duration'])
})

// ---------- kept out of the strength numbers ----------

test('a workout summary: cardio bouts are time and distance, not sets or volume', () => {
  const s = (x: Partial<SummarySet>): SummarySet => ({ exercise_id: 'bench', name: 'Bench press', primary: ['chest'], set_number: 1, weight_kg: 60, reps: 8, rpe: null, ...x })
  const sets = [
    s({ set_number: 1 }), s({ set_number: 2 }),
    s({ exercise_id: 'run', name: 'Treadmill run', primary: [], set_number: 1, weight_kg: null, reps: null, duration_s: 1200, distance_m: 3000, cardio: true }),
  ]
  assert.equal(hardSets(sets), 2)
  const w = summarize({ id: 'w', name: 'Upper', performed_on: '2026-10-18', finished: true, duration_min: 50, notes: null }, sets)
  assert.equal(w.sets, 2)
  assert.equal(w.volume_kg, 960)
  assert.equal(w.cardio_s, 1200)
  assert.equal(w.cardio_m, 3000)
  assert.deepEqual(w.muscles, ['chest'])
  assert.equal(setsLine(w.exercises[1].sets, 'metric'), '20:00 · 3 km · 6:40 /km')
})

test('Progress: weekly cardio time and distance, by activity; not hard sets, volume, lifts or muscles', () => {
  const raw: ProgressRaw = {
    today: '2026-10-14', start_date: '2026-09-21', goal_weight_kg: null, days: [], meals: [], targets: [], programs: [], check_ins: [],
    sessions: [
      { date: '2026-10-06', template_id: null, sets: [
        { exercise_id: 'run', name: 'Treadmill run', kg: null, reps: null, primary: [], duration_s: 1800, distance_m: 5000 },
        { exercise_id: 'bench', name: 'Bench press', kg: 60, reps: 8, primary: ['chest'] },
      ] },
      { date: '2026-10-13', template_id: null, sets: [
        { exercise_id: 'run', name: 'Treadmill run', kg: null, reps: null, primary: [], duration_s: 1500, distance_m: 4200 },
        { exercise_id: 'bike', name: 'Stationary bike', kg: null, reps: null, primary: [], duration_s: 2400, distance_m: null },
      ] },
    ],
  }
  const p = progressFrom(raw, 'p4')
  const wk = (w: string) => p.training.weekly.find((x) => x.week === w)!
  assert.deepEqual([wk('2026-10-05').sets, wk('2026-10-05').cardio_s, wk('2026-10-05').cardio_m, wk('2026-10-05').volume_kg], [1, 1800, 5000, 480])
  assert.deepEqual([wk('2026-10-12').sets, wk('2026-10-12').cardio_s, wk('2026-10-12').cardio_m], [0, 3900, 4200])
  assert.deepEqual(p.cardio, [
    { exercise_id: 'run', name: 'Treadmill run', sessions: 2, seconds: 3300, metres: 9200, longest_m: 5000 },
    { exercise_id: 'bike', name: 'Stationary bike', sessions: 1, seconds: 2400, metres: 0, longest_m: null },
  ])
  assert.deepEqual(p.lifts.map((l) => l.exercise_id), ['bench'])
  assert.deepEqual(p.training.muscles, [{ muscle: 'chest', sets: 1 }])
})
