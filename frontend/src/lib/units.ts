import type { UnitSystem } from '@/types/db'

// Everything is stored metric. Convert only for display.
const KG_PER_LB = 0.45359237
const CM_PER_IN = 2.54

export const kgToLb = (kg: number) => kg / KG_PER_LB
export const lbToKg = (lb: number) => lb * KG_PER_LB

export function weight(kg: number, units: UnitSystem = 'metric', digits = 1) {
  return units === 'imperial' ? `${kgToLb(kg).toFixed(digits)} lb` : `${kg.toFixed(digits)} kg`
}

// ---------- Weights in the signed-in user's units (stored in kg) ----------
// Display: body weight to 0.1 in either unit; loads (sets, bests) to 0.1 lb or
// 0.5 kg. Input: 0.1 in either unit, saved as kg with two decimals, which is
// fine enough that a value typed in lb comes back exactly (0.01 kg = 0.022 lb).

export const unitLabel = (u: UnitSystem) => (u === 'imperial' ? 'lb' : 'kg')

/** kg → the user's unit (unrounded). */
export const toUnit = (kg: number, u: UnitSystem) => (u === 'imperial' ? kgToLb(kg) : kg)

/** The user's unit → kg (unrounded). */
export const fromUnit = (v: number, u: UnitSystem) => (u === 'imperial' ? lbToKg(v) : v)

/** Rounds to a step without float noise (72.60000001 → 72.6). */
export const roundTo = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(2))

/** What a user typed (their unit) → kg to store, two decimals. */
export const kgFromInput = (v: number, u: UnitSystem) => Math.round(fromUnit(v, u) * 100) / 100

/** A stored kg value as an input's starting value, in the user's unit (0.1). */
export const inputFromKg = (kg: number, u: UnitSystem) => String(roundTo(toUnit(kg, u), 0.1))

/** Body weight in the user's unit, to 0.1 (a number, for charts and sums). */
export const bodyValue = (kg: number, u: UnitSystem) => roundTo(toUnit(kg, u), 0.1)

/** "71.6 kg" / "157.9 lb". */
export const bodyWeight = (kg: number, u: UnitSystem) => `${bodyValue(kg, u)} ${unitLabel(u)}`

/** A load in the user's unit: 0.1 lb, or 0.5 kg (plate steps). */
export const loadValue = (kg: number, u: UnitSystem) => roundTo(toUnit(kg, u), u === 'imperial' ? 0.1 : 0.5)

/** "82.5 kg" / "181.9 lb". */
export const loadWeight = (kg: number, u: UnitSystem) => `${loadValue(kg, u)} ${unitLabel(u)}`

/** A signed change in kg shown in the user's unit: "−2.8 kg" / "−6.2 lb". */
export const weightChange = (kgDelta: number, u: UnitSystem, digits = 1) => delta(toUnit(kgDelta, u), unitLabel(u), digits)

export function length(cm: number, units: UnitSystem = 'metric') {
  return units === 'imperial' ? `${(cm / CM_PER_IN).toFixed(1)} in` : `${Math.round(cm)} cm`
}

// Body measurements (waist, hips) are entered and shown in inches, and stored
// in centimetres (check_ins.waist_cm, hips_cm).
export const cmToIn = (cm: number) => cm / CM_PER_IN
/** Inches → centimetres, rounded to the column's one decimal place. */
export const inToCm = (inches: number) => Math.round(inches * CM_PER_IN * 10) / 10
/** "30.7 in" from centimetres. */
export const inches = (cm: number) => `${cmToIn(cm).toFixed(1)} in`

/** Signed change: "−2.8 kg", "+0.3 kg" (uses a real minus sign). */
export function delta(value: number, unit = 'kg', digits = 1) {
  const s = Math.abs(value).toFixed(digits)
  return `${value < 0 ? '−' : '+'}${s}${unit ? ` ${unit}` : ''}`
}

export const int = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n))

/** "1.5 L" from millilitres. */
export const litres = (ml: number) => `${(ml / 1000).toFixed(1).replace(/\.0$/, '')} L`

/** "7h 10m" from decimal hours. */
export function hoursMinutes(hours: number, spaced = false) {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return spaced ? `${h} h ${m} m` : `${h}h ${m}m`
}

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

/** Weekly weight points (kg) converted for a chart in the user's unit. */
export const pointsIn = <T extends { kg: number | null }>(points: T[], u: UnitSystem): T[] =>
  points.map((p) => ({ ...p, kg: p.kg == null ? null : bodyValue(p.kg, u) }))
