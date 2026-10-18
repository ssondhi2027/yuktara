// Progress page calculations: KPIs and chart series from the client's raw logs.
// The live data (lib/live/client.ts) and the demo data (lib/demo.ts) both build
// a ProgressRaw and pass it through progressFrom(), so the numbers are computed
// one way. Pure functions with type-only imports; unit-tested in
// tests/progress.test.ts. Weights are kg here; screens convert for display.

import type { MuscleGroup } from '../types/db'
import {
  forecastLift, liftPlateau, oneRepMax, smoothLift, weightSignals, windowStart,
  type LiftForecast, type LiftPoint, type Plateau, type WeightForecast,
} from './forecast.ts'

export type Period = 'p4' | 'p12' | 'all'
export const PERIOD_WEEKS: Record<Exclude<Period, 'all'>, number> = { p4: 4, p12: 12 }

export interface DayTargets { calories: number; protein_g: number; water_ml: number | null; steps: number | null; sleep_h: number | null }

export interface ProgressRaw {
  today: string
  start_date: string
  goal_weight_kg: number | null
  /** daily logs from rawFrom(): the period, the one before it and the forecasts' 12 weeks */
  days: { date: string; weight_kg: number | null; steps: number | null; water_ml: number | null; sleep_h: number | null }[]
  meals: { date: string; calories: number; protein_g: number; on_plan: 'yes' | 'partly' | 'no' | null }[]
  /** target versions, any order */
  targets: (DayTargets & { from: string })[]
  /** assigned programs that have started: start, length and how many dated workouts a week */
  programs: { start_date: string; weeks: number; planned: number }[]
  /** finished sessions with their working sets */
  sessions: {
    date: string
    template_id: string | null
    sets: { exercise_id: string; name: string; kg: number | null; reps: number | null; rpe?: number | null; primary: MuscleGroup[] }[]
  }[]
  check_ins: { week_start: string; waist_cm: number | null; hips_cm: number | null; energy: number | null; sleep: number | null; stress: number | null; hunger: number | null }[]
}

/** A KPI: this period's value, the previous period's (for the trend arrow), and a target if there is one. */
export interface Kpi { value: number | null; previous: number | null; target?: number | null }

export interface ProgressDetail {
  period: Period
  /** Mondays of the weeks shown, oldest first */
  weeks: string[]
  kpis: {
    weight: Kpi & { change: number | null; to_goal: number | null }
    workouts: Kpi & { done: number; planned: number; streak: number }
    calories: Kpi
    protein: Kpi
    meals_on_plan: Kpi
    steps: Kpi
    water: Kpi
    sleep: Kpi
  }
  weight: {
    weekly: { week: string; kg: number | null }[]
    daily: { date: string; kg: number }[]
    goal_kg: number | null
    /** the forecast's value four weeks ahead (kept for simple callers), or null with too little data */
    projection: { week: string; kg: number } | null
    /** robust trend, 80% band and goal date from the last 12 weeks, whatever the period (lib/forecast.ts) */
    forecast: WeightForecast
    plateau: Plateau | null
  }
  training: {
    weekly: { week: string; done: number; planned: number; volume_kg: number; sets: number }[]
    muscles: { muscle: MuscleGroup; sets: number }[]
  }
  /**
   * The three most-logged lifts in the period: per-session best estimate (raw) and
   * smoothed line for the period; forecast and plateau from the last 12 weeks.
   */
  strength: { exercise_id: string; name: string; sessions: number; points: LiftPoint[]; forecast: LiftForecast; plateau: Plateau | null }[]
  nutrition: {
    daily: { date: string; calories: number | null; protein_g: number | null; calories_target: number | null; protein_target: number | null }[]
    weekly_on_plan: { week: string; pct: number | null; meals: number }[]
  }
  habits: { date: string; steps: number | null; water_ml: number | null; sleep_h: number | null; steps_target: number | null; water_target: number | null; sleep_target: number | null }[]
  check_ins: ProgressRaw['check_ins']
}

// ---------- Dates (local, YYYY-MM-DD; no time zones involved) ----------

const DAY = 86_400_000
const toDate = (iso: string) => new Date(`${iso}T00:00:00`)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const plusDays = (d: string, n: number) => iso(new Date(toDate(d).getTime() + n * DAY))
export const mondayOf = (d: string) => plusDays(d, -((toDate(d).getDay() + 6) % 7))

/** Mondays of the period's weeks (oldest first), and of the same number of weeks before them. */
export function periodWeeks(period: Period, today: string, startDate: string): { weeks: string[]; previous: string[] } {
  const thisWeek = mondayOf(today)
  const first = mondayOf(startDate)
  const sinceStart = Math.max(1, Math.round((toDate(thisWeek).getTime() - toDate(first).getTime()) / (7 * DAY)) + 1)
  const n = period === 'all' ? sinceStart : Math.min(PERIOD_WEEKS[period], sinceStart)
  const weeks = Array.from({ length: n }, (_, i) => plusDays(thisWeek, -7 * (n - 1 - i)))
  // "Since start" has nothing before it to compare with.
  const room = period === 'all' ? 0 : Math.max(0, Math.min(n, sinceStart - n))
  const previous = Array.from({ length: room }, (_, i) => plusDays(weeks[0], -7 * (room - i)))
  return { weeks, previous }
}

const inWeeks = (date: string, weeks: string[]) => weeks.length > 0 && date >= weeks[0] && date <= plusDays(weeks[weeks.length - 1], 6)

// ---------- Small helpers ----------

export const average = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
/** Rounds to a step without float noise (7.1000000000000005 → 7.1). */
const round = (x: number | null, step = 1) => (x == null ? null : Number((Math.round(x / step) * step).toFixed(2)))
export const pctOf = (part: number | null, whole: number | null) => (part == null || !whole ? null : Math.round((part / whole) * 100))

/** Training volume: Σ sets × reps × weight (kg). Bodyweight sets add nothing. */
export const volumeKg = (sets: { kg: number | null; reps: number | null }[]) =>
  sets.reduce((a, s) => a + (s.kg ?? 0) * (s.reps ?? 0), 0)

export function targetsOn(targets: ProgressRaw['targets'], date: string): DayTargets | null {
  return [...targets].filter((t) => t.from <= date).sort((a, b) => b.from.localeCompare(a.from))[0] ?? null
}

/** Dated workouts planned in the week starting `monday` (programs running that week; the latest wins). */
export function plannedIn(programs: ProgressRaw['programs'], monday: string): number {
  const running = programs
    .filter((p) => mondayOf(p.start_date) <= monday && plusDays(mondayOf(p.start_date), p.weeks * 7) > monday)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0]
  return running?.planned ?? 0
}

/** Distinct planned workouts done in a week (an extra workout doesn't make up for a missed one), at most `planned`. */
export function doneIn(sessions: ProgressRaw['sessions'], monday: string, planned: number): number {
  const ids = new Set(sessions.filter((s) => s.template_id && inWeeks(s.date, [monday])).map((s) => s.template_id))
  return Math.min(ids.size, planned)
}

/**
 * Weeks in a row hitting the plan, counting back from the latest week. The
 * current week counts once it's hit; until then it doesn't break the streak.
 */
export function planStreak(weekly: { week: string; done: number; planned: number }[], today: string): number {
  let streak = 0
  for (let i = weekly.length - 1; i >= 0; i--) {
    const w = weekly[i]
    const hit = w.planned > 0 && w.done >= w.planned
    if (hit) streak++
    else if (w.week === mondayOf(today) || w.planned === 0) continue
    else break
  }
  return streak
}

// ---------- The page ----------

export function progressFrom(raw: ProgressRaw, period: Period): ProgressDetail {
  const { weeks, previous } = periodWeeks(period, raw.today, raw.start_date)
  const last = plusDays(weeks[weeks.length - 1], 6) < raw.today ? plusDays(weeks[weeks.length - 1], 6) : raw.today
  const daysOf = (ws: string[]) => {
    if (!ws.length) return []
    const end = ws[ws.length - 1] === weeks[weeks.length - 1] ? last : plusDays(ws[ws.length - 1], 6)
    const out: string[] = []
    for (let d = ws[0] < raw.start_date ? raw.start_date : ws[0]; d <= end; d = plusDays(d, 1)) out.push(d)
    return out
  }
  const dayList = daysOf(weeks)
  const prevDays = daysOf(previous)
  const byDay = new Map(raw.days.map((d) => [d.date, d]))

  // Weight
  const weekAvg = (w: string) => average(raw.days.filter((d) => d.weight_kg != null && inWeeks(d.date, [w])).map((d) => d.weight_kg))
  const weekly = weeks.map((w) => ({ week: w, kg: round(weekAvg(w), 0.1) }))
  const withKg = weekly.filter((w) => w.kg != null)
  const current = withKg.length ? withKg[withKg.length - 1].kg : null
  const change = withKg.length >= 2 ? round(withKg[withKg.length - 1].kg! - withKg[0].kg!, 0.1) : null
  const prevAvg = round(average(raw.days.filter((d) => d.weight_kg != null && inWeeks(d.date, previous)).map((d) => d.weight_kg)), 0.1)
  const { forecast, plateau } = weightSignals(raw.days.map((d) => ({ date: d.date, kg: d.weight_kg })), raw.today, raw.start_date, raw.goal_weight_kg)
  const projection = forecast.enough && forecast.points.length >= 4 ? { week: forecast.points[3].week, kg: forecast.points[3].kg } : null

  // Training
  const trainingWeek = (w: string) => {
    const planned = plannedIn(raw.programs, w)
    const sets = raw.sessions.filter((x) => inWeeks(x.date, [w])).flatMap((x) => x.sets)
    return { week: w, done: doneIn(raw.sessions, w, planned), planned, volume_kg: Math.round(volumeKg(sets)), sets: sets.length }
  }
  const tWeeks = weeks.map(trainingWeek)
  const tPrev = previous.map(trainingWeek)
  const sum = (xs: { done: number; planned: number }[], k: 'done' | 'planned') => xs.reduce((a, x) => a + x[k], 0)
  const done = sum(tWeeks, 'done')
  const planned = sum(tWeeks, 'planned')

  const muscleSets = new Map<MuscleGroup, number>()
  for (const x of raw.sessions.filter((x) => inWeeks(x.date, weeks))) {
    for (const st of x.sets) for (const m of st.primary) muscleSets.set(m, (muscleSets.get(m) ?? 0) + 1)
  }

  // Strength: the three exercises with the most sessions in the period. Per
  // session the best set's estimated 1RM (RPE-aware, lib/forecast.ts), smoothed
  // across sessions from the earlier of the period and the forecast window.
  const win = windowStart(raw.today, raw.start_date)
  const liftFrom = weeks[0] < win ? weeks[0] : win
  const bySession = new Map<string, { name: string; dates: Map<string, Omit<LiftPoint, 'smooth' | 'date'>> }>()
  for (const x of raw.sessions.filter((x) => x.date >= liftFrom && x.date <= raw.today)) {
    for (const st of x.sets) {
      const est = oneRepMax(st.kg, st.reps, st.rpe)
      if (est == null) continue
      const e = bySession.get(st.exercise_id) ?? { name: st.name, dates: new Map() }
      const best = e.dates.get(x.date)
      if (!best || est > best.raw) e.dates.set(x.date, { raw: est, kg: st.kg!, reps: st.reps!, rpe: st.rpe ?? null })
      bySession.set(st.exercise_id, e)
    }
  }
  const strength = [...bySession.entries()]
    .map(([id, e]) => {
      const all = smoothLift([...e.dates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })))
      const points = all.filter((p) => inWeeks(p.date, weeks))
      const recent = all.filter((p) => p.date >= win)
      return { exercise_id: id, name: e.name, sessions: points.length, points, forecast: forecastLift(recent), plateau: liftPlateau(recent) }
    })
    .filter((l) => l.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))
    .slice(0, 3)

  // Nutrition: per logged day, against the targets in force that day.
  const mealsOn = (d: string) => raw.meals.filter((m) => m.date === d)
  const nutritionDay = (d: string) => {
    const ms = mealsOn(d)
    const t = targetsOn(raw.targets, d)
    return {
      date: d,
      calories: ms.length ? ms.reduce((a, m) => a + m.calories, 0) : null,
      protein_g: ms.length ? Math.round(ms.reduce((a, m) => a + m.protein_g, 0)) : null,
      calories_target: t?.calories ?? null,
      protein_target: t?.protein_g ?? null,
    }
  }
  const nDays = dayList.map(nutritionDay)
  const nPrev = prevDays.map(nutritionDay)
  const avgOf = (xs: typeof nDays, k: 'calories' | 'protein_g' | 'calories_target' | 'protein_target') =>
    average(xs.filter((x) => x.calories != null).map((x) => x[k]))
  const onPlanPct = (ms: ProgressRaw['meals']) => {
    const rated = ms.filter((m) => m.on_plan)
    if (!rated.length) return null
    return Math.round((rated.reduce((a, m) => a + (m.on_plan === 'yes' ? 1 : m.on_plan === 'partly' ? 0.5 : 0), 0) / rated.length) * 100)
  }
  const mealsIn = (ws: string[]) => raw.meals.filter((m) => inWeeks(m.date, ws))

  // Habits
  const habitDay = (d: string) => {
    const l = byDay.get(d)
    const t = targetsOn(raw.targets, d)
    return {
      date: d, steps: l?.steps ?? null, water_ml: l?.water_ml ?? null, sleep_h: l?.sleep_h ?? null,
      steps_target: t?.steps ?? null, water_target: t?.water_ml ?? null, sleep_target: t?.sleep_h ?? null,
    }
  }
  const hDays = dayList.map(habitDay)
  const hPrev = prevDays.map(habitDay)
  const avgH = (xs: typeof hDays, k: 'steps' | 'water_ml' | 'sleep_h' | 'steps_target' | 'water_target' | 'sleep_target') => average(xs.map((x) => x[k]))

  const prevOk = previous.length > 0
  return {
    period,
    weeks,
    kpis: {
      weight: { value: current, previous: prevOk ? prevAvg : null, change, to_goal: current != null && raw.goal_weight_kg != null ? round(current - raw.goal_weight_kg, 0.1) : null },
      workouts: {
        value: pctOf(done, planned), previous: prevOk ? pctOf(sum(tPrev, 'done'), sum(tPrev, 'planned')) : null,
        done, planned, streak: planStreak([...tPrev, ...tWeeks], raw.today),
      },
      calories: { value: round(avgOf(nDays, 'calories')), previous: prevOk ? round(avgOf(nPrev, 'calories')) : null, target: round(avgOf(nDays, 'calories_target')) },
      protein: { value: round(avgOf(nDays, 'protein_g')), previous: prevOk ? round(avgOf(nPrev, 'protein_g')) : null, target: round(avgOf(nDays, 'protein_target')) },
      meals_on_plan: { value: onPlanPct(mealsIn(weeks)), previous: prevOk ? onPlanPct(mealsIn(previous)) : null },
      steps: { value: round(avgH(hDays, 'steps'), 10), previous: prevOk ? round(avgH(hPrev, 'steps'), 10) : null, target: round(avgH(hDays, 'steps_target')) },
      water: { value: round(avgH(hDays, 'water_ml'), 50), previous: prevOk ? round(avgH(hPrev, 'water_ml'), 50) : null, target: round(avgH(hDays, 'water_target')) },
      sleep: { value: round(avgH(hDays, 'sleep_h'), 0.1), previous: prevOk ? round(avgH(hPrev, 'sleep_h'), 0.1) : null, target: round(avgH(hDays, 'sleep_target'), 0.1) },
    },
    weight: {
      weekly,
      daily: raw.days.filter((d) => d.weight_kg != null && inWeeks(d.date, weeks)).map((d) => ({ date: d.date, kg: d.weight_kg! })),
      goal_kg: raw.goal_weight_kg,
      projection,
      forecast,
      plateau,
    },
    training: {
      weekly: tWeeks,
      muscles: [...muscleSets.entries()].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets),
    },
    strength,
    nutrition: {
      daily: nDays,
      weekly_on_plan: weeks.map((w) => ({ week: w, pct: onPlanPct(mealsIn([w])), meals: mealsIn([w]).length })),
    },
    habits: hDays,
    check_ins: raw.check_ins.filter((c) => inWeeks(c.week_start, weeks)).sort((a, b) => a.week_start.localeCompare(b.week_start)),
  }
}

/** The first date the raw data has to cover for a period: its weeks, the previous ones and the forecast window. */
export function rawFrom(period: Period, today: string, startDate: string): string {
  const { weeks, previous } = periodWeeks(period, today, startDate)
  const first = previous[0] ?? weeks[0]
  const win = windowStart(today, startDate)
  return win < first ? win : first
}

/** Trend vs the previous period: up, down, flat, or none to compare with. */
export function trend(k: Kpi, flatWithin = 0): 'up' | 'down' | 'flat' | null {
  if (k.value == null || k.previous == null) return null
  const d = k.value - k.previous
  return Math.abs(d) <= flatWithin ? 'flat' : d > 0 ? 'up' : 'down'
}
