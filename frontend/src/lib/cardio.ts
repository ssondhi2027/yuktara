// Cardio (0026): bouts logged by time, with optional distance, level and heart
// rate; planned as rounds of minutes or a distance at an effort zone. Pure
// functions with type-only imports; unit-tested in tests/cardio.test.ts.
// Time is stored in seconds and distance in metres; screens show km or miles
// by the viewer's units.

import type { UnitSystem } from '../types/db'

export type CardioZone = 'easy' | 'moderate' | 'hard' | 'max'
export const CARDIO_ZONES: CardioZone[] = ['easy', 'moderate', 'hard', 'max']
export const ZONE_LABEL: Record<CardioZone, string> = { easy: 'easy', moderate: 'moderate', hard: 'hard', max: 'all out' }
/** What each zone feels like, for the plan and the logger. */
export const ZONE_HINT: Record<CardioZone, string> = {
  easy: 'easy: you can talk in full sentences',
  moderate: 'moderate: a few words at a time',
  hard: 'hard: a word or two',
  max: 'all out: no talking',
}

/** Equipment offered for a coach's own cardio exercise (free text is allowed too). */
export const CARDIO_EQUIPMENT = ['treadmill', 'bike', 'air bike', 'rower', 'elliptical', 'stair climber', 'ski erg', 'pool', 'outdoors', 'bodyweight'] as const

const M_PER_MI = 1609.344

// ---------- Distance ----------

export const distanceUnit = (u: UnitSystem) => (u === 'imperial' ? 'mi' : 'km')
const perUnit = (u: UnitSystem) => (u === 'imperial' ? M_PER_MI : 1000)

/** Metres → km or miles, to 0.01. */
export const distanceValue = (m: number, u: UnitSystem) => Math.round((m / perUnit(u)) * 100) / 100

/** "5.2 km", "3.11 mi". */
export const distanceText = (m: number, u: UnitSystem) => `${distanceValue(m, u)} ${distanceUnit(u)}`

/** What a user typed (km or miles) → metres to store (0.1), or null if it isn't a distance. */
export function metresFromInput(text: string, u: UnitSystem): number | null {
  const v = Number(text.trim().replace(',', '.'))
  if (!text.trim() || !Number.isFinite(v) || v <= 0) return null
  return Math.round(v * perUnit(u) * 10) / 10
}

/** Stored metres as an input's starting value, in the user's unit. */
export const inputFromMetres = (m: number, u: UnitSystem) => String(distanceValue(m, u))

// ---------- Time ----------

/**
 * Typed time → seconds: "30" or "30.5" are minutes, "30:15" is minutes and
 * seconds, "1:05:30" is hours, minutes and seconds. Null if it can't be read.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  if (/^\d+(\.\d+)?$/.test(t)) {
    const s = Math.round(Number(t) * 60)
    return s > 0 ? s : null
  }
  const m = /^(?:(\d+):)?(\d{1,3}):(\d{1,2})$/.exec(t)
  if (!m) return null
  const [h, min, sec] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])]
  if (sec >= 60 || (m[1] != null && min >= 60)) return null
  const s = h * 3600 + min * 60 + sec
  return s > 0 ? s : null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Seconds as a clock: "30:00", "4:05", "1:05:30". */
export function clock(seconds: number): string {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

/** Stored seconds as an input's starting value: whole minutes as "30", otherwise "30:15". */
export const inputFromSeconds = (s: number) => (s % 60 === 0 ? String(s / 60) : clock(s))

/** Minutes for totals: "45 min", "1 h 30 min", "2 h". */
export function minutesText(seconds: number): string {
  const min = Math.round(seconds / 60)
  const h = Math.floor(min / 60)
  if (!h) return `${min} min`
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
}

// ---------- Pace and speed ----------

/** Seconds per km, or null without a distance. */
export const paceSecPerKm = (durationS: number, distanceM: number | null | undefined) =>
  distanceM && distanceM > 0 ? durationS / (distanceM / 1000) : null

/** A pace in s/km shown per km or per mile: "5:42 /km", "9:10 /mi". */
export const paceText = (secPerKm: number, u: UnitSystem) => `${clock(u === 'imperial' ? secPerKm * (M_PER_MI / 1000) : secPerKm)} /${distanceUnit(u)}`

/** "10.5 km/h", "6.5 mph". */
export function speedText(durationS: number, distanceM: number, u: UnitSystem): string {
  const perHour = (distanceM / perUnit(u)) / (durationS / 3600)
  return `${Math.round(perHour * 10) / 10} ${u === 'imperial' ? 'mph' : 'km/h'}`
}

// ---------- Sets and plans ----------

/** A cardio bout as logged. */
export interface CardioBout { duration_s?: number | null; distance_m?: number | null; level?: number | null; avg_hr?: number | null; rpe?: number | null }

/** "30:00 · 5.2 km · 5:46 /km · level 6 · 142 bpm @7". */
export function boutText(b: CardioBout, u: UnitSystem): string {
  if (b.duration_s == null) return ''
  const pace = paceSecPerKm(b.duration_s, b.distance_m)
  return [
    clock(b.duration_s),
    b.distance_m ? distanceText(b.distance_m, u) : null,
    pace != null && b.distance_m! >= 200 ? paceText(pace, u) : null,
    b.level != null ? `level ${b.level}` : null,
    b.avg_hr != null ? `${b.avg_hr} bpm` : null,
  ].filter(Boolean).join(' · ') + (b.rpe != null ? ` @${b.rpe}` : '')
}

/** Total time, distance and bouts. */
export function cardioTotals(bouts: CardioBout[]): { seconds: number; metres: number; bouts: number } {
  let seconds = 0
  let metres = 0
  let n = 0
  for (const b of bouts) {
    if (b.duration_s == null) continue
    seconds += b.duration_s
    metres += b.distance_m ?? 0
    n++
  }
  return { seconds, metres: Math.round(metres * 10) / 10, bouts: n }
}

/** A planned cardio slot. */
export interface CardioTarget { sets: number; minutes?: number | null; distance_m?: number | null; zone?: CardioZone | null; rest_seconds?: number | null }

/** Whether a planned slot is cardio (it has a time, a distance or a zone). */
export const isCardioTarget = (x: Partial<CardioTarget>) => x.minutes != null || x.distance_m != null || x.zone != null

const mins = (m: number) => (m >= 1 ? `${Math.round(m * 10) / 10} min` : `${Math.round(m * 60)} s`)

/**
 * "20 min · easy", "5 km · moderate", "5 × 1 min hard, 90 s easy between",
 * "30 min or 5 km · easy".
 */
export function cardioTargetText(x: CardioTarget, u: UnitSystem): string {
  const amount = [x.minutes != null ? mins(x.minutes) : null, x.distance_m != null ? distanceText(x.distance_m, u) : null].filter(Boolean).join(' or ') || 'Cardio'
  const zone = x.zone ? ZONE_LABEL[x.zone] : null
  if (x.sets > 1) {
    const rest = x.rest_seconds ? `, ${x.rest_seconds >= 60 ? mins(x.rest_seconds / 60) : `${x.rest_seconds} s`} easy between` : ''
    return `${x.sets} × ${amount}${zone ? ` ${zone}` : ''}${rest}`
  }
  return zone ? `${amount} · ${zone}` : amount
}

/** Problems with a planned cardio slot (none = ok). */
export function cardioTargetProblems(x: CardioTarget): string[] {
  const out: string[] = []
  if (x.minutes == null && x.distance_m == null) out.push('a time or a distance is required')
  if (x.minutes != null && !(x.minutes > 0 && x.minutes <= 600)) out.push('minutes: up to 600')
  if (x.distance_m != null && !(x.distance_m > 0 && x.distance_m <= 1_000_000)) out.push('distance: up to 1,000 km')
  if (!(Number.isInteger(x.sets) && x.sets >= 1 && x.sets <= 10)) out.push('rounds: 1 to 10')
  return out
}
