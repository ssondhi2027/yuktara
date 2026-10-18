// Unit tests for foods, amounts and meal plans (src/lib/meals.ts, src/lib/mealPlans.ts),
// the shared food list vs its migration, and skipped workouts in the week plan.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  amountText, avoidMatch, avoidTerms, baseAmount, customFoodProblem, dayNutrition, isTrainingDay, itemFromLine, lineFromSaved,
  lineProblem, mealsFor, mealTitle, nutritionFor, planDayFor, planMatch, planMatchCalories, planVsEaten, setSplit, sumNutrition,
  unitsFor, vsTarget, type Food, type FoodLine, type MealPlan,
} from '../src/lib/meals.ts'
import { planForDay, planWeekFrom } from '../src/lib/mealPlans.ts'
import { SHARED_FOODS } from '../src/lib/foodList.ts'
import { weekPlan, workoutsDone, type PlanTemplate } from '../src/lib/workouts.ts'

const oats: Food = { id: 'oats', name: 'Oats', basis: 'g', kcal: 380, protein_g: 13, carbs_g: 67, fat_g: 7, servings: [{ name: '1/2 cup', amount: 40 }] }
const egg: Food = { id: 'egg', name: 'Egg', basis: 'g', kcal: 143, protein_g: 12.6, carbs_g: 0.7, fat_g: 9.5, servings: [{ name: '1 large egg', amount: 50 }] }
const milk: Food = { id: 'milk', name: 'Milk, semi-skimmed', basis: 'ml', kcal: 47, protein_g: 3.4, carbs_g: 4.8, fat_g: 1.7, servings: [{ name: '1 glass', amount: 250 }] }
const peanut: Food = { id: 'pb', name: 'Peanut butter', basis: 'g', kcal: 588, protein_g: 25, carbs_g: 20, fat_g: 50, servings: [] }

// ---------- amounts ----------

test('nutrition from grams, ml and named servings', () => {
  assert.deepEqual(nutritionFor(oats, 60, 'g'), { calories: 228, protein_g: 7.8, carbs_g: 40.2, fat_g: 4.2 })
  assert.deepEqual(nutritionFor(milk, 250, 'ml'), { calories: 118, protein_g: 8.5, carbs_g: 12, fat_g: 4.3 })
  assert.deepEqual(nutritionFor(milk, 1, '1 glass'), nutritionFor(milk, 250, 'ml'))
  assert.deepEqual(nutritionFor(egg, 2, '1 large egg'), { calories: 143, protein_g: 12.6, carbs_g: 0.7, fat_g: 9.5 })
  assert.equal(baseAmount(egg, 1.5, '1 large egg'), 75)
})

test('rounding: whole calories, macros to 0.1 g', () => {
  const n = nutritionFor(oats, 33, 'g')!
  assert.equal(n.calories, 125) // 125.4
  assert.equal(n.protein_g, 4.3) // 4.29
  assert.equal(n.carbs_g, 22.1) // 22.11
  assert.deepEqual(sumNutrition([nutritionFor(oats, 33, 'g'), nutritionFor(egg, 1, '1 large egg')]), { calories: 197, protein_g: 10.6, carbs_g: 22.5, fat_g: 7.1 })
})

test('edge cases: zero, very large, unknown unit, not a number', () => {
  assert.deepEqual(nutritionFor(oats, 0, 'g'), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 })
  assert.equal(nutritionFor(oats, 10001, 'g'), null)
  assert.ok(nutritionFor(oats, 10000, 'g'))
  assert.equal(nutritionFor(oats, 100, 'ml'), null) // oats are measured in grams
  assert.equal(nutritionFor(oats, 1, 'scoop'), null)
  assert.equal(nutritionFor(oats, NaN, 'g'), null)
  assert.equal(nutritionFor(oats, -5, 'g'), null)
  assert.deepEqual(unitsFor(milk), ['ml', '1 glass'])
  assert.deepEqual(sumNutrition([null, { calories: NaN, protein_g: 1, carbs_g: 1, fat_g: 1 }]), { calories: 0, protein_g: 1, carbs_g: 1, fat_g: 1 })
})

test('line checks are plain', () => {
  assert.equal(lineProblem({ food: oats, quantity: 60, unit: 'g' }), null)
  assert.match(lineProblem({ food: oats, quantity: 0, unit: 'g' })!, /Enter an amount for Oats/)
  assert.match(lineProblem({ food: oats, quantity: NaN, unit: 'g' })!, /Enter an amount/)
  assert.match(lineProblem({ food: oats, quantity: 20000, unit: 'g' })!, /Check the amount/)
  assert.match(lineProblem({ food: oats, quantity: 1, unit: 'cup' })!, /Choose grams or a serving/)
  assert.match(lineProblem({ food: { ...oats, name: ' ' }, quantity: 1, unit: 'g' })!, /name/)
  assert.equal(customFoodProblem({ name: 'Mum’s chilli', kcal: 120, protein_g: 9, carbs_g: 10, fat_g: 5 }), null)
  assert.match(customFoodProblem({ name: 'Chilli', kcal: 1200, protein_g: 9, carbs_g: 10, fat_g: 5 })!, /0 to 900/)
  assert.match(customFoodProblem({ name: 'Chilli', kcal: 100, protein_g: 120, carbs_g: 10, fat_g: 5 })!, /0 to 100 g/)
})

test('saved rows keep the food, amount, serving and the numbers it had', () => {
  const byServing = itemFromLine({ food: egg, quantity: 2, unit: '1 large egg' })
  assert.deepEqual(byServing, { food_id: 'egg', food_name: 'Egg', quantity: 2, unit: 'serving', serving: '1 large egg', calories: 143, protein_g: 12.6, carbs_g: 0.7, fat_g: 9.5 })
  const byGrams = itemFromLine({ food: oats, quantity: 60, unit: 'g' })
  assert.equal(byGrams.unit, 'g')
  assert.equal(byGrams.serving, null)
  assert.deepEqual(lineFromSaved({ quantity: 2, unit: 'serving', serving: '1 large egg' }, egg), { food: egg, quantity: 2, unit: '1 large egg' })
  // Editing the food later doesn't change what was saved.
  const later = { ...egg, kcal: 200 }
  assert.equal(byServing.calories, 143)
  assert.equal(nutritionFor(later, 2, '1 large egg')!.calories, 200)
})

test('titles and amounts as text, in kg/lb users\' units', () => {
  assert.equal(mealTitle([]), 'Meal')
  assert.equal(mealTitle(['Oats']), 'Oats')
  assert.equal(mealTitle(['Oats', 'Banana', 'Whey protein']), 'Oats, Banana and Whey protein')
  assert.equal(avoidMatch('Dark chocolate 70%', avoidTerms('dark chocolate')), 'dark chocolate')
  assert.equal(mealTitle(['Eggs', 'Toast', 'Avocado', 'Coffee']), 'Eggs, Toast and 2 more')
  assert.equal(amountText(150, 'g'), '150 g')
  assert.equal(amountText(150, 'g', null, 'imperial'), '150 g (5.3 oz)')
  assert.equal(amountText(250, 'ml', null, 'imperial'), '250 ml (8.5 fl oz)')
  assert.equal(amountText(2, 'serving', '1 large egg', 'imperial'), '2 × 1 large egg')
})

// ---------- foods to avoid ----------

test('"foods to avoid" terms match food names by word', () => {
  const terms = avoidTerms('Peanuts, shellfish and no dairy; berries')
  assert.deepEqual(terms, ['peanut', 'shellfish', 'dairy', 'berry'])
  assert.equal(avoidMatch('Peanut butter', terms), 'peanut')
  assert.equal(avoidMatch('Berries, mixed', avoidTerms('berries')), 'berry')
  assert.equal(avoidMatch('Mixed berry smoothie', terms), 'berry')
  assert.equal(avoidMatch('Oats', terms), null)
  assert.equal(avoidMatch('Peanut butter', avoidTerms('nuts')), null) // a word starting with the term, not inside one
  assert.equal(avoidMatch('Egg white', avoidTerms('eggs')), 'egg')
  assert.deepEqual(avoidTerms(''), [])
  assert.deepEqual(avoidTerms(null), [])
})

// ---------- plans vs targets, matching ----------

const plan = (split = false): MealPlan => ({
  id: 'p', client_id: 'c', name: 'Plan', effective_from: '2026-10-05', split,
  meals: [
    { day: split ? 'training' : 'every', meal_type: 'breakfast', notes: '', lines: [{ food: oats, quantity: 60, unit: 'g' }, { food: milk, quantity: 1, unit: '1 glass' }] },
    { day: split ? 'training' : 'every', meal_type: 'snack', notes: 'Or an apple', lines: [{ food: peanut, quantity: 16, unit: 'g' }] },
    ...(split ? [{ day: 'rest' as const, meal_type: 'breakfast' as const, notes: '', lines: [{ food: egg, quantity: 2, unit: '1 large egg' }] }] : []),
  ],
})

test('plan sums per day and against targets', () => {
  const p = plan()
  assert.deepEqual(dayNutrition(p, 'every'), { calories: 440, protein_g: 20.3, carbs_g: 55.4, fat_g: 16.5 })
  assert.deepEqual(vsTarget(440, 2000), { pct: 22, diff: -1560 })
  assert.deepEqual(vsTarget(440, null), { pct: null, diff: 0 })
  const s = plan(true)
  assert.equal(dayNutrition(s, 'rest').calories, 143)
  assert.equal(planDayFor(true, true), 'training')
  assert.equal(planDayFor(true, false), 'rest')
  assert.equal(planDayFor(false, true), 'every')
  const day = planForDay(s, false)
  assert.equal(day.day, 'rest')
  assert.deepEqual(day.meals.map((m) => m.meal_type), ['breakfast'])
})

test('splitting a plan copies every day into training and rest days, and back', () => {
  const s = setSplit(plan(), true)
  assert.equal(s.meals.filter((m) => m.day === 'training').length, 2)
  assert.equal(s.meals.filter((m) => m.day === 'rest').length, 2)
  assert.equal(dayNutrition(s, 'rest').calories, dayNutrition(plan(), 'every').calories)
  const back = setSplit(s, false)
  assert.ok(back.meals.every((m) => m.day === 'every'))
})

test('a logged meal vs its plan: on plan, partly, off plan', () => {
  const planned: FoodLine[] = [{ food: oats, quantity: 60, unit: 'g' }, { food: milk, quantity: 1, unit: '1 glass' }]
  assert.equal(planMatch(planned, [{ food: oats, quantity: 65, unit: 'g' }, { food: milk, quantity: 250, unit: 'ml' }]), 'yes')
  assert.equal(planMatch(planned, [{ food: oats, quantity: 120, unit: 'g' }, { food: milk, quantity: 1, unit: '1 glass' }]), 'partly') // twice the oats
  assert.equal(planMatch(planned, [{ food: oats, quantity: 60, unit: 'g' }]), 'partly')
  assert.equal(planMatch(planned, [...planned, { food: peanut, quantity: 16, unit: 'g' }]), 'partly') // something extra
  assert.equal(planMatch(planned, [{ food: egg, quantity: 2, unit: '1 large egg' }]), 'no')
  assert.equal(planMatch([], [{ food: egg, quantity: 2, unit: '1 large egg' }]), 'yes')
  assert.equal(planMatchCalories(500, 540), 'yes')
  assert.equal(planMatchCalories(500, 650), 'partly')
  assert.equal(planMatchCalories(500, 900), 'no')
})

// ---------- planned vs eaten ----------

test('planned vs eaten per meal: averages over planned and logged days', () => {
  const n = (calories: number, protein_g: number) => ({ calories, protein_g, carbs_g: 0, fat_g: 0 })
  const rows = planVsEaten(['breakfast', 'lunch'], [
    { planned: { breakfast: n(400, 30) }, logged: [{ meal_type: 'breakfast', on_plan: 'yes', nutrition: n(420, 28) }] },
    { planned: { breakfast: n(400, 30) }, logged: [{ meal_type: 'breakfast', on_plan: 'partly', nutrition: n(300, 20) }, { meal_type: 'breakfast', on_plan: null, nutrition: n(100, 2) }] },
    { planned: null, logged: [{ meal_type: 'lunch', on_plan: 'no', nutrition: n(800, 40) }] },
  ])
  assert.deepEqual(rows[0], { meal_type: 'breakfast', planned_days: 2, planned: n(400, 30), logged_days: 2, eaten: { calories: 410, protein_g: 25, carbs_g: 0, fat_g: 0 }, on_plan: 1, meals: 3 })
  assert.equal(rows[1].planned_days, 0)
  assert.equal(rows[1].logged_days, 1)
})

test('the week view uses the plan in force each day and training days for split plans', () => {
  // Monday Oct 5; the plan starts Wednesday Oct 7; Monday is a training day.
  const s = { ...plan(true), effective_from: '2026-10-07' }
  const programs = [{ start_date: '2026-09-01', weeks: 12, days: [1, 3] }]
  assert.equal(isTrainingDay(programs, '2026-10-05'), true)
  assert.equal(isTrainingDay(programs, '2026-10-06'), false)
  assert.equal(isTrainingDay([{ start_date: '2026-11-01', weeks: 4, days: [1] }], '2026-10-05'), false)
  const w = planWeekFrom('2026-10-05', [s], [], ['breakfast', 'snack', 'lunch'], programs, null)
  const breakfast = w.rows.find((r) => r.meal_type === 'breakfast')!
  assert.ok(breakfast.planned_days >= 1 && breakfast.planned_days <= 5) // days from Oct 7 up to today
  assert.equal(w.rows.find((r) => r.meal_type === 'lunch')!.planned_days, 0) // nothing planned for lunch
  assert.equal(w.plan?.id, 'p')
})

test('meal slots follow meals a day', () => {
  assert.deepEqual(mealsFor(2), ['breakfast', 'dinner'])
  assert.deepEqual(mealsFor(3), ['breakfast', 'lunch', 'dinner'])
  assert.deepEqual(mealsFor(5), ['breakfast', 'snack', 'lunch', 'dinner'])
  assert.deepEqual(mealsFor(null), ['breakfast', 'lunch', 'dinner'])
})

// ---------- the shared food list ----------

test('the shared food list matches its migration and makes sense', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/0022_foods.sql', import.meta.url), 'utf-8')
  for (const f of SHARED_FOODS) {
    const row = `('${f.name.replace(/'/g, "''")}', '${f.basis}', ${f.kcal}, ${f.protein_g}, ${f.carbs_g}, ${f.fat_g},`
    assert.ok(sql.includes(row), `${f.name} is seeded with the same numbers`)
    // Energy from macros (4/4/9) is close to the stated calories (fibre and rounding aside).
    const fromMacros = f.protein_g * 4 + f.carbs_g * 4 + f.fat_g * 9
    assert.ok(Math.abs(fromMacros - f.kcal) <= Math.max(40, f.kcal * 0.2), `${f.name}: ${fromMacros} vs ${f.kcal}`)
    assert.ok(f.servings.every(([n, a]) => n.length <= 40 && a > 0 && a <= 2000))
  }
  assert.equal(new Set(SHARED_FOODS.map((f) => f.name.toLowerCase())).size, SHARED_FOODS.length)
  for (const n of ['Dal (cooked lentils)', 'Roti (chapati)', 'Paneer', 'Paneer tikka']) assert.ok(SHARED_FOODS.some((f) => f.name === n), n)
})

// ---------- skipped workouts in the week plan ----------

const templates: PlanTemplate[] = [
  { id: 'a', name: 'Upper A', day_of_week: 1, notes: null, exercises: [] },
  { id: 'b', name: 'Lower A', day_of_week: 3, notes: null, exercises: [] },
]

test('a skipped workout shows as skipped (with its reason), not missed or done', () => {
  const p = weekPlan(templates, [
    { id: 's1', workout_template_id: 'b', performed_on: '2026-10-14', finished: true, skipped: true, notes: 'Travel' },
  ], '2026-10-16', '2026-09-01')
  const lower = p.find((x) => x.template_id === 'b')!
  assert.equal(lower.status, 'skipped')
  assert.equal(lower.skip_reason, 'Travel')
  assert.equal(lower.session_id, 's1')
  assert.equal(p.find((x) => x.template_id === 'a')!.status, 'missed')
})

test('done after all beats the skip; skips never count as done', () => {
  const p = weekPlan(templates, [
    { id: 's1', workout_template_id: 'b', performed_on: '2026-10-14', finished: true, skipped: true, notes: null },
    { id: 'd1', workout_template_id: 'b', performed_on: '2026-10-15', finished: true },
  ], '2026-10-16', '2026-09-01')
  const lower = p.find((x) => x.template_id === 'b')!
  assert.equal(lower.status, 'done')
  assert.equal(lower.session_id, 'd1')
  assert.equal(workoutsDone([{ status: 'skipped', workout_template_id: 'b' }, { status: 'done', workout_template_id: 'a' }], true), 1)
})
