// Live data for the food list (0022) and coach meal plans (0023). Everything
// runs as the signed-in user under RLS: the shared list plus the coach's own
// foods; a coach writes their own clients' plans and templates; a client reads
// their own plan. lib/meals.ts does the maths.

import type { MealType, OnPlan } from '@/types/db'
import type { DayPlan, FoodDraft, PlanWeek } from '../api'
import { ApiError } from '../backend'
import { addDays, today } from '../dates'
import { lineFromSaved, mealsFor, type Food, type MealPlan, type Nutrition, type PlanDay, type PlanMeal } from '../meals'
import { planForDay, planWeekFrom } from '../mealPlans'
import { db, dayBounds, localDate, must, myId, targetsOn } from './shared'

const FOOD_COLS = 'id, name, basis, kcal, protein_g, carbs_g, fat_g, servings, created_by'
const PLAN_COLS = `id, client_id, name, effective_from, split, notes, meal_plan_items(day_type, meal_type, position, quantity, unit, serving, foods(${FOOD_COLS}))`

const n = (x: unknown) => (x == null ? 0 : Number(x))

export function toFood(r: any): Food {
  return {
    id: r.id, name: r.name, basis: r.basis, kcal: n(r.kcal), protein_g: n(r.protein_g), carbs_g: n(r.carbs_g), fat_g: n(r.fat_g),
    servings: (r.servings ?? []).map((s: any) => ({ name: String(s.name), amount: n(s.amount) })), custom: r.created_by != null,
  }
}

function check<T>(res: { data: T | null; error: { code?: string; message: string } | null }, what = 'meal plan'): T {
  const e = res.error
  if (!e) return res.data as T
  if (e.code === 'PT404') throw new ApiError(404, `That ${what} doesn't exist (or isn't yours).`, e.code)
  if (e.code === 'P0001') throw new ApiError(409, e.message, e.code)
  if (e.code === '23505') throw new ApiError(409, 'You already have a food with this name.', e.code)
  if (e.code === '23514') throw new ApiError(422, 'A value is out of range. Check the name and the numbers per 100.', e.code)
  if (e.code === '23503') throw new ApiError(409, "It's in a meal plan, so it can't be deleted. Rename it instead.", e.code)
  if (e.code === '42501') throw new ApiError(403, "You don't have access to that.", e.code)
  throw new ApiError(500, `Something went wrong saving the ${what}.`, e.code)
}

// ---------- Foods ----------

async function foods(): Promise<Food[]> {
  return (must(await db().from('foods').select(FOOD_COLS).order('name')) as any[]).map(toFood)
}

async function saveFood(d: FoodDraft): Promise<{ id: string }> {
  const row = {
    name: d.name.trim(), basis: d.basis, kcal: d.kcal, protein_g: d.protein_g, carbs_g: d.carbs_g, fat_g: d.fat_g,
    servings: d.servings.map((s) => ({ name: s.name.trim(), amount: s.amount })),
  }
  if (d.id) {
    const r = check(await db().from('foods').update(row).eq('id', d.id).select('id'), 'food') as { id: string }[]
    if (!r.length) throw new ApiError(404, "That food doesn't exist (or isn't yours).")
    return { id: d.id }
  }
  const uid = await myId()
  return check(await db().from('foods').insert({ ...row, created_by: uid }).select('id').single(), 'food') as { id: string }
}

async function deleteFood(id: string) {
  const r = check(await db().from('foods').delete().eq('id', id).not('created_by', 'is', null).select('id'), 'food') as { id: string }[]
  if (!r.length) throw new ApiError(404, "That food doesn't exist (or isn't yours).")
  return { ok: true }
}

// ---------- Plans ----------

export function toPlan(r: any): MealPlan {
  const meals = new Map<string, PlanMeal>()
  const get = (day: PlanDay, type: MealType) => {
    const k = `${day}:${type}`
    if (!meals.has(k)) meals.set(k, { day, meal_type: type, notes: r.notes?.[k] ?? '', lines: [] })
    return meals.get(k)!
  }
  for (const k of Object.keys(r.notes ?? {})) {
    const [day, type] = k.split(':') as [PlanDay, MealType]
    get(day, type)
  }
  for (const x of [...(r.meal_plan_items ?? [])].sort((a: any, b: any) => a.position - b.position)) {
    if (!x.foods) continue // a food the reader can't see (shouldn't happen: plans use the coach's foods)
    get(x.day_type, x.meal_type).lines.push(lineFromSaved({ quantity: n(x.quantity), unit: x.unit, serving: x.serving }, toFood(x.foods)))
  }
  return { id: r.id, client_id: r.client_id, name: r.name, effective_from: r.effective_from, split: !!r.split, meals: [...meals.values()] }
}

async function plans(clientId: string): Promise<MealPlan[]> {
  return (must(await db().from('meal_plans').select(PLAN_COLS).eq('client_id', clientId).order('effective_from', { ascending: false })) as any[]).map(toPlan)
}

async function templates(): Promise<MealPlan[]> {
  const uid = await myId()
  return (must(await db().from('meal_plans').select(PLAN_COLS).eq('coach_id', uid).is('client_id', null).order('name')) as any[]).map(toPlan)
}

async function savePlan(p: MealPlan): Promise<{ id: string }> {
  const items = p.meals.flatMap((m) => m.lines.map((l, i) => {
    const base = l.unit === 'g' || l.unit === 'ml'
    return { day_type: m.day, meal_type: m.meal_type, position: i, food_id: l.food.id, quantity: l.quantity, unit: base ? l.unit : 'serving', serving: base ? null : l.unit }
  }))
  const notes = Object.fromEntries(p.meals.filter((m) => m.notes.trim()).map((m) => [`${m.day}:${m.meal_type}`, m.notes.trim()]))
  const body = { id: p.client_id ? null : p.id, client_id: p.client_id, name: p.name, effective_from: p.effective_from, split: p.split, notes, items }
  return { id: check(await db().rpc('save_meal_plan', { p: body })) as string }
}

async function deletePlan(id: string) {
  const r = check(await db().from('meal_plans').delete().eq('id', id).select('id')) as { id: string }[]
  if (!r.length) throw new ApiError(404, "That meal plan doesn't exist (or isn't yours).")
  return { ok: true }
}

/** The plan in force on `date` for the client (newest version that has started), as that day shows it. */
export async function dayPlan(clientId: string, date: string, training: boolean): Promise<DayPlan | null> {
  const r = (must(await db().from('meal_plans').select(PLAN_COLS).eq('client_id', clientId).lte('effective_from', date)
    .order('effective_from', { ascending: false }).limit(1)) as any[])[0]
  return r ? planForDay(toPlan(r), training) : null
}

/** Planned vs eaten for a client's week (Monday `ws`), for the coach. */
async function week(clientId: string, ws: string): Promise<PlanWeek> {
  const end = addDays(ws, 6)
  const [versions, meals, profile, programs, targets] = await Promise.all([
    db().from('meal_plans').select(PLAN_COLS).eq('client_id', clientId).lte('effective_from', end).order('effective_from', { ascending: false }),
    db().from('meal_logs').select('eaten_at, meal_type, calories, protein_g, carbs_g, fat_g, on_plan').eq('client_id', clientId)
      .gte('eaten_at', dayBounds(ws)[0]).lt('eaten_at', dayBounds(addDays(ws, 7))[0]),
    db().from('client_profiles').select('meals_per_day').eq('user_id', clientId).maybeSingle(),
    db().from('programs').select('start_date, weeks, workout_templates(day_of_week, removed_at)').eq('client_id', clientId).not('assigned_at', 'is', null),
    targetsOn(clientId, end < today() ? end : today()),
  ])
  const plansIn = (must(versions) as any[]).map(toPlan)
  const progs = (must(programs) as any[]).map((p) => ({ start_date: p.start_date, weeks: p.weeks, days: (p.workout_templates ?? []).filter((t: any) => !t.removed_at).map((t: any) => t.day_of_week) }))
  const logged = (must(meals) as any[]).map((m) => ({
    date: localDate(m.eaten_at), meal_type: m.meal_type as MealType, on_plan: m.on_plan as OnPlan | null,
    nutrition: { calories: n(m.calories), protein_g: n(m.protein_g), carbs_g: n(m.carbs_g), fat_g: n(m.fat_g) } as Nutrition,
  }))
  return planWeekFrom(ws, plansIn, logged, mealsFor((must(profile) as any)?.meals_per_day ?? null), progs, targets?.targets ?? null)
}

export const liveMealPlans = { foods, saveFood, deleteFood, plans, templates, savePlan, deletePlan, week }
