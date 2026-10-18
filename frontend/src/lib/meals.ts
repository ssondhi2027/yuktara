// Foods, amounts and meal plans: the maths behind logging and the coach's plans.
// A food has calories and macros per 100 g (or per 100 ml) and named servings; a
// food line is a food plus an amount in g, ml or one of its servings, and its
// calories and macros come from that amount. Pure functions with type-only
// imports; unit-tested in tests/meals.test.ts.

import type { MealType, OnPlan } from '../types/db'

// ---------- Foods and amounts ----------

export type Basis = 'g' | 'ml'
export interface Serving { name: string; amount: number }

/** Nutrition per 100 g (or 100 ml). id null = a food typed in for one meal, not in the list. */
export interface Food {
  id: string | null
  name: string
  basis: Basis
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  servings: Serving[]
  /** a coach's own food (foods.created_by set) */
  custom?: boolean
}

export interface Nutrition { calories: number; protein_g: number; carbs_g: number; fat_g: number }
export const NO_NUTRITION: Nutrition = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }

/** A food and how much: `unit` is the food's basis ('g' or 'ml') or the name of one of its servings. */
export interface FoodLine { food: Food; quantity: number; unit: string }

/** Largest amount accepted on a line (g, ml or servings), as in the database. */
export const MAX_AMOUNT = 10000

/** The units offered for a food: grams (or ml), then its servings. */
export const unitsFor = (food: Food): string[] => [food.basis, ...food.servings.map((s) => s.name)]

/** The amount in the food's basis (g or ml), or null for an unknown unit or an amount out of range. */
export function baseAmount(food: Food, quantity: number, unit: string): number | null {
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > MAX_AMOUNT) return null
  if (unit === food.basis) return quantity
  const s = food.servings.find((x) => x.name === unit)
  return s ? quantity * s.amount : null
}

const r1 = (x: number) => Math.round(x * 10) / 10

/** Calories (whole) and macros (to 0.1 g) for an amount, or null if the amount or unit doesn't work. */
export function nutritionFor(food: Food, quantity: number, unit: string): Nutrition | null {
  const base = baseAmount(food, quantity, unit)
  if (base == null) return null
  const k = base / 100
  return { calories: Math.round(food.kcal * k), protein_g: r1(food.protein_g * k), carbs_g: r1(food.carbs_g * k), fat_g: r1(food.fat_g * k) }
}

export const lineNutrition = (l: FoodLine) => nutritionFor(l.food, l.quantity, l.unit)

/** Sum of several (whole calories, macros to 0.1 g); anything not a finite number counts as 0. */
export function sumNutrition(xs: (Nutrition | null)[]): Nutrition {
  const sum = (k: keyof Nutrition) => xs.reduce((a, x) => a + (x && Number.isFinite(x[k]) ? x[k] : 0), 0)
  return { calories: Math.round(sum('calories')), protein_g: r1(sum('protein_g')), carbs_g: r1(sum('carbs_g')), fat_g: r1(sum('fat_g')) }
}

/** The meal's totals from its foods (or saved food rows). */
export const mealTotals = (items: (Nutrition | null)[]) => sumNutrition(items)

/**
 * "150 g", "250 ml", "2 × 1 large egg". With `system` 'imperial', grams and ml
 * also show in oz / fl oz ("150 g (5.3 oz)"); amounts are entered in g, ml or servings.
 */
export function amountText(quantity: number, unit: string, serving?: string | null, system?: 'imperial' | 'metric'): string {
  const q = Number.isInteger(quantity) ? String(quantity) : String(r1(quantity))
  if (unit === 'g' || unit === 'ml') {
    if (system !== 'imperial') return `${q} ${unit}`
    const oz = unit === 'g' ? quantity / 28.3495 : quantity / 29.5735
    return `${q} ${unit} (${r1(oz)} ${unit === 'g' ? 'oz' : 'fl oz'})`
  }
  return `${q} × ${serving ?? unit}`
}

/** The amount of a line, as text (servings by name). */
export const lineAmountText = (l: FoodLine, system?: 'imperial' | 'metric') =>
  l.unit === l.food.basis ? amountText(l.quantity, l.unit, null, system) : amountText(l.quantity, 'serving', l.unit)

/** The first problem with a line, in plain words, or null. */
export function lineProblem(l: FoodLine): string | null {
  const name = l.food.name.trim() || 'this food'
  if (!l.food.name.trim()) return 'Give each food a name.'
  if (!(l.quantity > 0)) return `Enter an amount for ${name}.`
  if (l.quantity > MAX_AMOUNT) return `That's a lot of ${name}. Check the amount.`
  if (!unitsFor(l.food).includes(l.unit)) return `Choose grams${l.food.basis === 'ml' ? ' (ml)' : ''} or a serving for ${name}.`
  return null
}

/** Problems with a food typed in for one meal (not in the list): name and nutrition per 100 g or ml. */
export function customFoodProblem(f: Pick<Food, 'name' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'>): string | null {
  const n = f.name.trim()
  if (n.length < 2) return 'Give the food a name.'
  if (n.length > 120) return 'Food names can be up to 120 characters.'
  if (!(f.kcal >= 0 && f.kcal <= 900)) return 'Calories per 100: 0 to 900.'
  for (const k of ['protein_g', 'carbs_g', 'fat_g'] as const) if (!(f[k] >= 0 && f[k] <= 100)) return 'Protein, carbs and fat per 100: 0 to 100 g.'
  return null
}

/** The title shown for a logged meal: its foods ("Oats, banana and whey protein", "Eggs, toast and 2 more"). */
export function mealTitle(names: string[], fallback = 'Meal'): string {
  const n = names.map((x) => x.trim()).filter(Boolean)
  if (!n.length) return fallback
  if (n.length === 1) return n[0]
  if (n.length <= 3) return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
  return `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`
}

// ---------- Saved food rows (meal_items) ----------

export const FOOD_UNITS = ['g', 'ml', 'oz', 'cup', 'tbsp', 'tsp', 'piece', 'serving'] as const
export type FoodUnit = (typeof FOOD_UNITS)[number]

/** A food in a logged meal, as saved: the amount and the calories and macros it had then. */
export interface MealItem extends Nutrition {
  food_id: string | null
  food_name: string
  quantity: number
  unit: FoodUnit
  /** the serving's name when unit is 'serving' ("1 large egg") */
  serving: string | null
}

/** The row to save for a line (calculated numbers included, so history stays put if the food changes). */
export function itemFromLine(l: FoodLine): MealItem {
  const n = lineNutrition(l) ?? NO_NUTRITION
  const isBase = l.unit === 'g' || l.unit === 'ml'
  return { food_id: l.food.id, food_name: l.food.name.trim(), quantity: l.quantity, unit: isBase ? (l.unit as FoodUnit) : 'serving', serving: isBase ? null : l.unit, ...n }
}

/** Back to an editable line, when the food is known (planned meals, "log as planned"). */
export function lineFromSaved(x: { quantity: number; unit: string; serving?: string | null }, food: Food): FoodLine {
  return { food, quantity: x.quantity, unit: x.unit === 'serving' ? x.serving ?? food.basis : x.unit }
}

// ---------- Meal plans ----------

export type PlanDay = 'every' | 'training' | 'rest'
export const PLAN_DAY_LABEL: Record<PlanDay, string> = { every: 'Every day', training: 'Training days', rest: 'Rest days' }

export interface PlanMeal { day: PlanDay; meal_type: MealType; notes: string; lines: FoodLine[] }

export interface MealPlan {
  id: string | null
  /** null = one of the coach's templates */
  client_id: string | null
  name: string
  /** client plans: applies from this date until the next version */
  effective_from: string | null
  /** separate training-day and rest-day plans */
  split: boolean
  meals: PlanMeal[]
}

/** The meals a client eats in a day, from their setup answer (one snack slot for 4 or 5). */
export function mealsFor(perDay: number | null): MealType[] {
  switch (perDay) {
    case 2: return ['breakfast', 'dinner']
    case 4:
    case 5: return ['breakfast', 'snack', 'lunch', 'dinner']
    default: return ['breakfast', 'lunch', 'dinner']
  }
}

export const planDays = (split: boolean): PlanDay[] => (split ? ['training', 'rest'] : ['every'])

/** Which plan day a date uses: "every", or training/rest by whether a workout is planned that day. */
export const planDayFor = (split: boolean, training: boolean): PlanDay => (!split ? 'every' : training ? 'training' : 'rest')

export const planMeal = (p: MealPlan, day: PlanDay, type: MealType): PlanMeal | undefined =>
  p.meals.find((m) => m.day === day && m.meal_type === type)

export const mealNutrition = (m: PlanMeal | undefined) => sumNutrition((m?.lines ?? []).map(lineNutrition))

/** A day's planned totals. */
export const dayNutrition = (p: MealPlan, day: PlanDay) => sumNutrition(p.meals.filter((m) => m.day === day).map(mealNutrition))

/** Planned vs target: the share in % (null without a target) and the difference. */
export function vsTarget(value: number, target: number | null | undefined): { pct: number | null; diff: number } {
  return { pct: target ? Math.round((value / target) * 100) : null, diff: target ? Math.round(value - target) : 0 }
}

/** Switching a plan to split copies "every day" into training and rest days; back again keeps training days. */
export function setSplit(p: MealPlan, split: boolean): MealPlan {
  if (split === p.split) return p
  const copy = (from: PlanDay, to: PlanDay) => p.meals.filter((m) => m.day === from).map((m) => ({ ...m, day: to, lines: m.lines.map((l) => ({ ...l })) }))
  return { ...p, split, meals: split ? [...copy('every', 'training'), ...copy('every', 'rest')] : copy('training', 'every') }
}

// ---------- "Foods to avoid" ----------

/** The client's "foods to avoid" answer as separate terms ("peanuts, shellfish and dairy" → peanut, shellfish, dairy). */
export function avoidTerms(text: string | null | undefined): string[] {
  if (!text) return []
  return [...new Set(text.toLowerCase()
    .split(/[,;/\n]|\band\b|\bor\b/)
    .map((t) => t.replace(/\b(no|any|avoid|allergic to|allergy|intolerant to)\b/g, '').replace(/[^a-z\s-]/g, '').trim())
    .map((t) => t.split(/\s+/).map(singular).join(' '))
    .filter((t) => t.length >= 3))]
}

/** "berries" → "berry", "peanuts" → "peanut", "glass" stays. */
function singular(w: string): string {
  return w.replace(/ies$/, 'y').replace(/(?<=[^s])s$/, '')
}

/**
 * The avoid term a food's name matches, or null: a word of the name (both made
 * singular) starting with the term, so "eggs" matches "Egg white" and "berries"
 * matches "Berries, mixed", but "nuts" doesn't match "Peanut butter". Name matching only.
 */
export function avoidMatch(foodName: string, terms: string[]): string | null {
  const name = ` ${foodName.toLowerCase().split(/[^a-z]+/).filter(Boolean).map(singular).join(' ')}`
  return terms.find((t) => name.includes(` ${t}`)) ?? null
}

// ---------- Logged vs planned ----------

const sameFood = (a: Food, b: Food) => (a.id && b.id ? a.id === b.id : a.name.trim().toLowerCase() === b.name.trim().toLowerCase())

/**
 * How a logged meal compares with the plan for it: every planned food eaten in
 * about the planned amount (within 20%) and nothing else → on plan; some of it →
 * partly; none → off plan.
 */
export function planMatch(planned: FoodLine[], logged: FoodLine[]): OnPlan {
  if (!planned.length) return 'yes'
  const used = new Set<number>()
  let matched = 0
  for (const p of planned) {
    const pBase = baseAmount(p.food, p.quantity, p.unit)
    const i = logged.findIndex((l, k) => !used.has(k) && sameFood(p.food, l.food))
    if (i < 0) continue
    used.add(i)
    const lBase = baseAmount(logged[i].food, logged[i].quantity, logged[i].unit)
    if (pBase && lBase != null && Math.abs(lBase - pBase) <= pBase * 0.2) matched++
    else matched += 0.5
  }
  const extra = logged.length - used.size
  if (matched === planned.length && extra === 0) return 'yes'
  return matched > 0 ? 'partly' : 'no'
}

/** Quick add (totals only) against the planned meal: within 15% of the planned calories → on plan, 35% → partly. */
export function planMatchCalories(plannedKcal: number, loggedKcal: number): OnPlan {
  if (!plannedKcal) return 'yes'
  const off = Math.abs(loggedKcal - plannedKcal) / plannedKcal
  return off <= 0.15 ? 'yes' : off <= 0.35 ? 'partly' : 'no'
}

// ---------- Planned vs eaten, for the coach ----------

export interface PlanVsEatenRow {
  meal_type: MealType
  /** days this week with a plan for this meal, and its average planned numbers */
  planned_days: number
  planned: Nutrition
  /** days with this meal logged, and the average eaten on those days */
  logged_days: number
  eaten: Nutrition
  /** logged meals of this type rated on plan */
  on_plan: number
  meals: number
}

/**
 * Per meal type over some days: what the plan in force each day said, and what
 * was logged. `days` gives each date's plan meal (or null) and logged meals.
 */
export function planVsEaten(
  types: MealType[],
  days: { planned: Partial<Record<MealType, Nutrition>> | null; logged: { meal_type: MealType; on_plan: OnPlan | null; nutrition: Nutrition }[] }[],
): PlanVsEatenRow[] {
  const avg = (xs: Nutrition[]) => {
    const s = sumNutrition(xs)
    const n = Math.max(1, xs.length)
    return xs.length ? { calories: Math.round(s.calories / n), protein_g: r1(s.protein_g / n), carbs_g: r1(s.carbs_g / n), fat_g: r1(s.fat_g / n) } : NO_NUTRITION
  }
  return types.map((t) => {
    const planned = days.map((d) => d.planned?.[t]).filter((x): x is Nutrition => !!x)
    const perDay = days.map((d) => d.logged.filter((m) => m.meal_type === t)).filter((ms) => ms.length > 0)
    const all = perDay.flat()
    return {
      meal_type: t,
      planned_days: planned.length,
      planned: avg(planned),
      logged_days: perDay.length,
      eaten: avg(perDay.map((ms) => sumNutrition(ms.map((m) => m.nutrition)))),
      on_plan: all.filter((m) => m.on_plan === 'yes').length,
      meals: all.length,
    }
  })
}

/** Whether a program running on `date` has a workout on that weekday (programs: start date, length in weeks, workout weekdays 0–6). */
export function isTrainingDay(programs: { start_date: string | null; weeks: number; days: (number | null)[] }[], date: string): boolean {
  const d = new Date(`${date}T00:00:00`)
  return programs.some((p) => {
    if (!p.start_date || p.start_date > date) return false
    const end = new Date(`${p.start_date}T00:00:00`)
    end.setDate(end.getDate() + p.weeks * 7)
    return d < end && p.days.includes(d.getDay())
  })
}
