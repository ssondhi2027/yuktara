// Validation for the client's own profile answers, shared by profile setup
// (SetupSheet) and the Profile & settings page. Values are what the person
// typed, in their own units. Pure functions, unit-tested in tests/profile.test.ts.

import type { UnitSystem } from '../types/db'

const num = (v: string) => Number(v.trim())

/** Height in cm (metric) or inches (imperial); empty is fine. */
export function heightProblem(v: string, units: UnitSystem): string | null {
  if (!v.trim()) return null
  const n = num(v)
  const [lo, hi] = units === 'imperial' ? [39, 98] : [100, 250]
  return n > lo && n < hi ? null : 'Check your height.'
}

/** A body weight in kg or lb. */
export function weightProblem(v: string, units: UnitSystem, required = false): string | null {
  if (!v.trim()) return required ? 'Enter your current weight.' : null
  const n = num(v)
  const [lo, hi] = units === 'imperial' ? [66, 660] : [30, 300]
  return n > lo && n < hi ? null : 'Check this weight.'
}

export function nameProblem(v: string): string | null {
  const n = v.trim()
  if (!n) return 'Enter your name.'
  return n.length > 80 ? 'Use up to 80 characters.' : null
}

/**
 * A phone number as typed: optional; digits with spaces, dashes, dots,
 * brackets and a leading +; 7–15 digits (the international limit); at most 32
 * characters like the column.
 */
export function phoneProblem(v: string): string | null {
  const t = v.trim()
  if (!t) return null
  const digits = t.replace(/\D/g, '').length
  if (t.length > 32 || !/^\+?[\d\s().-]+$/.test(t) || digits < 7 || digits > 15) return 'Check this phone number.'
  return null
}

/** Free-text answers (injuries, foods to avoid) are capped like the database columns. */
export const textProblem = (v: string, max = 2000): string | null => (v.length > max ? `Use up to ${max.toLocaleString('en-US')} characters.` : null)
