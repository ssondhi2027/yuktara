import type { UnitSystem } from '@/types/db'

// Everything is stored metric. Convert only for display.
const KG_PER_LB = 0.45359237
const CM_PER_IN = 2.54

export const kgToLb = (kg: number) => kg / KG_PER_LB
export const lbToKg = (lb: number) => lb * KG_PER_LB

export function weight(kg: number, units: UnitSystem = 'metric', digits = 1) {
  return units === 'imperial' ? `${kgToLb(kg).toFixed(digits)} lb` : `${kg.toFixed(digits)} kg`
}

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
