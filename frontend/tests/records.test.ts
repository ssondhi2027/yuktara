// Unit tests for personal records and milestones (src/lib/records.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bestsFrom, bodyWeightOn, bySet, findRecords, recordChange, recordCount, recordSet, recordTitle, sessionRecords, setBadges, visibleRecords,
  type ExerciseInfo, type PersonalRecord, type RecordSession, type RecordSet,
} from '../src/lib/records.ts'
import { oneRepMax } from '../src/lib/forecast.ts'
import { lbToKg } from '../src/lib/units.ts'

const info: ExerciseInfo = new Map([
  ['bench', { name: 'Barbell bench press', bodyweight: false }],
  ['squat', { name: 'Back squat', bodyweight: false }],
  ['dl', { name: 'Deadlift', bodyweight: false }],
  ['pullup', { name: 'Pull-up', bodyweight: true }],
  ['pushup', { name: 'Push-up', bodyweight: true }],
  ['db-bench', { name: 'Dumbbell bench press', bodyweight: false }],
])

let n = 0
const set = (exercise_id: string, kg: number | null, reps: number, extra: Partial<RecordSet> = {}): RecordSet =>
  ({ exercise_id, set_number: ++n, weight_kg: kg, reps, rpe: null, ...extra })
const day = (i: number) => `2026-09-${String(i).padStart(2, '0')}`
const workout = (i: number, sets: RecordSet[], id = `w${i}`): RecordSession => ({ id, date: day(i), started_at: `${day(i)}T18:00:00`, sets })
const kinds = (rs: PersonalRecord[], ex?: string) => rs.filter((r) => r.kind !== 'milestone' && (!ex || r.exercise_id === ex)).map((r) => `${r.date.slice(8)} ${r.kind} ${r.value}`)

// ---------- record types ----------

test('the first workout with an exercise is the baseline, not a record', () => {
  const rs = findRecords([workout(1, [set('bench', 60, 8), set('bench', 62.5, 6)])], info)
  assert.deepEqual(kinds(rs), [])
})

test('weight PR: heavier than ever; a tie is not a record', () => {
  const rs = findRecords([
    workout(1, [set('bench', 60, 8)]),
    workout(3, [set('bench', 60, 8)]), // tie
    workout(5, [set('bench', 62.5, 5)]), // heavier
  ], info)
  assert.ok(kinds(rs).includes('05 weight 62.5'))
  assert.equal(rs.filter((r) => r.kind === 'weight').length, 1)
  const w = rs.find((r) => r.kind === 'weight')!
  assert.equal(w.previous, 60)
  assert.equal(w.date, day(5))
})

test('only the heaviest set of a workout is the weight PR', () => {
  const rs = findRecords([workout(1, [set('bench', 60, 8)]), workout(3, [set('bench', 62.5, 5), set('bench', 65, 3), set('bench', 65, 2)])], info)
  const w = rs.filter((r) => r.kind === 'weight')
  assert.equal(w.length, 1)
  assert.equal(w[0].value, 65)
  assert.equal(w[0].reps, 3)
})

test('rep PR: more reps than ever at that weight or heavier', () => {
  const rs = findRecords([
    workout(1, [set('bench', 60, 8), set('bench', 70, 5)]),
    workout(3, [set('bench', 60, 9)]), // 9 at 60 beats 8: a rep PR
    workout(5, [set('bench', 55, 9)]), // 9 at 55: 60 × 9 was heavier with as many reps
    workout(7, [set('bench', 65, 6)]), // 6 at 65: beats 70 × 5 (the most at 65 or heavier)
    workout(9, [set('bench', 60, 9)]), // tie
  ], info)
  assert.deepEqual(kinds(rs).filter((k) => k.includes('reps')), ['03 reps 9', '07 reps 6'])
  assert.equal(rs.find((r) => r.kind === 'reps' && r.date === day(7))!.previous, 5)
})

test('rep PRs at different weights in one workout both count; a matched set does not', () => {
  const rs = findRecords([
    workout(1, [set('bench', 60, 8), set('bench', 70, 5)]),
    workout(3, [set('bench', 70, 6), set('bench', 60, 10), set('bench', 60, 9), set('bench', 60, 10)]),
  ], info)
  const reps = rs.filter((r) => r.kind === 'reps')
  assert.deepEqual(reps.map((r) => `${r.weight_kg}×${r.reps}`), ['70×6', '60×10'])
  // The first of the two 60 × 10 sets gets it.
  assert.equal(reps[1].set_number, Math.min(...rs.filter((r) => r.weight_kg === 60).map((r) => r.set_number!)))
})

test('1RM PR uses lib/forecast.ts oneRepMax, RPE included, and skips sets it cannot estimate', () => {
  const rs = findRecords([
    workout(1, [set('squat', 100, 5, { rpe: 8 })]),
    workout(3, [set('squat', 100, 5, { rpe: 9 })]), // same set, less in reserve: a lower estimate
    workout(5, [set('squat', 90, 12)]), // more than 10 reps without RPE: no estimate
    workout(7, [set('squat', 100, 6, { rpe: 8 })]),
  ], info)
  const e = rs.filter((r) => r.kind === 'e1rm')
  assert.equal(e.length, 1)
  assert.equal(e[0].date, day(7))
  assert.equal(e[0].value, Math.round(oneRepMax(100, 6, 8)! * 10) / 10)
  assert.equal(e[0].previous, Math.round(oneRepMax(100, 5, 8)! * 10) / 10)
  // 90 × 12 is a rep PR (12 at 90 beats nothing heavier with as many) but not a 1RM PR.
  assert.ok(!rs.some((r) => r.date === day(5) && r.kind === 'e1rm'))
})

test('a set can be a weight PR and a 1RM PR at once', () => {
  const rs = findRecords([workout(1, [set('bench', 60, 5)]), workout(3, [set('bench', 65, 5)])], info).filter((r) => r.kind !== 'milestone')
  assert.deepEqual(rs.map((r) => r.kind).sort(), ['e1rm', 'weight'])
  const g = bySet(rs)
  assert.equal(g.length, 1)
  assert.equal(g[0].records.length, 2)
})

test('warm-ups and drops never count, and do not set the baseline either', () => {
  const rs = findRecords([
    workout(1, [set('bench', 100, 10, { is_warmup: true }), set('bench', 60, 8)]),
    workout(3, [set('bench', 62.5, 8), set('bench', 80, 12, { drop_of: 1 }), set('bench', 90, 3, { is_warmup: true })]),
  ], info)
  assert.deepEqual(kinds(rs).filter((k) => k.includes('weight')), ['03 weight 62.5'])
  assert.ok(!rs.some((r) => r.weight_kg === 80 || r.weight_kg === 90))
})

test('bodyweight rep PR: most reps in one set, for bodyweight exercises', () => {
  const rs = findRecords([
    workout(1, [set('pullup', null, 6), set('pullup', null, 5)]),
    workout(3, [set('pullup', null, 6)]), // tie
    workout(5, [set('pullup', null, 7), set('pullup', null, 8)]),
    // Weighted pull-ups are their own baseline.
    workout(7, [set('pullup', 10, 5)]),
    workout(9, [set('pullup', 12.5, 5)]),
  ], info)
  assert.deepEqual(kinds(rs, 'pullup'), ['05 bw_reps 8', '09 weight 12.5', '09 e1rm ' + Math.round(oneRepMax(12.5, 5)! * 10) / 10])
})

test('a swapped exercise counts for the exercise actually done', () => {
  // Planned bench press, done as dumbbell bench press: the sets carry the dumbbell exercise.
  const rs = findRecords([
    workout(1, [set('bench', 80, 5)]),
    workout(3, [set('db-bench', 30, 8)]),
    workout(5, [set('db-bench', 32, 8)]),
  ], info)
  assert.deepEqual(rs.filter((r) => r.kind === 'weight').map((r) => `${r.exercise_id} ${r.value}`), ['db-bench 32'])
})

test('weights compare in kg: the same lb load saved twice is a tie', () => {
  const kg = Math.round(lbToKg(225) * 100) / 100
  const rs = findRecords([workout(1, [set('bench', kg, 5)]), workout(3, [set('bench', kg, 5)])], info)
  assert.deepEqual(kinds(rs), [])
})

test('a kg load shown in lb and saved back (82.5 kg → 181.9 lb → 82.51 kg) is a tie, not a record', () => {
  const rs = findRecords([workout(1, [set('squat', 82.5, 6, { rpe: 8 })]), workout(3, [set('squat', 82.51, 6, { rpe: 8 })])], info)
  assert.deepEqual(kinds(rs), [])
  // The smallest real step (0.5 kg, or 1 lb = 0.45 kg) still counts.
  assert.deepEqual(kinds(findRecords([workout(1, [set('squat', 82.5, 6)]), workout(3, [set('squat', 82.95, 6)])], info)).filter((k) => k.includes('weight')), ['03 weight 82.95'])
})

test('two workouts on one day go in start-time order', () => {
  const a = { ...workout(3, [set('bench', 70, 5)], 'late'), started_at: `${day(3)}T19:00:00` }
  const b = { ...workout(3, [set('bench', 65, 5)], 'early'), started_at: `${day(3)}T07:00:00` }
  const rs = findRecords([workout(1, [set('bench', 60, 5)]), a, b], info)
  assert.deepEqual(rs.filter((r) => r.kind === 'weight').map((r) => `${r.session_id} ${r.value}`), ['early 65', 'late 70'])
})

// ---------- the logger: badges follow the ticked sets ----------

test('badges: editing or unticking a set changes them', () => {
  const before = bestsFrom([workout(1, [set('bench', 60, 8), set('pullup', null, 8)])], info)
  const s1 = { exercise_id: 'bench', set_number: 1, weight_kg: 62.5, reps: 8, rpe: null }
  const s2 = { exercise_id: 'bench', set_number: 2, weight_kg: 60, reps: 9, rpe: null }
  let b = setBadges(before, [s1, s2], info)
  assert.deepEqual(b.get('bench:1'), ['weight', 'e1rm'])
  // 60 × 9 is matched by 62.5 × 8? No: fewer reps. It's a rep PR at 60.
  assert.deepEqual(b.get('bench:2'), ['reps'])
  // Edited down to 60 × 8: a tie, no badge.
  b = setBadges(before, [{ ...s1, weight_kg: 60 }], info)
  assert.equal(b.size, 0)
  // Unticked (gone from the list): its badge goes; the other set's stays.
  b = setBadges(before, [s2], info)
  assert.deepEqual([...b.keys()], ['bench:2'])
  assert.deepEqual(b.get('bench:2'), ['reps', 'e1rm'])
  // A heavier second set takes the weight badge.
  b = setBadges(before, [s1, { ...s2, weight_kg: 65, reps: 5 }], info)
  assert.deepEqual(b.get('bench:2'), ['weight'])
  assert.ok(b.get('bench:1')?.includes('e1rm'))
  // Bodyweight.
  assert.deepEqual(setBadges(before, [{ exercise_id: 'pullup', set_number: 1, weight_kg: null, reps: 9, rpe: null }], info).get('pullup:1'), ['bw_reps'])
  // No history: nothing.
  assert.equal(setBadges({}, [s1], info).size, 0)
})

test('sessionRecords against no history for that exercise sets no records', () => {
  assert.deepEqual(sessionRecords({}, workout(1, [set('bench', 200, 1)]), info), [])
})

// ---------- milestones ----------

const milestones = (rs: PersonalRecord[]) => rs.filter((r) => r.kind === 'milestone').map((r) => `${r.date.slice(8)} ${r.milestone}`)

test('load milestones in kg and lb, earned once, from the first workout', () => {
  const rs = findRecords([
    workout(1, [set('bench', 61.25, 5)]), // 135.03 lb
    workout(3, [set('bench', 60, 5)]),
    workout(5, [set('bench', Math.round(lbToKg(225) * 100) / 100, 1)]), // 102.06 kg
  ], info)
  assert.deepEqual(milestones(rs), [
    '01 load:bench:40kg', '01 load:bench:60kg', '01 load:bench:95lb', '01 load:bench:135lb',
    '05 load:bench:80kg', '05 load:bench:100kg', '05 load:bench:185lb', '05 load:bench:225lb',
  ])
  // Shown in the viewer's unit only.
  const lb = visibleRecords(rs, 'imperial').filter((r) => r.kind === 'milestone').map(recordTitle)
  assert.deepEqual(lb, ['185 lb bench press', '225 lb bench press', '95 lb bench press', '135 lb bench press'])
  const kg = visibleRecords(rs, 'metric').filter((r) => r.kind === 'milestone').map(recordTitle)
  assert.deepEqual(kg, ['80 kg bench press', '100 kg bench press', '40 kg bench press', '60 kg bench press'])
})

test('135 lb saved as 61.23 kg still reaches the 135 lb milestone', () => {
  const rs = findRecords([workout(1, [set('squat', Math.round(lbToKg(135) * 100) / 100, 5)])], info)
  assert.deepEqual(milestones(rs), ['01 load:squat:60kg', '01 load:squat:135lb'])
})

test('bodyweight-relative milestones use the latest weigh-in on or before that day', () => {
  const weighIns = [{ date: day(1), kg: 80 }, { date: day(6), kg: 70 }]
  assert.equal(bodyWeightOn(weighIns, day(5)), 80)
  assert.equal(bodyWeightOn(weighIns, day(6)), 70)
  assert.equal(bodyWeightOn(weighIns, '2026-08-31'), null)
  const rs = findRecords([
    workout(5, [set('bench', 75, 3), set('squat', 115, 3), set('dl', 155, 1)]), // 80 kg: none
    workout(7, [set('bench', 70, 3), set('squat', 105, 3), set('dl', 139.5, 1)]), // 70 kg: bench and squat, deadlift 0.5 short
    workout(9, [set('dl', 140, 1, { is_warmup: true })]), // a warm-up doesn't count
  ], info, weighIns)
  assert.deepEqual(milestones(rs).filter((m) => m.includes('bw:')), ['07 bw:bench:1', '07 bw:squat:1.5'])
  assert.equal(recordTitle(rs.find((r) => r.milestone === 'bw:squat:1.5')!), '1.5× bodyweight squat')
  // No weigh-in: no bodyweight milestones.
  assert.deepEqual(milestones(findRecords([workout(7, [set('bench', 200, 1)])], info)).filter((m) => m.includes('bw:')), [])
})

test('rep milestones for bodyweight exercises, and workout counts', () => {
  const ws = Array.from({ length: 10 }, (_, i) => workout(i + 1, i === 0 ? [set('pullup', null, 1)] : i === 4 ? [set('pullup', null, 10), set('pushup', null, 50)] : []))
  const rs = findRecords(ws, info)
  assert.deepEqual(milestones(rs), [
    '01 reps:pull-up:1', '05 reps:pull-up:5', '05 reps:pull-up:10', '05 reps:push-up:10', '05 reps:push-up:25', '05 reps:push-up:50', '10 workouts:10',
  ])
  const titles = rs.filter((r) => r.kind === 'milestone').map(recordTitle)
  assert.ok(titles.includes('First pull-up'))
  assert.ok(titles.includes('10 pull-ups'))
  assert.ok(titles.includes('50 push-ups'))
  assert.ok(titles.includes('10 workouts logged'))
})

// ---------- wording ----------

test('labels and details in the viewer\'s unit', () => {
  const rs = findRecords([workout(1, [set('bench', 60, 8)]), workout(3, [set('bench', 62.5, 8), set('pullup', null, 5)]), workout(5, [set('pullup', null, 6)])], info)
  const w = rs.find((r) => r.kind === 'weight')!
  assert.equal(recordTitle(w), 'Weight PR')
  assert.equal(recordSet(w, 'metric'), '62.5 kg × 8')
  assert.equal(recordChange(w, 'metric'), 'was 60 kg')
  assert.equal(recordChange(w, 'imperial'), 'was 132.3 lb')
  const e = rs.find((r) => r.kind === 'e1rm')!
  assert.match(recordChange(e, 'metric'), /^est\. 1RM \d+(\.5)? kg, was \d+(\.5)? kg$/)
  const bw = rs.find((r) => r.kind === 'bw_reps')!
  assert.equal(recordTitle(bw), 'Rep PR')
  assert.equal(recordSet(bw, 'metric'), 'BW × 6')
  assert.equal(recordChange(bw, 'metric'), 'was 5 reps')
  assert.equal(recordCount(1), '1 new personal record')
  assert.equal(recordCount(2), '2 new personal records')
  for (const r of rs) for (const s of [recordTitle(r), recordSet(r, 'imperial'), recordChange(r, 'imperial')]) assert.doesNotMatch(s, /NaN|undefined|Infinity/)
})
