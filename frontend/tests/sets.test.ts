// Unit tests for drop sets and supersets (src/lib/workouts.ts) and how Progress
// counts drops (src/lib/progress.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dropSuggestionKg, hardSets, inSetOrder, linkedToNext, linkWithNext, normalizeSupersets, roundOrder, setsLine, setVolume, summarize,
  supersetBlocks, supersetLetter, supersetLine, supersetTags, unlinkFromNext, type SummarySet,
} from '../src/lib/workouts.ts'
import { progressFrom, type ProgressRaw } from '../src/lib/progress.ts'
import { kgToLb } from '../src/lib/units.ts'

const set = (n: number, kg: number | null, reps: number, drop_of: number | null = null, extra: Partial<SummarySet> = {}): SummarySet => ({
  exercise_id: 'bench', name: 'Bench press', primary: ['chest'], set_number: n, weight_kg: kg, reps, rpe: null, drop_of, ...extra,
})

// ---------- drop sets ----------

test('a working set and its drops are one hard set; volume counts every set', () => {
  // Set 3 has two drops, logged as set numbers 4 and 5.
  const sets = [set(1, 60, 8), set(2, 60, 8), set(3, 60, 8), set(4, 45, 8, 3), set(5, 30, 10, 3)]
  assert.equal(hardSets(sets), 3)
  assert.equal(setVolume(sets), 60 * 8 * 3 + 45 * 8 + 30 * 10)
  const s = summarize({ id: 'w', name: 'Upper', performed_on: '2026-10-18', finished: true, duration_min: 40, notes: null }, sets)
  assert.equal(s.sets, 3)
  assert.equal(s.volume_kg, 2100)
  assert.deepEqual(s.muscles, ['chest'])
})

test('drops show after their set, in the order logged', () => {
  // A drop added to set 1 after sets 2 and 3 were already there.
  const out = inSetOrder([set(2, 60, 8), set(5, 40, 10, 1), set(1, 60, 8), set(4, 50, 8, 1), set(3, 60, 7)])
  assert.deepEqual(out.map((x) => x.set_number), [1, 4, 5, 2, 3])
  assert.equal(setsLine(out, 'metric'), '60 kg × 8 → 50 kg × 8 → 40 kg × 10, 60 kg × 8, 60 kg × 7')
  assert.equal(setsLine([set(1, null, 12), set(2, null, 8, 1)], 'metric'), 'BW × 12 → BW × 8')
})

test('the drop weight suggestion: about 22.5% less, on the load step, in kg and lb', () => {
  assert.equal(dropSuggestionKg(60, 'metric'), 46.5) // 46.5
  assert.equal(dropSuggestionKg(100, 'metric'), 77.5)
  assert.equal(dropSuggestionKg(16, 'metric'), 12.5) // 12.4 → 12.5
  const lb = dropSuggestionKg(61.23, 'imperial')! // 135 lb → 104.6 → 105 lb
  assert.equal(Math.round(kgToLb(lb) * 10) / 10, 105)
  const small = dropSuggestionKg(0.3, 'imperial')! // 0.66 lb → never below one step (1 lb)
  assert.equal(Math.round(kgToLb(small)), 1)
  assert.equal(dropSuggestionKg(null, 'metric'), null) // bodyweight
  assert.equal(dropSuggestionKg(0, 'metric'), null)
})

test('Progress: drops add volume, not hard sets, and never count for 1RM', () => {
  const sessions: ProgressRaw['sessions'] = ['2026-10-05', '2026-10-08', '2026-10-12', '2026-10-15'].map((date) => ({
    date, template_id: 'a',
    sets: [
      { exercise_id: 'bench', name: 'Bench press', kg: 60, reps: 8, primary: ['chest'] },
      // a drop that would look like a bigger 1RM if it were counted
      { exercise_id: 'bench', name: 'Bench press', kg: 58, reps: 10, primary: ['chest'], drop: true },
    ],
  }))
  const d = progressFrom({
    today: '2026-10-18', start_date: '2026-10-05', goal_weight_kg: null, days: [], meals: [], targets: [], programs: [], sessions, check_ins: [],
  }, 'p4')
  const week = d.training.weekly.find((w) => w.week === '2026-10-12')!
  assert.equal(week.sets, 2) // two working sets this week, each with a drop
  assert.equal(week.volume_kg, 2 * (60 * 8 + 58 * 10))
  assert.deepEqual(d.training.muscles, [{ muscle: 'chest', sets: 4 }])
  const bench = d.strength.find((l) => l.exercise_id === 'bench')!
  assert.ok(bench.points.every((p) => p.kg === 60 && p.reps === 8), 'the best set per session is the working set')
})

// ---------- supersets ----------

const ex = (name: string, superset: string | null = null) => ({ name, superset })

test('linking: pairs, joins, relabels and keeps supersets consecutive', () => {
  let xs = [ex('Squat'), ex('Lateral raise'), ex('Face pull'), ex('Curl'), ex('Pushdown')]
  xs = linkWithNext(xs, 1) // lateral raise + face pull
  assert.deepEqual(xs.map((x) => x.superset), [null, 'A', 'A', null, null])
  xs = linkWithNext(xs, 3) // curl + pushdown
  assert.deepEqual(supersetTags(xs), [null, 'A1', 'A2', 'B1', 'B2'])
  xs = linkWithNext(xs, 2) // face pull + curl: joins both into one giant set
  assert.deepEqual(xs.map((x) => x.superset), [null, 'A', 'A', 'A', 'A'])
  assert.ok(linkedToNext(xs, 2))
  xs = unlinkFromNext(xs, 2) // split back into two pairs
  assert.deepEqual(supersetTags(xs), [null, 'A1', 'A2', 'B1', 'B2'])
  xs = unlinkFromNext(xs, 1) // a pair split: two exercises on their own
  assert.deepEqual(xs.map((x) => x.superset), [null, null, null, 'A', 'A'])
})

test('tidying: lone labels go, split groups get new letters, labels fit the database (1–2 letters)', () => {
  assert.deepEqual(normalizeSupersets([ex('a', 'Q'), ex('b'), ex('c', 'B'), ex('d', 'B'), ex('e', 'B')]).map((x) => x.superset), [null, null, 'A', 'A', 'A'])
  // Moving an exercise out of the middle of a superset splits it.
  assert.deepEqual(normalizeSupersets([ex('a', 'A'), ex('b', 'A'), ex('x'), ex('c', 'A'), ex('d', 'A')]).map((x) => x.superset), ['A', 'A', null, 'B', 'B'])
  assert.equal(supersetLetter(0), 'A')
  assert.equal(supersetLetter(25), 'Z')
  assert.equal(supersetLetter(26), 'AA')
  assert.match(supersetLetter(700), /^[A-Z]{1,2}$/)
})

test('blocks and round order for the logger', () => {
  const blocks = supersetBlocks([ex('Squat'), ex('Bench', 'A'), ex('Row', 'A'), ex('Lunge')])
  assert.deepEqual(blocks.map((b) => [b.label, b.items.map((x) => x.name)]), [[null, ['Squat']], ['A', ['Bench', 'Row']], [null, ['Lunge']]])
  // Round order: A1 set 1, A2 set 1, A1 set 2, A2 set 2, then A1's extra set.
  const order = roundOrder([['b1', 'b2', 'b3'], ['r1', 'r2']])
  assert.deepEqual(order.map((o) => `${o.round}:${o.set}`), ['1:b1', '1:r1', '2:b2', '2:r2', '3:b3'])
  assert.deepEqual(roundOrder([]), [])
})

test('summaries note the supersets', () => {
  const sets = [
    set(1, 8, 15, null, { exercise_id: 'lat', name: 'Lateral raise', primary: ['shoulders'], superset: 'A' }),
    set(1, 20, 15, null, { exercise_id: 'face', name: 'Face pull', primary: ['shoulders'], superset: 'A' }),
    set(1, 60, 8),
  ]
  const s = summarize({ id: 'w', name: 'Upper', performed_on: '2026-10-18', finished: true, duration_min: 40, notes: null }, sets)
  assert.deepEqual(s.supersets, [['Lateral raise', 'Face pull']])
  assert.equal(supersetLine(s.supersets[0]), 'Superset: Lateral raise + Face pull')
})
