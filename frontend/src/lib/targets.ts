// Nutrition target helpers for the coach's Nutrition page and the targets form.
// Pure functions (type-only imports), unit-tested in tests/targets.test.ts.

import type { Targets } from './api'

/** Calories the macros add up to: 4 kcal per g of protein and carbs, 9 per g of fat. */
export const macroCalories = (t: Pick<Targets, 'protein_g' | 'carbs_g' | 'fat_g'>) =>
  Math.round(t.protein_g * 4 + t.carbs_g * 4 + t.fat_g * 9)

/** How far apart the calorie target and the macros may be before we warn. */
export const MISMATCH_LIMIT = 0.05

/**
 * A warning when the calorie target and the macros disagree by more than ~5%,
 * or null. Nothing to say until calories and at least one macro are filled in.
 */
export function calorieMismatch(t: Pick<Targets, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'>): string | null {
  const fromMacros = macroCalories(t)
  if (!t.calories || !fromMacros) return null
  const diff = (fromMacros - t.calories) / t.calories
  if (Math.abs(diff) <= MISMATCH_LIMIT) return null
  const pct = Math.round(Math.abs(diff) * 100)
  return `The macros add up to ${fromMacros.toLocaleString('en-US')} kcal, ${pct}% ${diff > 0 ? 'more' : 'less'} than the calorie target.`
}

/** Problems with a set of targets, or null if it can be saved. */
export function targetsProblem(t: Targets): string | null {
  if (!(t.calories >= 800 && t.calories <= 8000)) return 'Calories should be between 800 and 8,000.'
  if (t.protein_g < 0 || t.protein_g > 500 || t.carbs_g < 0 || t.carbs_g > 1000 || t.fat_g < 0 || t.fat_g > 400) return 'Check the macro grams.'
  if (t.steps < 0 || t.steps > 100_000) return 'Steps should be between 0 and 100,000.'
  if (t.sleep_h && (t.sleep_h < 3 || t.sleep_h > 14)) return 'Sleep should be between 3 and 14 hours.'
  if (t.water_ml < 0 || t.water_ml > 10_000) return 'Water should be between 0 and 10 litres.'
  return null
}

/** The start date for new targets: today, or a date the coach picked (not in the past). */
export function effectiveFromProblem(from: string, todayIso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return 'Pick a start date.'
  if (from < todayIso) return 'New targets start today or later.'
  return null
}
