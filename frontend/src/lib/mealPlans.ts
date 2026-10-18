// Meal plans as a day and a week see them: the plan in force for a day (training-
// or rest-day plan if split), and planned vs eaten per meal for the coach. Shared
// by the live data and demo mode. Pure functions; unit-tested in tests/meals.test.ts.

import type { MealType, OnPlan } from '../types/db'
import type { DayPlan, PlanWeek } from './api'
import { addDays, today } from './dates.ts'
import { dayNutrition, isTrainingDay, mealNutrition, planDayFor, planVsEaten, type MealPlan, type Nutrition } from './meals.ts'

/** The plan as `training` (or rest) day shows it. */
export function planForDay(p: MealPlan, training: boolean): DayPlan {
  const day = planDayFor(p.split, training)
  const meals = p.meals.filter((m) => m.day === day && (m.lines.length || m.notes))
  return {
    from: p.effective_from!, day,
    meals: meals.map((m) => ({ meal_type: m.meal_type, notes: m.notes, lines: m.lines, nutrition: mealNutrition(m) })),
    nutrition: dayNutrition(p, day),
  }
}

/** The week's rows (Monday `ws`, up to today) from plan versions, logged meals and the client's programs. */
export function planWeekFrom(
  ws: string, versions: MealPlan[], logged: { date: string; meal_type: MealType; on_plan: OnPlan | null; nutrition: Nutrition }[],
  types: MealType[], programs: { start_date: string | null; weeks: number; days: (number | null)[] }[], targets: PlanWeek['targets'],
): PlanWeek {
  const last = addDays(ws, 6) < today() ? addDays(ws, 6) : today()
  const inForce = (d: string) => versions.filter((v) => v.effective_from && v.effective_from <= d).sort((a, b) => b.effective_from!.localeCompare(a.effective_from!))[0]
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter((d) => d <= last)
  const rows = planVsEaten(types, days.map((d) => {
    const p = inForce(d)
    const day = p ? planDayFor(p.split, isTrainingDay(programs, d)) : null
    return {
      // Only meals with planned foods count as planned.
      planned: p && day ? Object.fromEntries(types.flatMap((t) => {
        const m = p.meals.find((x) => x.day === day && x.meal_type === t)
        return m && m.lines.length ? [[t, mealNutrition(m)]] : []
      })) : null,
      logged: logged.filter((m) => m.date === d),
    }
  }))
  return { week_start: ws, days: days.length, plan: inForce(last) ?? null, types, rows, targets }
}

