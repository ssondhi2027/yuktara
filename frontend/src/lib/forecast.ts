// Forecasts and plateau checks for the Progress page and the coach's view.
// Pure functions with type-only imports; unit-tested in tests/forecast.test.ts.
// Weights are kg and time is in weeks here; screens convert units.
//
// Methods (all thresholds are in RULES below):
//   1RM       with RPE: weight ÷ (% of 1RM at reps + reps in reserve), from a
//             standard reps-at-RPE table; without RPE: the mean of Epley and
//             Brzycki. Sets above 10 reps (12 with RPE) and bodyweight sets are skipped.
//   smoothing an exponentially weighted average across sessions (alpha 0.4).
//   trend     Theil–Sen: the median of all pairwise slopes, so one odd week
//             barely moves it.
//   range     80% band: 1.28 × robust spread of the residuals (1.4826 × median
//             absolute residual), widening with distance like a regression
//             prediction interval. Never narrower than 0.15 kg for weight or
//             2.5% of the current 1RM for lifts.
//   goal date when the trend heads toward the goal fast enough; the early and
//             late dates come from the 10th and 90th percentile pairwise slopes.
//   plateau   weight: weekly averages within a 0.5 kg band for 3+ weeks while
//             1+ kg from goal; lift: smoothed 1RM up less than 1% over 21+ days.

export const RULES = {
  /** a set with RPE below this is too far from failure to estimate from */
  minRpe: 6,
  maxRepsWithRpe: 12,
  maxRepsNoRpe: 10,
  smoothingAlpha: 0.4,
  z80: 1.2816,
  weight: {
    windowWeeks: 12,     // forecasts and plateaus look at the last 12 weeks, whatever period is shown
    minWeeks: 4,         // weeks with weigh-ins before any forecast
    minSpanWeeks: 3,     // first to last of those weeks
    horizonWeeks: 8,
    flatKgPerWeek: 0.1,  // slower than this toward the goal: no goal date
    maxGoalWeeks: 52,
    minSpreadKg: 0.15,   // the band is never narrower than this
    reachedWithinKg: 0.3,
  },
  lift: {
    minSessions: 5,
    minSpanDays: 21,
    horizonWeeks: 8,
    minSpreadKg: 1,
    /** an estimate from rep sets is rarely closer than a few % to a real max */
    minSpreadPct: 2.5,
  },
  plateau: {
    weightBandKg: 0.5,
    weightMinWeeks: 3,
    minGoalGapKg: 1,
    liftMinDays: 21,
    liftMaxGainPct: 1,
  },
} as const

// ---------- 1RM ----------

/** % of 1RM you can lift for N reps to failure (index 0 = 1 rep), a standard reps-at-RPE 10 table. */
export const PCT_TO_FAILURE = [100, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.6, 59.9, 57.4]

/** % of 1RM at a (possibly fractional) number of reps to failure, or null outside the table. */
export function pctAtFailure(reps: number): number | null {
  if (reps < 1 || reps > PCT_TO_FAILURE.length) return null
  const lo = Math.floor(reps)
  const hi = Math.ceil(reps)
  const a = PCT_TO_FAILURE[lo - 1]
  const b = PCT_TO_FAILURE[hi - 1]
  return a + (b - a) * (reps - lo)
}

export const epley = (kg: number, reps: number) => (reps === 1 ? kg : kg * (1 + reps / 30))
export const brzycki = (kg: number, reps: number) => kg * (36 / (37 - reps))

/** Estimated 1RM from one set, or null when the set can't give a fair estimate. */
export function oneRepMax(kg: number | null, reps: number | null, rpe?: number | null): number | null {
  if (kg == null || kg <= 0 || reps == null || reps < 1) return null
  if (rpe != null && rpe >= RULES.minRpe && rpe <= 10) {
    if (reps > RULES.maxRepsWithRpe) return null
    const pct = pctAtFailure(reps + (10 - rpe))
    return pct ? (kg * 100) / pct : null
  }
  if (reps > RULES.maxRepsNoRpe) return null
  return reps === 1 ? kg : (epley(kg, reps) + brzycki(kg, reps)) / 2
}

/** Exponentially weighted average: each value moves the line `alpha` of the way. */
export function ewma(xs: number[], alpha: number = RULES.smoothingAlpha): number[] {
  const out: number[] = []
  xs.forEach((x, i) => out.push(i === 0 ? x : alpha * x + (1 - alpha) * out[i - 1]))
  return out
}

// ---------- Robust trend and range ----------

export const median = (xs: number[]) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b)
  if (!s.length) return NaN
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (pos - lo)
}

export interface Fit { slope: number; intercept: number; slopes: number[]; spread: number; n: number; meanX: number; sxx: number }

/** Theil–Sen line through the points, with the robust residual spread. Null with fewer than 2 distinct x. */
export function theilSen(points: { x: number; y: number }[], minSpread = 0): Fit | null {
  const slopes: number[] = []
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x
      if (dx !== 0) slopes.push((points[j].y - points[i].y) / dx)
    }
  }
  if (!slopes.length) return null
  const slope = median(slopes)
  const intercept = median(points.map((p) => p.y - slope * p.x))
  const residuals = points.map((p) => Math.abs(p.y - (intercept + slope * p.x)))
  const meanX = points.reduce((a, p) => a + p.x, 0) / points.length
  const sxx = points.reduce((a, p) => a + (p.x - meanX) ** 2, 0)
  return { slope, intercept, slopes, spread: Math.max(minSpread, 1.4826 * median(residuals)), n: points.length, meanX, sxx }
}

/** Half-width of the 80% band at x: wider further from the data. */
export function bandAt(fit: Fit, x: number): number {
  return RULES.z80 * fit.spread * Math.sqrt(1 + 1 / fit.n + (fit.sxx ? (x - fit.meanX) ** 2 / fit.sxx : 0))
}

const r1 = (x: number) => Math.round(x * 10) / 10

// ---------- Dates ----------

const DAY = 86_400_000
const d0 = (iso: string) => new Date(`${iso}T00:00:00`)
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (iso: string, n: number) => isoOf(new Date(d0(iso).getTime() + Math.round(n) * DAY))
const daysBetween = (a: string, b: string) => Math.round((d0(b).getTime() - d0(a).getTime()) / DAY)
const mondayOf = (iso: string) => addDays(iso, -((d0(iso).getDay() + 6) % 7))

/** First day the forecasts look at: the Monday 11 weeks before this one, or the start week if later. */
export function windowStart(today: string, startDate: string): string {
  const w = addDays(mondayOf(today), -7 * (RULES.weight.windowWeeks - 1))
  const s = mondayOf(startDate)
  return s > w ? s : w
}

/** Weekly-average weights (to 0.1 kg) for each week from windowStart() to this week, oldest first. */
export function weeklyWeights(days: { date: string; kg: number | null }[], today: string, startDate: string): { week: string; kg: number | null }[] {
  const out: { week: string; kg: number | null }[] = []
  for (let w = windowStart(today, startDate); w <= today; w = addDays(w, 7)) {
    const end = addDays(w, 6)
    const kgs = days.filter((d) => d.kg != null && d.date >= w && d.date <= end && d.date <= today).map((d) => d.kg!)
    out.push({ week: w, kg: kgs.length ? r1(kgs.reduce((a, b) => a + b, 0) / kgs.length) : null })
  }
  return out
}

// ---------- Weight forecast ----------

export interface ForecastPoint { week: string; kg: number; lo: number; hi: number }
export type GoalNote = 'reached' | 'away' | 'flat' | 'far' | 'no_goal'

export interface WeightForecast {
  enough: boolean
  slope_kg_week: number | null
  /** trend value at the latest week with weigh-ins */
  now_kg: number | null
  points: ForecastPoint[]
  goal: { date: string; early: string; late: string | null } | null
  goal_note: GoalNote | null
}

const NOT_ENOUGH: WeightForecast = { enough: false, slope_kg_week: null, now_kg: null, points: [], goal: null, goal_note: null }

/** Weeks to go from `now` to `goal` at `slope` per week, or null if that never happens in time. */
function weeksTo(now: number, goal: number, slope: number): number | null {
  const gap = goal - now
  if (Math.abs(slope) < RULES.weight.flatKgPerWeek || Math.sign(gap) !== Math.sign(slope)) return null
  const w = gap / slope
  return w <= RULES.weight.maxGoalWeeks ? w : null
}

/**
 * Weekly-average weights (oldest first; `week` is the Monday) → trend, an 80%
 * band for the next weeks and, with a goal, when it's likely reached.
 */
export function forecastWeight(weekly: { week: string; kg: number | null }[], goalKg: number | null, horizon: number = RULES.weight.horizonWeeks): WeightForecast {
  const pts = weekly.map((w, i) => ({ x: i, y: w.kg })).filter((p): p is { x: number; y: number } => p.y != null)
  if (pts.length < RULES.weight.minWeeks || pts[pts.length - 1].x - pts[0].x < RULES.weight.minSpanWeeks) return NOT_ENOUGH
  const fit = theilSen(pts, RULES.weight.minSpreadKg)
  if (!fit) return NOT_ENOUGH
  const lastX = pts[pts.length - 1].x
  const lastWeek = weekly[lastX].week
  const now = fit.intercept + fit.slope * lastX
  const h = Math.min(horizon, RULES.weight.horizonWeeks)
  const points = Array.from({ length: h }, (_, k) => {
    const x = lastX + k + 1
    const kg = fit.intercept + fit.slope * x
    const half = bandAt(fit, x)
    return { week: addDays(lastWeek, 7 * (k + 1)), kg: r1(kg), lo: r1(kg - half), hi: r1(kg + half) }
  })

  let goal: WeightForecast['goal'] = null
  let note: GoalNote = 'no_goal'
  if (goalKg != null) {
    if (Math.abs(goalKg - now) <= RULES.weight.reachedWithinKg) note = 'reached'
    else {
      const mid = weeksTo(now, goalKg, fit.slope)
      if (mid == null) {
        note = Math.abs(fit.slope) < RULES.weight.flatKgPerWeek ? 'flat' : Math.sign(goalKg - now) !== Math.sign(fit.slope) ? 'away' : 'far'
      } else {
        // Faster and slower likely paces toward the goal.
        const toward = Math.sign(goalKg - now)
        const fast = toward < 0 ? quantile(fit.slopes, 0.1) : quantile(fit.slopes, 0.9)
        const slow = toward < 0 ? quantile(fit.slopes, 0.9) : quantile(fit.slopes, 0.1)
        const early = weeksTo(now, goalKg, fast) ?? mid
        const late = weeksTo(now, goalKg, slow)
        goal = { date: addDays(lastWeek, mid * 7), early: addDays(lastWeek, Math.min(early, mid) * 7), late: late == null ? null : addDays(lastWeek, Math.max(late, mid) * 7) }
      }
    }
  }
  return { enough: true, slope_kg_week: Math.round(fit.slope * 100) / 100, now_kg: r1(now), points, goal, goal_note: goal ? null : note }
}

// ---------- Lifts ----------

export interface LiftPoint { date: string; raw: number; smooth: number; kg: number; reps: number; rpe: number | null }

export interface LiftForecast {
  enough: boolean
  slope_kg_week: number | null
  points: ForecastPoint[]
}

/** Per-session best estimates (oldest first) → the smoothed line. */
export function smoothLift(sessions: Omit<LiftPoint, 'smooth'>[]): LiftPoint[] {
  const s = ewma(sessions.map((p) => p.raw))
  return sessions.map((p, i) => ({ ...p, raw: r1(p.raw), smooth: r1(s[i]) }))
}

/** Smoothed 1RM projected 4 and 8 weeks past the last session, with 80% bands. */
export function forecastLift(points: LiftPoint[]): LiftForecast {
  if (points.length < RULES.lift.minSessions || daysBetween(points[0].date, points[points.length - 1].date) < RULES.lift.minSpanDays) {
    return { enough: false, slope_kg_week: null, points: [] }
  }
  const first = points[0].date
  const last = points[points.length - 1]
  const minSpread = Math.max(RULES.lift.minSpreadKg, (last.smooth * RULES.lift.minSpreadPct) / 100)
  const fit = theilSen(points.map((p) => ({ x: daysBetween(first, p.date) / 7, y: p.smooth })), minSpread)
  if (!fit) return { enough: false, slope_kg_week: null, points: [] }
  const lastX = daysBetween(first, last.date) / 7
  // Start from where the smoothed line is now, not where the fitted line says it is.
  const offset = last.smooth - (fit.intercept + fit.slope * lastX)
  return {
    enough: true,
    slope_kg_week: Math.round(fit.slope * 100) / 100,
    points: [4, 8].filter((w) => w <= RULES.lift.horizonWeeks).map((w) => {
      const kg = fit.intercept + fit.slope * (lastX + w) + offset
      const half = bandAt(fit, lastX + w)
      return { week: addDays(last.date, w * 7), kg: r1(kg), lo: r1(kg - half), hi: r1(kg + half) }
    }),
  }
}

// ---------- Plateaus ----------
// Weight signals for one client, from daily weigh-ins: the same numbers on the
// client's Progress page, the coach's client view and the Clients list.

export function weightSignals(days: { date: string; kg: number | null }[], today: string, startDate: string, goalKg: number | null) {
  const weekly = weeklyWeights(days, today, startDate)
  return { weekly, forecast: forecastWeight(weekly, goalKg), plateau: weightPlateau(weekly, goalKg) }
}


export interface Plateau { since: string; weeks: number }

/**
 * Weight held within a small band for 3+ weeks (counting back from the latest
 * week with weigh-ins) while still 1+ kg from the goal. Null without a goal.
 */
export function weightPlateau(weekly: { week: string; kg: number | null }[], goalKg: number | null): Plateau | null {
  const pts = weekly.filter((w): w is { week: string; kg: number } => w.kg != null)
  if (goalKg == null || pts.length < RULES.plateau.weightMinWeeks) return null
  const latest = pts[pts.length - 1]
  if (Math.abs(latest.kg - goalKg) < RULES.plateau.minGoalGapKg) return null
  let lo = latest.kg
  let hi = latest.kg
  let start = pts.length - 1
  for (let i = pts.length - 2; i >= 0; i--) {
    const nlo = Math.min(lo, pts[i].kg)
    const nhi = Math.max(hi, pts[i].kg)
    if (nhi - nlo > RULES.plateau.weightBandKg) break
    lo = nlo
    hi = nhi
    start = i
  }
  const weeks = Math.round(daysBetween(pts[start].week, latest.week) / 7) + 1
  return weeks >= RULES.plateau.weightMinWeeks ? { since: pts[start].week, weeks } : null
}

/** Smoothed 1RM up less than 1% (or down) over the last 21+ days of sessions. */
export function liftPlateau(points: LiftPoint[]): Plateau | null {
  if (points.length < 3) return null
  const latest = points[points.length - 1]
  let since: LiftPoint | null = null
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i]
    // Every session since p stayed within 1% of p's level.
    const flat = points.slice(i + 1).every((q) => q.smooth <= p.smooth * (1 + RULES.plateau.liftMaxGainPct / 100))
    if (!flat) break
    since = p
  }
  if (!since) return null
  const days = daysBetween(since.date, latest.date)
  return days >= RULES.plateau.liftMinDays ? { since: since.date, weeks: Math.round(days / 7) } : null
}
