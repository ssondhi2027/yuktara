// Plain-language signals from a client's own Progress data, for the client and
// their coach: the goal date, plateaus, and up to three insights. Rules are data
// (INSIGHT_RULES): each has its thresholds next to it and returns an insight or
// null. Insights say what tends to go together, never what caused what, and
// their wording works for the client and for the coach. Pure functions with
// type-only imports; unit-tested in tests/insights.test.ts.

import type { UnitSystem } from '../types/db'
import type { GoalNote, Plateau, WeightForecast } from './forecast.ts'
import { RULES } from './forecast.ts'
import type { ProgressDetail } from './progress.ts'
import { bodyWeight, toUnit, unitLabel } from './units.ts'

export interface Insight {
  id: string
  text: string
  /** good news, or something worth a look */
  tone: 'good' | 'note'
  /** how clear the signal is; higher shows first */
  score: number
}

/** Thresholds for the insight rules. */
export const INSIGHT_LIMITS = {
  streakWeeks: 3,
  protein: { maxPctOfTarget: 90, minDays: 7 },
  /** weekly comparisons (sleep and lifts, steps and weight) */
  compare: { minWeeksEach: 3, minDaysLogged: 4, minEffect: 0.8 },
  sleep: { hours: 7, minGapPct: 1 },
  steps: { minGapKg: 0.2 },
  calories: { withinPct: 10, minDays: 14, goodShare: 0.7, lowShare: 0.4 },
  max: 3,
} as const

/** A week's averages, built from the daily series. */
export interface Week {
  week: string
  kg: number | null
  sleep: number | null
  sleepDays: number
  steps: number | null
  stepsDays: number
  stepsTarget: number | null
  /** average % change of the lifts' smoothed 1RM from before the week to its last session */
  liftGainPct: number | null
}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
const sd = (xs: number[]) => {
  const m = avg(xs)!
  return xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) : 0
}
/** Difference of the means in pooled standard deviations (Cohen's d); Infinity when both groups are perfectly steady. */
export function effectSize(a: number[], b: number[]): number {
  const pooled = Math.sqrt(((a.length - 1) * sd(a) ** 2 + (b.length - 1) * sd(b) ** 2) / Math.max(1, a.length + b.length - 2))
  const diff = Math.abs(avg(a)! - avg(b)!)
  return pooled ? diff / pooled : diff ? Infinity : 0
}

const plusDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00`)
  t.setDate(t.getDate() + n)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}
const inWeek = (date: string, week: string) => date >= week && date <= plusDays(week, 6)
const pct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x * 10) / 10)}%`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Dec 3", or "Jan 5, 2027" when the year differs from `ref`'s. */
export const monthDayOf = (iso: string, ref?: string) =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}${ref && ref.slice(0, 4) !== iso.slice(0, 4) ? `, ${iso.slice(0, 4)}` : ''}`

export function weeksOf(d: ProgressDetail): Week[] {
  return d.weeks.map((week, i) => {
    const days = d.habits.filter((h) => inWeek(h.date, week))
    const sleeps = days.map((h) => h.sleep_h).filter((x): x is number => x != null)
    const steps = days.map((h) => h.steps).filter((x): x is number => x != null)
    const gains = d.strength.map((l) => {
      const before = [...l.points].reverse().find((p) => p.date < week)
      const now = [...l.points].reverse().find((p) => inWeek(p.date, week))
      return before && now ? ((now.smooth - before.smooth) / before.smooth) * 100 : null
    })
    return {
      week,
      kg: d.weight.weekly[i]?.kg ?? null,
      sleep: avg(sleeps),
      sleepDays: sleeps.length,
      steps: avg(steps),
      stepsDays: steps.length,
      stepsTarget: avg(days.map((h) => h.steps_target)),
      liftGainPct: avg(gains),
    }
  })
}

export interface InsightRule {
  id: string
  /** what it looks for, with the thresholds */
  about: string
  run: (d: ProgressDetail, weeks: Week[], units: UnitSystem) => Insight | null
}

const L = INSIGHT_LIMITS

export const INSIGHT_RULES: InsightRule[] = [
  {
    id: 'plan_streak',
    about: `Training plan hit ${L.streakWeeks}+ weeks in a row.`,
    run: (d) => {
      const n = d.kpis.workouts.streak
      return n >= L.streakWeeks ? { id: 'plan_streak', tone: 'good', score: 40 + n, text: `Training plan hit ${n} weeks in a row.` } : null
    },
  },
  {
    id: 'protein_in_plateau',
    about: `Weight plateau while protein averaged under ${L.protein.maxPctOfTarget}% of target, with ${L.protein.minDays}+ logged days since the plateau began.`,
    run: (d) => {
      const p = d.weight.plateau
      if (!p) return null
      const days = d.nutrition.daily.filter((x) => x.date >= p.since && x.protein_g != null && x.protein_target)
      if (days.length < L.protein.minDays) return null
      const share = (days.reduce((a, x) => a + x.protein_g!, 0) / days.reduce((a, x) => a + x.protein_target!, 0)) * 100
      if (share >= L.protein.maxPctOfTarget) return null
      return {
        id: 'protein_in_plateau', tone: 'note', score: 60 + (L.protein.maxPctOfTarget - share),
        text: `Protein averaged ${Math.round(share)}% of target over the ${p.weeks} weeks weight held steady.`,
      }
    },
  },
  {
    id: 'sleep_and_lifts',
    about: `Lift progress in weeks averaging ${L.sleep.hours}+ h of sleep vs fewer: ${L.compare.minWeeksEach}+ weeks in each group (${L.compare.minDaysLogged}+ nights logged), a gap of ${L.sleep.minGapPct}+ percentage point and an effect size of ${L.compare.minEffect}+.`,
    run: (_d, weeks) => {
      const usable = weeks.filter((w) => w.sleep != null && w.sleepDays >= L.compare.minDaysLogged && w.liftGainPct != null)
      const good = usable.filter((w) => w.sleep! >= L.sleep.hours).map((w) => w.liftGainPct!)
      const short = usable.filter((w) => w.sleep! < L.sleep.hours).map((w) => w.liftGainPct!)
      if (good.length < L.compare.minWeeksEach || short.length < L.compare.minWeeksEach) return null
      const a = avg(good)!
      const b = avg(short)!
      if (a - b < L.sleep.minGapPct || effectSize(good, short) < L.compare.minEffect) return null
      return {
        id: 'sleep_and_lifts', tone: 'good', score: 30 + (a - b) * 5,
        text: `Lifts tended to go up more in weeks with ${L.sleep.hours}+ hours of sleep (${pct(a)} vs ${pct(b)} a week).`,
      }
    },
  },
  {
    id: 'steps_and_weight',
    about: `Weekly weight change in weeks at or above the step target vs below, while losing toward a goal: ${L.compare.minWeeksEach}+ weeks in each group (${L.compare.minDaysLogged}+ days logged), a gap of ${L.steps.minGapKg}+ kg a week and an effect size of ${L.compare.minEffect}+.`,
    run: (d, weeks, units) => {
      const goal = d.weight.goal_kg
      const now = d.kpis.weight.value
      if (goal == null || now == null || now <= goal) return null
      const rows = weeks.map((w, i) => ({ w, change: i > 0 && w.kg != null && weeks[i - 1].kg != null ? w.kg - weeks[i - 1].kg! : null }))
      const usable = rows.filter((r) => r.change != null && r.w.steps != null && r.w.stepsDays >= L.compare.minDaysLogged && r.w.stepsTarget)
      const hit = usable.filter((r) => r.w.steps! >= r.w.stepsTarget!).map((r) => r.change!)
      const miss = usable.filter((r) => r.w.steps! < r.w.stepsTarget!).map((r) => r.change!)
      if (hit.length < L.compare.minWeeksEach || miss.length < L.compare.minWeeksEach) return null
      const a = avg(hit)!
      const b = avg(miss)!
      if (b - a < L.steps.minGapKg || effectSize(hit, miss) < L.compare.minEffect) return null
      const fmt = (kg: number) => `${kg < 0 ? '−' : '+'}${Math.abs(Math.round(toUnit(kg, units) * 10) / 10)} ${unitLabel(units)}`
      return {
        id: 'steps_and_weight', tone: 'good', score: 30 + (b - a) * 40,
        text: `Weight tended to come down faster in weeks the step target was reached (${fmt(a)} vs ${fmt(b)} a week).`,
      }
    },
  },
  {
    id: 'calories_on_target',
    about: `Days within ${L.calories.withinPct}% of the calorie target, out of ${L.calories.minDays}+ logged days with a target: ${L.calories.goodShare * 100}%+ is good news, ${L.calories.lowShare * 100}% or less is worth a look.`,
    run: (d) => {
      const days = d.nutrition.daily.filter((x) => x.calories != null && x.calories_target)
      if (days.length < L.calories.minDays) return null
      const within = days.filter((x) => Math.abs(x.calories! - x.calories_target!) <= (x.calories_target! * L.calories.withinPct) / 100).length
      const share = within / days.length
      const text = `Within ${L.calories.withinPct}% of the calorie target on ${within} of ${days.length} logged days.`
      if (share >= L.calories.goodShare) return { id: 'calories_on_target', tone: 'good', score: 20 + share * 20, text }
      if (share <= L.calories.lowShare) return { id: 'calories_on_target', tone: 'note', score: 35 + (1 - share) * 20, text }
      return null
    },
  },
]

/** The strongest insights (at most three), in the given units. */
export function insightsFor(d: ProgressDetail, units: UnitSystem, max: number = L.max): Insight[] {
  const weeks = weeksOf(d)
  return INSIGHT_RULES
    .map((r) => r.run(d, weeks, units))
    .filter((x): x is Insight => x != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
}

// ---------- Goal date, next weeks and plateaus as text ----------

/** Who's reading: the client ("you") or their coach (neutral wording). */
export type Voice = 'client' | 'coach'

const NOT_ENOUGH_WEIGHT = `Not enough data yet for a weight forecast: it needs weigh-ins in ${RULES.weight.minWeeks} different weeks.`

/** The goal-date sentence, or why there isn't one. Null without a goal. */
export function goalText(f: WeightForecast, goalKg: number | null, units: UnitSystem, voice: Voice, today?: string): string | null {
  if (goalKg == null) return null
  if (!f.enough) return NOT_ENOUGH_WEIGHT
  const goal = bodyWeight(goalKg, units)
  if (f.goal) {
    const range = f.goal.late
      ? `likely ${monthDayOf(f.goal.early, today)} – ${monthDayOf(f.goal.late, today)}`
      : `likely from ${monthDayOf(f.goal.early, today)}, maybe later`
    const when = `around ${monthDayOf(f.goal.date, today)} (${range})`
    return voice === 'client' ? `At this pace you reach ${goal} ${when}.` : `At this pace: ${goal} ${when}.`
  }
  const notes: Record<GoalNote, string> = {
    reached: voice === 'client' ? `You're at your goal of ${goal}.` : `At the goal of ${goal}.`,
    away: `The trend is heading away from ${goal} for now, so there's no goal date yet.`,
    flat: `The trend is about flat, so there's no goal date yet.`,
    far: `At this pace ${goal} is more than a year away.`,
    no_goal: '',
  }
  return f.goal_note ? notes[f.goal_note] || null : null
}

/** "Around 70.1 kg by Nov 9 (likely 69.4–70.8)": the forecast four weeks out. */
export function nextText(f: WeightForecast, units: UnitSystem, today?: string): string | null {
  const p = f.points[3] ?? f.points[f.points.length - 1]
  if (!f.enough || !p) return null
  const u = unitLabel(units)
  const v = (kg: number) => Math.round(toUnit(kg, units) * 10) / 10
  return `Around ${bodyWeight(p.kg, units)} by ${monthDayOf(p.week, today)} (likely ${v(p.lo)}–${v(p.hi)} ${u}).`
}

export const plateauText = (what: string, p: Plateau, today?: string) =>
  `${what} steady for ${p.weeks} week${p.weeks === 1 ? '' : 's'}, since ${monthDayOf(p.since, today)}.`

/** Everything the Insights card shows, in one place for the client and the coach. */
export interface Signals {
  goal: string | null
  next: string | null
  plateaus: string[]
  /** lifts with too few sessions for a forecast */
  thin_lifts: string[]
  insights: Insight[]
}

export function signalsFor(d: ProgressDetail, units: UnitSystem, voice: Voice, ref: string | undefined = d.weeks[d.weeks.length - 1]): Signals {
  const w = d.weight
  const today = ref
  return {
    goal: goalText(w.forecast, w.goal_kg, units, voice, today) ?? (w.forecast.enough ? null : NOT_ENOUGH_WEIGHT),
    next: nextText(w.forecast, units, today),
    plateaus: [
      ...(w.plateau ? [plateauText('Weight', w.plateau, today)] : []),
      ...d.strength.filter((l) => l.plateau).map((l) => plateauText(l.name, l.plateau!, today)),
    ],
    thin_lifts: d.strength.filter((l) => !l.forecast.enough).map((l) => l.name),
    insights: insightsFor(d, units),
  }
}

/** Short flags for a Clients list row: weight plateau, trend away from goal, goal date. */
export function rowFlags(s: { forecast: WeightForecast; plateau: Plateau | null }, today?: string): { text: string; tone: 'note' | 'good' }[] {
  const out: { text: string; tone: 'note' | 'good' }[] = []
  if (s.plateau) out.push({ text: `Weight steady ${s.plateau.weeks} wk`, tone: 'note' })
  if (s.forecast.goal_note === 'away') out.push({ text: 'Trend away from goal', tone: 'note' })
  if (s.forecast.goal) out.push({ text: `Goal ~${monthDayOf(s.forecast.goal.date, today)}`, tone: 'good' })
  return out
}
