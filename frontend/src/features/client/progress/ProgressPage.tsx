import { createContext, useContext, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react'
import { api, type Period, type ProgressDetail } from '@/lib/api'
import { monthDay, weekday } from '@/lib/dates'
import { MUSCLE_LABEL } from '@/lib/muscles'
import { liftSummary, liftValues, MAX_CHART_LIFTS, pctOf, pickLifts, plusDays, toggleLift, trend, type Kpi, type LiftMeasure } from '@/lib/progress'
import { monthDayOf } from '@/lib/insights'
import { bodyValue, bodyWeight, cmToIn, delta, int, litres, loadValue, toUnit, unitLabel, weightChange } from '@/lib/units'
import type { UnitSystem } from '@/types/db'
import { useLayout } from '@/app/hooks'
import { useUnits } from '@/app/auth'
import { LineChart } from '@/components/charts/LineChart'
import { BarChart, Legend, MultiLineChart, type Series } from '@/components/charts/ChartKit'
import { SignalsCard } from '@/components/progress/SignalsCard'
import { Segmented } from '@/components/ui/Segmented'
import { PageError, PageLoading } from '@/components/ui/Loading'
import './progress.css'
import { Avatar } from '@/components/ui/Avatar'
import { RecordList } from '@/components/records/Records'
import { distanceText, minutesText } from '@/lib/cardio'
import { recordTitle, visibleRecords } from '@/lib/records'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'p4', label: '4 weeks' },
  { value: 'p12', label: '12 weeks' },
  { value: 'all', label: 'Since start' },
]

type Section = 'weight' | 'training' | 'nutrition' | 'habits' | 'checkins'
const SECTIONS: { value: Section; label: string }[] = [
  { value: 'weight', label: 'Weight' },
  { value: 'training', label: 'Training' },
  { value: 'nutrition', label: 'Food' },
  { value: 'habits', label: 'Habits' },
  { value: 'checkins', label: 'Check-ins' },
]

const PERIOD_KEY = 'yuktara.progressPeriod'
const savedPeriod = (): Period => {
  try {
    const v = localStorage.getItem(PERIOD_KEY)
    return v === 'p4' || v === 'all' ? v : 'p12'
  } catch {
    return 'p12'
  }
}

const day = (iso: string) => `${weekday(iso)} ${monthDay(iso)}`
const wk = (iso: string) => monthDay(iso)

/**
 * Client Progress: KPIs for the chosen period, then charts.
 *  phone   — KPIs two across; one chart group at a time (Weight / Training / Food / Habits / Check-ins),
 *            the Insights card at the top of Weight
 *  tablet  — KPIs three across; charts in two columns, Insights next to the weight chart
 *  desktop — KPIs in one row; a dashboard grid with the weight chart large and Insights beside it
 */
export function ProgressPage() {
  const layout = useLayout()
  const units = useUnits()
  const [period, setPeriodState] = useState<Period>(savedPeriod)
  const setPeriod = (p: Period) => {
    setPeriodState(p)
    try { localStorage.setItem(PERIOD_KEY, p) } catch { /* per-device convenience only */ }
  }
  const head = useQuery({ queryKey: ['progress'], queryFn: api.progress })
  const detail = useQuery({ queryKey: ['progress-detail', period], queryFn: () => api.progressDetail(period), placeholderData: keepPreviousData })

  if (head.isPending || detail.isPending) return <PageLoading />
  if (head.error) return <PageError error={head.error} />
  if (detail.error) return <PageError error={detail.error} />
  const p = head.data
  const d = detail.data

  return (
    <div className={`page progress ${layout}`}>
      <header className="page-head progress-head">
        <div>
          <div className="page-date">Since {monthDay(p.start_date)} · week {p.week}{p.weeks ? ` of ${p.weeks}` : ''}</div>
          <h1>Progress</h1>
        </div>
        <div className="period-pick">
          {detail.isPlaceholderData && <span className="xs muted" role="status">Updating…</span>}
          <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />
        </div>
      </header>

      <ProgressDashboard d={d} units={units} layout={layout} updating={detail.isPlaceholderData} />

      {p.coach_note && (
        <section className="card dark coach-note-p">
          <div className="row">
            <Avatar person={p.coach_note.coach} tone="gold" />
            <div className="grow">
              <b>{p.coach_note.coach.first_name}, your coach</b>
              <div className="small muted">{p.coach_note.title} · {p.coach_note.date}</div>
            </div>
            <Link to="/messages" className="btn btn-outline btn-square">Reply</Link>
          </div>
          <p style={{ fontSize: 17, lineHeight: 1.45 }}>{p.coach_note.body}</p>
        </section>
      )}
    </div>
  )
}

// ---------- The dashboard (client Progress page, coach's check-in review) ----------

/** Who's reading: the client ("your coach assigns…") or their coach ("the coach assigns…"). */
const VoiceContext = createContext<'client' | 'coach'>('client')
export const ProgressVoice = VoiceContext.Provider
const useVoice = () => useContext(VoiceContext)

/**
 * KPIs and chart cards for one client's ProgressDetail.
 *  phone   — KPIs two across; one chart group at a time, Insights at the top of Weight
 *  tablet  — KPIs three across; charts in two columns, Insights next to the weight chart
 *  desktop — KPIs in one row; the weight chart large and Insights beside it
 */
export function ProgressDashboard({ d, units, layout, voice = 'client', updating = false }: {
  d: ProgressDetail; units: UnitSystem; layout: 'phone' | 'tablet' | 'desktop'; voice?: 'client' | 'coach'
  /** another period is loading: the numbers shown are the previous period's */
  updating?: boolean
}) {
  const [section, setSection] = useState<Section>('weight')
  const phone = layout === 'phone'
  // Phones: a KPI opens its chart group.
  const open = (s: Section) => {
    setSection(s)
    const charts = document.getElementById('progress-charts')
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    charts?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
  }
  const cards: Record<Section, React.ReactNode[]> = {
    weight: phone
      ? [<SignalsCard key="s" d={d} units={units} voice={voice} />, <WeightCard key="w" d={d} units={units} big={false} />]
      : [<WeightCard key="w" d={d} units={units} big={layout === 'desktop'} />, <SignalsCard key="s" d={d} units={units} voice={voice} />],
    training: [
      <WorkoutsCard key="t1" d={d} />,
      <VolumeCard key="t2" d={d} units={units} />,
      <MusclesCard key="t3" d={d} />,
      <StrengthCard key="t4" d={d} units={units} />,
      <RecordsCard key="t5" d={d} units={units} />,
      <CardioCard key="t6" d={d} units={units} />,
    ],
    nutrition: [<CaloriesCard key="n1" d={d} />, <ProteinCard key="n2" d={d} />, <OnPlanCard key="n3" d={d} />],
    habits: [<StepsCard key="h1" d={d} />, <WaterCard key="h2" d={d} />, <SleepCard key="h3" d={d} />],
    checkins: [<MeasureCard key="c1" d={d} />, <ScoresCard key="c2" d={d} />],
  }
  return (
    <VoiceContext.Provider value={voice}>
      <LiftFilterProvider>
        <div className={`progress-dash${updating ? ' updating' : ''}`} aria-busy={updating}>
          <Kpis d={d} units={units} onOpen={phone ? open : undefined} />
          {phone ? (
            <>
              <div className="section-tabs" id="progress-charts">
                <Segmented label="Charts" block value={section} onChange={setSection} options={SECTIONS} />
              </div>
              <div className="chart-stack">{cards[section]}</div>
            </>
          ) : (
            <div className="chart-grid" id="progress-charts">
              {cards.weight}
              {cards.training}
              {cards.nutrition}
              {cards.habits}
              {cards.checkins}
            </div>
          )}
        </div>
      </LiftFilterProvider>
    </VoiceContext.Provider>
  )
}

// ---------- Strength filters ----------
// Which lifts the strength chart shows, and as what. The records card follows
// the same lifts. Shared by the cards inside a LiftFilterProvider (the
// dashboard, the coach's Training tab); a card on its own keeps its own.

interface LiftFilterValue { chosen: string[] | null; measure: LiftMeasure; forecast: boolean }
type LiftFilterState = LiftFilterValue & { set: (p: Partial<LiftFilterValue>) => void }
const LiftFilterContext = createContext<LiftFilterState | null>(null)

function useLiftFilterState(initial?: Partial<LiftFilterValue>): LiftFilterState {
  const [v, setV] = useState<LiftFilterValue>(() => ({ chosen: null, measure: 'e1rm', forecast: true, ...initial }))
  return useMemo(() => ({ ...v, set: (p: Partial<LiftFilterValue>) => setV((x) => ({ ...x, ...p })) }), [v])
}

/** `initial`: where the filters start (the default is the main lifts as estimated 1RM, with the estimate ahead). */
export function LiftFilterProvider({ initial, children }: { initial?: Partial<LiftFilterValue>; children: React.ReactNode }) {
  return <LiftFilterContext.Provider value={useLiftFilterState(initial)}>{children}</LiftFilterContext.Provider>
}

/** The lifts to chart (chosen ones still in the period, else the main lifts) and how to show them. */
function useLiftFilter(d: ProgressDetail) {
  const shared = useContext(LiftFilterContext)
  const local = useLiftFilterState()
  const f = shared ?? local
  const ids = pickLifts(d.lifts, f.chosen, d.strength.map((l) => l.exercise_id))
  return { ...f, ids, toggle: (id: string) => f.set({ chosen: toggleLift(ids, id) }) }
}

// ---------- KPIs ----------

function Arrow({ k, flat = 0, label }: { k: Kpi; flat?: number; label: string }) {
  const t = trend(k, flat)
  if (!t) return null
  const Icon = t === 'up' ? ArrowUp : t === 'down' ? ArrowDown : ArrowRight
  return (
    <span className={`kpi-trend ${t}`} title={`${t === 'flat' ? 'About the same as' : t === 'up' ? 'Up from' : 'Down from'} the previous period (${label})`}>
      <Icon size={14} aria-hidden /><span className="sr-only">{t === 'flat' ? 'about the same as' : t === 'up' ? 'up from' : 'down from'} {label} the previous period</span>
    </span>
  )
}

function KpiCard({ title, value, k, prevLabel, flat, line, note, onOpen }: {
  title: string; value: string | null; k: Kpi; prevLabel: string; flat?: number; line: string; note?: string | null
  /** phones: opens this KPI's charts */
  onOpen?: () => void
}) {
  const body = (
    <>
      <div className="kpi-title xs muted">{title}</div>
      <div className="kpi-value">
        <b className="num">{value ?? '—'}</b>
        {value != null && <Arrow k={k} flat={flat} label={prevLabel} />}
      </div>
      <div className="kpi-line xs">{line}</div>
      {note && <div className="kpi-note xs">{note}</div>}
    </>
  )
  return onOpen
    ? <button type="button" className="card kpi kpi-btn" onClick={onOpen} aria-label={`${title}: ${value ?? 'no data'}. Show the charts`}>{body}</button>
    : <div className="card kpi">{body}</div>
}

function Kpis({ d, units, onOpen }: { d: ProgressDetail; units: UnitSystem; onOpen?: (s: Section) => void }) {
  const k = d.kpis
  const u = unitLabel(units)
  const w = k.weight
  const go = (s: Section) => (onOpen ? () => onOpen(s) : undefined)
  const steady = d.strength.filter((l) => l.plateau)
  const records = visibleRecords(d.records, units).filter((r) => r.kind !== 'milestone').length
  const cardioS = d.training.weekly.reduce((a, x) => a + x.cardio_s, 0)
  const of = (v: number | null | undefined, t: number | null | undefined) => (v != null && t ? `${pctOf(v, t)}% of ` : '')
  return (
    <div className="kpis">
      <KpiCard title="Weight (weekly average)" onOpen={go('weight')} k={w} flat={0.2} prevLabel={w.previous != null ? bodyWeight(w.previous, units) : ''}
        note={d.weight.plateau ? `Steady for ${d.weight.plateau.weeks} weeks, since ${monthDay(d.weight.plateau.since)}` : null}
        value={w.value != null ? bodyWeight(w.value, units) : null}
        line={w.value == null ? 'No weigh-ins in this period yet.'
          : [w.change != null ? `${weightChange(w.change, units)} this period` : 'One week of weigh-ins so far', w.to_goal != null ? `${Math.abs(bodyValue(w.to_goal, units))} ${u} ${w.to_goal > 0 ? 'to go' : 'past'} goal` : null].filter(Boolean).join(' · ')} />
      <KpiCard title="Workouts done" onOpen={go('training')} k={k.workouts} flat={2} prevLabel={`${k.workouts.previous}%`}
        value={k.workouts.value != null ? `${k.workouts.value}%` : null}
        line={k.workouts.planned ? `${k.workouts.done} of ${k.workouts.planned} planned · ${k.workouts.streak ? `${k.workouts.streak}-week streak` : 'no streak yet'}` : 'No planned workouts in this period.'}
        note={[
          cardioS ? `${minutesText(cardioS)} cardio` : null,
          records ? `${records} personal record${records === 1 ? '' : 's'}` : null,
          steady.length ? `${steady.map((l) => l.name).join(', ')} steady for ${Math.max(...steady.map((l) => l.plateau!.weeks))}+ weeks` : null,
        ].filter(Boolean).join(' · ') || null} />
      <KpiCard title="Calories (daily average)" onOpen={go('nutrition')} k={k.calories} flat={25} prevLabel={`${int(k.calories.previous ?? 0)} kcal`}
        value={k.calories.value != null ? `${int(k.calories.value)} kcal` : null}
        line={k.calories.value == null ? 'No meals logged in this period.'
          : `${of(k.calories.value, k.calories.target)}${k.calories.target ? `${int(k.calories.target)} target` : 'no target yet'}${k.meals_on_plan.value != null ? ` · ${k.meals_on_plan.value}% meals on plan` : ''}`} />
      <KpiCard title="Protein (daily average)" onOpen={go('nutrition')} k={k.protein} flat={3} prevLabel={`${k.protein.previous} g`}
        value={k.protein.value != null ? `${k.protein.value} g` : null}
        line={k.protein.value == null ? 'No meals logged in this period.' : k.protein.target ? `${of(k.protein.value, k.protein.target)}${k.protein.target} g target` : 'No target yet'} />
      <KpiCard title="Steps (daily average)" onOpen={go('habits')} k={k.steps} flat={150} prevLabel={int(k.steps.previous ?? 0)}
        value={k.steps.value != null ? int(k.steps.value) : null}
        line={k.steps.value == null ? 'No steps logged in this period.' : k.steps.target ? `${of(k.steps.value, k.steps.target)}${int(k.steps.target)} target` : 'No target yet'} />
      <KpiCard title="Sleep and water" onOpen={go('habits')} k={k.sleep} flat={0.15} prevLabel={`${k.sleep.previous} h`}
        value={k.sleep.value != null ? `${k.sleep.value} h` : k.water.value != null ? litres(k.water.value) : null}
        line={k.sleep.value == null && k.water.value == null ? 'No sleep or water logged yet.'
          : [k.sleep.value != null && k.sleep.target ? `${of(k.sleep.value, k.sleep.target)}${k.sleep.target} h` : null,
            k.water.value != null ? `water ${litres(k.water.value)}${k.water.target ? ` of ${litres(k.water.target)}` : ''}` : null].filter(Boolean).join(' · ')} />
    </div>
  )
}

// ---------- Cards ----------

export function ChartCard({ title, sub, empty, className, controls, children }: {
  title: string; sub?: string; empty?: string | null; className?: string
  /** filters under the heading (shown even when the chart is empty) */
  controls?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <section className={`card chart-card${className ? ` ${className}` : ''}`}>
      <div className="card-head"><h3>{title}</h3>{sub && <span className="small muted">{sub}</span>}</div>
      {controls}
      {empty ? <p className="small muted chart-empty">{empty}</p> : children}
    </section>
  )
}

export function WeightCard({ d, units, big }: { d: ProgressDetail; units: UnitSystem; big: boolean }) {
  const voice = useVoice()
  const w = d.weight
  const f = w.forecast
  const u = unitLabel(units)
  const has = w.weekly.some((x) => x.kg != null)
  const weekIndex = (iso: string) => Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(`${d.weeks[0]}T00:00:00`).getTime()) / (7 * 86_400_000))
  // The forecast fans out from the latest weekly average shown: 4 weeks ahead on
  // the 4-week view, 8 otherwise.
  const realIdx = w.weekly.map((x, i) => (x.kg != null ? i : -1)).filter((i) => i >= 0)
  const lastIdx = realIdx[realIdx.length - 1]
  const ahead = f.enough && lastIdx != null ? f.points.slice(0, d.period === 'p4' ? 4 : 8).filter((p) => weekIndex(p.week) > lastIdx) : []
  const futureCount = ahead.length ? Math.max(0, weekIndex(ahead[ahead.length - 1].week) - (d.weeks.length - 1)) : 0
  const future = Array.from({ length: futureCount }, (_, i) => plusDays(d.weeks[d.weeks.length - 1], 7 * (i + 1)))
  const points = [...w.weekly.map((x) => ({ label: wk(x.week), kg: x.kg == null ? null : bodyValue(x.kg, units) })), ...future.map((fw) => ({ label: wk(fw), kg: null }))]
  const band = ahead.length && lastIdx != null
    ? [{ at: lastIdx, value: points[lastIdx].kg!, lo: points[lastIdx].kg!, hi: points[lastIdx].kg! },
       ...ahead.map((p) => ({ at: weekIndex(p.week), value: bodyValue(p.kg, units), lo: bodyValue(p.lo, units), hi: bodyValue(p.hi, units) }))]
    : undefined
  const daily = w.daily.map((x) => {
    const at = (new Date(`${x.date}T00:00:00`).getTime() - new Date(`${d.weeks[0]}T00:00:00`).getTime()) / (7 * 86_400_000) - 0.5 + 1 / 14
    return { at: Math.max(0, at), kg: bodyValue(x.kg, units) }
  })
  const tips = points.map((x, i) => {
    if (x.kg != null) return `Week of ${x.label}: ${x.kg} ${u}`
    const p = ahead.find((a) => weekIndex(a.week) === i)
    return p ? `Estimate, week of ${wk(p.week)}: ${bodyWeight(p.kg, units)} (likely ${bodyValue(p.lo, units)}–${bodyValue(p.hi, units)} ${u})` : null
  })
  const next = ahead[Math.min(3, ahead.length - 1)]
  return (
    <ChartCard title="Weight" className={big ? 'span-2 tall' : undefined}
      sub={next ? `Estimate: around ${bodyWeight(next.kg, units)} by ${monthDay(next.week)}` : f.enough || !has ? 'Weekly averages' : 'Weekly averages · not enough data yet for a forecast'}
      empty={has ? null : voice === 'coach' ? 'No weigh-ins in this period yet.' : 'No weigh-ins in this period. Log your morning weight from Home; the trend shows up here.'}>
      <LineChart points={points} unit={u} height={big ? 280 : 200} area={false}
        goal={w.goal_kg != null ? bodyValue(w.goal_kg, units) : undefined}
        goalLabel={w.goal_kg != null ? `Goal ${bodyWeight(w.goal_kg, units)}` : undefined}
        band={band} daily={daily} tips={tips} />
      <Legend items={[
        { name: 'Weekly average', color: 'var(--chart)' },
        ...(w.goal_kg != null ? [{ name: 'Goal', color: 'var(--leaf)', dashed: true }] : []),
        ...(band ? [{ name: 'Estimate, shaded: likely range (80%)', color: 'var(--chart)', dashed: true }] : []),
        ...(daily.length ? [{ name: 'Daily weigh-ins (faint dots)', color: 'var(--ink-3)' }] : []),
      ]} />
    </ChartCard>
  )
}

export function WorkoutsCard({ d }: { d: ProgressDetail }) {
  const voice = useVoice()
  const t = d.training.weekly
  const any = t.some((x) => x.planned > 0 || x.done > 0)
  return (
    <ChartCard title="Workouts" sub="Done vs planned, per week" empty={any ? null : voice === 'coach' ? 'No planned workouts yet. Assign a program on the Programs page.' : 'No planned workouts yet. Your coach assigns your program.'}>
      <BarChart label="Workouts done and planned per week"
        items={t.map((x) => ({ label: wk(x.week), value: x.done, planned: x.planned, good: x.planned === 0 || x.done >= x.planned, tip: `Week of ${wk(x.week)}: ${x.done} of ${x.planned}` }))} />
      <Legend items={[{ name: 'Done', color: 'var(--chart)' }, { name: 'Planned', color: 'var(--line-strong)', dashed: true }]} />
    </ChartCard>
  )
}

export function VolumeCard({ d, units }: { d: ProgressDetail; units: UnitSystem }) {
  const t = d.training.weekly
  const u = unitLabel(units)
  return (
    <ChartCard title="Volume" sub={`Sets × reps × weight, ${u} per week`} empty={t.some((x) => x.volume_kg > 0) ? null : 'No weighted sets logged in this period.'}>
      <BarChart label={`Training volume per week in ${u}`}
        items={t.map((x) => ({ label: wk(x.week), value: Math.round(loadValue(x.volume_kg, units)), tip: `Week of ${wk(x.week)}: ${int(loadValue(x.volume_kg, units))} ${u} · ${x.sets} sets` }))} />
    </ChartCard>
  )
}

export function MusclesCard({ d }: { d: ProgressDetail }) {
  const top = d.training.muscles.slice(0, 8)
  const weeks = Math.max(1, d.weeks.length)
  const max = Math.max(1, ...top.map((m) => m.sets))
  return (
    <ChartCard title="Hard sets by muscle" sub="Per week, on average" empty={top.length ? null : 'No sets logged in this period.'}>
      <ul className="muscle-bars">
        {top.map((m) => (
          <li key={m.muscle}>
            <span className="small">{MUSCLE_LABEL[m.muscle]}</span>
            <span className="muscle-track"><i style={{ width: `${(m.sets / max) * 100}%` }} /></span>
            <b className="small num">{Math.round((m.sets / weeks) * 10) / 10}</b>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}

const LIFT_COLORS = ['var(--chart)', 'var(--gold)', 'var(--orange)', 'var(--leaf)']

const MEASURES: { value: LiftMeasure; label: string }[] = [
  { value: 'e1rm', label: 'Est. 1RM' },
  { value: 'top', label: 'Top set' },
  { value: 'volume', label: 'Volume' },
]
const MEASURE_SUB: Record<LiftMeasure, string> = {
  e1rm: "Estimated 1-rep max, smoothed; faint dots are each session's best set",
  top: 'Heaviest working set each session',
  volume: 'Sets × reps × weight for the lift, each session',
}

export function StrengthCard({ d, units }: { d: ProgressDetail; units: UnitSystem }) {
  const voice = useVoice()
  const f = useLiftFilter(d)
  const m = f.measure
  const lifts = f.ids.flatMap((id) => d.lifts.filter((l) => l.exercise_id === id))
  const colorOf = (id: string) => LIFT_COLORS[f.ids.indexOf(id)] ?? 'var(--ink-3)'
  const u = unitLabel(units)
  const lv = (kg: number) => loadValue(kg, units)
  // Values in the viewer's unit: loads to the plate step, volume to whole units.
  const show = (kg: number) => (m === 'volume' ? Math.round(toUnit(kg, units)) : lv(kg))
  const withForecast = m === 'e1rm' && f.forecast
  const ahead = d.period === 'p4' ? 4 : 8
  const lastDate = (id: string) => liftValues(lifts.find((l) => l.exercise_id === id)!, 'e1rm').at(-1)?.date
  // Session dates, then the forecast dates; spaced by real time.
  const future = withForecast
    ? [...new Set(lifts.flatMap((l) => {
      const last = lastDate(l.exercise_id)
      return l.forecast.enough && last ? l.forecast.points.filter((p) => (new Date(`${p.week}T00:00:00`).getTime() - new Date(`${last}T00:00:00`).getTime()) / (7 * 86_400_000) <= ahead).map((p) => p.week) : []
    }))]
    : []
  const dates = [...new Set([...lifts.flatMap((l) => liftValues(l, m).map((p) => p.date)), ...future])].sort()
  const day0 = dates.length ? new Date(`${dates[0]}T00:00:00`).getTime() : 0
  const positions = dates.map((x) => (new Date(`${x}T00:00:00`).getTime() - day0) / 86_400_000)
  const recordsAt = new Map<string, Map<string, string[]>>()
  const series: Series[] = lifts.flatMap((l) => {
    const color = colorOf(l.exercise_id)
    const vals = new Map(liftValues(l, m).map((p) => [p.date, p.value]))
    const out: Series[] = []
    if (m === 'e1rm') {
      const at = new Map(l.points.map((p) => [p.date, p]))
      out.push({ name: `${l.name} (sessions)`, color, faint: true, values: dates.map((dt) => (at.has(dt) ? lv(at.get(dt)!.raw) : null)) })
    }
    out.push({ name: l.name, color, values: dates.map((dt) => (vals.has(dt) ? show(vals.get(dt)!) : null)) })
    // A gold ring where a session set a record on this lift (on the faint dot for 1RM, on the line otherwise).
    const marked = new Map<string, string[]>()
    for (const r of d.records) {
      if (r.exercise_id === l.exercise_id && r.kind !== 'milestone' && vals.has(r.date)) marked.set(r.date, [...new Set([...(marked.get(r.date) ?? []), recordTitle(r)])])
    }
    if (marked.size) {
      const ringAt = (dt: string) => (m === 'e1rm' ? lv(l.points.find((p) => p.date === dt)!.raw) : show(vals.get(dt)!))
      out.push({ name: `${l.name} record`, color, marks: true, values: dates.map((dt) => (marked.has(dt) ? ringAt(dt) : null)) })
    }
    recordsAt.set(l.name, marked)
    const last = l.points.at(-1)
    if (withForecast && l.forecast.enough && last && future.length) {
      const fc = new Map(l.forecast.points.map((p) => [p.week, p]))
      const inView = (dt: string) => future.includes(dt) && fc.has(dt)
      out.push({
        name: `${l.name} estimate`, color, dashed: true,
        values: dates.map((dt) => (dt === last.date ? lv(last.smooth) : inView(dt) ? lv(fc.get(dt)!.kg) : null)),
        band: dates.map((dt) => (dt === last.date ? { lo: lv(last.smooth), hi: lv(last.smooth) } : inView(dt) ? { lo: lv(fc.get(dt)!.lo), hi: lv(fc.get(dt)!.hi) } : null)),
      })
    }
    return out
  })
  const notes = m !== 'e1rm' ? [] : lifts.map((l) => {
    const p = withForecast ? l.forecast.points.filter((x) => future.includes(x.week)).pop() : undefined
    const fcText = !withForecast ? null
      : l.forecast.enough && p ? `about ${lv(p.kg)} ${u} by ${monthDayOf(p.week, d.weeks[d.weeks.length - 1])} (likely ${lv(p.lo)}–${lv(p.hi)}), an estimate`
        : 'not enough data yet for a forecast (5+ sessions over 3+ weeks)'
    const text = [fcText, l.plateau ? `steady for ${l.plateau.weeks} weeks` : null].filter(Boolean).join('; ')
    return text ? `${l.name}: ${text}.` : null
  }).filter((x): x is string => !!x)
  const noLifts = d.lifts.length === 0
  const controls = noLifts ? null : (
    <div className="lift-filters">
      <div className="lift-filter-row">
        <Segmented label="Show" variant="light" value={m} onChange={(v) => f.set({ measure: v })} options={MEASURES} />
        {m === 'e1rm' && (
          <button type="button" className="chip-btn small-chip" aria-pressed={f.forecast} onClick={() => f.set({ forecast: !f.forecast })}>Estimate ahead</button>
        )}
      </div>
      <div className="lift-chips" role="group" aria-label={`Lifts to show, up to ${MAX_CHART_LIFTS}`}>
        {d.lifts.map((l) => {
          const on = f.ids.includes(l.exercise_id)
          const full = !on && f.ids.length >= MAX_CHART_LIFTS
          return (
            <button key={l.exercise_id} type="button" className="chip-btn lift-chip" aria-pressed={on} disabled={full}
              title={full ? `Up to ${MAX_CHART_LIFTS} lifts at once` : on && f.ids.length === 1 ? 'At least one lift' : undefined}
              onClick={() => f.toggle(l.exercise_id)}>
              {on && <i className="lift-dot" style={{ background: colorOf(l.exercise_id) }} aria-hidden="true" />}
              {l.name}<span className="count">{l.sessions}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
  const what = m === 'e1rm' ? 'Estimated one-rep max' : m === 'top' ? 'Heaviest working set' : 'Volume'
  return (
    <ChartCard title="Strength" sub={MEASURE_SUB[m]} className="span-2 strength-card" controls={controls}
      empty={noLifts ? (voice === 'coach' ? 'Lifts show up here after a few logged workouts with weights.' : 'Log a few workouts with weights and your lifts show up here.')
        : !dates.length ? (m === 'e1rm' ? 'No 1RM estimate for these lifts in this period (sets of up to 10 reps, or 12 with RPE). Try Top set.' : 'Nothing logged for these lifts in this period.')
          : null}>
      <MultiLineChart labels={dates.map((x) => monthDay(x))} positions={positions} series={series} connectGaps label={`${what} over time for ${lifts.map((l) => l.name).join(', ')}`}
        format={(v, s, i) => {
          if (s.faint) return null
          if (s.marks) {
            const name = s.name.replace(/ record$/, '')
            const kinds = recordsAt.get(name)?.get(dates[i])
            return kinds ? `${name}: ${kinds.join(', ')}` : null
          }
          const l = lifts.find((x) => s.name === x.name || s.name === `${x.name} estimate`)
          if (!l) return null
          if (s.name.endsWith(' estimate')) {
            const p = l.forecast.points.find((x) => x.week === dates[i])
            return p ? `${l.name} estimate: ${v} ${u} (likely ${lv(p.lo)}–${lv(p.hi)})` : null
          }
          if (m === 'e1rm') {
            const p = l.points.find((x) => x.date === dates[i])
            return p ? `${l.name}: ${v} ${u} · best set ${lv(p.kg)} ${u} × ${p.reps}${p.rpe != null ? ` @ RPE ${p.rpe}` : ''} → ${lv(p.raw)}` : null
          }
          const x = l.days.find((y) => y.date === dates[i])
          if (!x) return null
          return m === 'top' ? `${l.name}: ${v} ${u} × ${x.top_reps}` : `${l.name}: ${int(v)} ${u} · ${x.sets} set${x.sets === 1 ? '' : 's'}`
        }} />
      <Legend items={[
        ...lifts.map((l) => ({ name: l.name, color: colorOf(l.exercise_id) })),
        ...(series.some((s) => s.band) ? [{ name: 'Estimate, shaded: likely range (80%)', color: 'var(--ink-3)', dashed: true }] : []),
        ...(series.some((s) => s.marks) ? [{ name: 'Ring: a personal record', color: 'var(--gold)' }] : []),
      ]} />
      <LiftTable lifts={lifts} measure={m} units={units} colorOf={colorOf} />
      {notes.length > 0 && <ul className="lift-notes xs muted">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </ChartCard>
  )
}

/** Per chosen lift, in the period: where it started, where it is now, the change and the best. */
function LiftTable({ lifts, measure, units, colorOf }: { lifts: ProgressDetail['lifts']; measure: LiftMeasure; units: UnitSystem; colorOf: (id: string) => string }) {
  const u = unitLabel(units)
  const rows = lifts.map((l) => ({ l, s: liftSummary(l, measure) })).filter((x) => x.s)
  if (!rows.length) return null
  const val = (kg: number) => (measure === 'volume' ? `${int(toUnit(kg, units))} ${u}` : `${loadValue(kg, units)} ${u}`)
  const change = (kg: number, sessions: number) => {
    if (sessions < 2) return 'first session'
    const v = measure === 'volume' ? Math.round(toUnit(kg, units)) : loadValue(kg, units)
    return v === 0 ? 'no change' : delta(v, u, measure === 'volume' ? 0 : 1).replace('.0 ', ' ')
  }
  return (
    <table className="lift-table">
      <caption className="sr-only">{measure === 'e1rm' ? 'Estimated 1RM' : measure === 'top' ? 'Heaviest set' : 'Volume'} per lift in this period</caption>
      <thead>
        <tr><th scope="col">Lift</th><th scope="col">Now</th><th scope="col">Change</th><th scope="col">Best</th></tr>
      </thead>
      <tbody>
        {rows.map(({ l, s }) => (
          <tr key={l.exercise_id}>
            <th scope="row"><span className="lift-name"><i className="lift-dot" style={{ background: colorOf(l.exercise_id) }} aria-hidden="true" /><span>{l.name}</span></span></th>
            <td className="num">{val(s!.now)}</td>
            <td className={`num${s!.sessions > 1 && s!.change > 0 ? ' up' : ''}`}>{change(s!.change, s!.sessions)}</td>
            <td className="num">{val(s!.best)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}


/**
 * Records in the period for the lifts shown on the strength chart (the main
 * lifts unless others are chosen), newest first, then other milestones
 * (workout counts, bodyweight exercises). With no lifts yet, every exercise's records.
 */
export function RecordsCard({ d, units }: { d: ProgressDetail; units: UnitSystem }) {
  const shown = visibleRecords(d.records, units)
  const main = useLiftFilter(d).ids
  const groups = new Map<string, { name: string; records: typeof shown }>()
  for (const r of shown) {
    const isMain = !main.length || (r.exercise_id != null && main.includes(r.exercise_id))
    if (!isMain && r.kind !== 'milestone') continue
    const key = isMain ? r.exercise_id ?? 'milestones' : 'milestones'
    const g = groups.get(key) ?? { name: key === 'milestones' ? 'Milestones' : r.exercise, records: [] }
    g.records.push(r)
    groups.set(key, g)
  }
  const rank = (id: string) => (main.includes(id) ? main.indexOf(id) : id === 'milestones' ? 99 : 50)
  const list = [...groups.entries()].sort(([a, x], [b, y]) => rank(a) - rank(b) || y.records[0].date.localeCompare(x.records[0].date))
  return (
    <ChartCard title="Personal records" sub="The lifts on the strength chart, newest first" empty={list.length ? null : 'No new records on these lifts in this period.'}>
      <div className="records-by-lift">
        {list.map(([id, g]) => (
          <div key={id}>
            <h4>{g.name}</h4>
            <RecordList records={g.records} units={units} exercise={id === 'milestones'} dates limit={5} />
          </div>
        ))}
      </div>
    </ChartCard>
  )
}
/** Cardio minutes per week, and each activity's time and distance in the period. */
export function CardioCard({ d, units }: { d: ProgressDetail; units: UnitSystem }) {
  const voice = useVoice()
  const t = d.training.weekly
  const total = t.reduce((a, x) => a + x.cardio_s, 0)
  return (
    <ChartCard title="Cardio" sub="Minutes per week" empty={total > 0 ? null : voice === 'coach' ? 'No cardio logged in this period.' : 'No cardio in this period. Add a cardio exercise (treadmill, bike, rower…) to a workout and log its time.'}>
      <BarChart label="Cardio minutes per week" color="var(--gold)"
        items={t.map((x) => ({
          label: wk(x.week), value: Math.round(x.cardio_s / 60),
          tip: x.cardio_s ? `Week of ${wk(x.week)}: ${minutesText(x.cardio_s)}${x.cardio_m ? ` · ${distanceText(x.cardio_m, units)}` : ''}` : `Week of ${wk(x.week)}: none`,
        }))} />
      <ul className="cardio-list">
        {d.cardio.map((c) => (
          <li key={c.exercise_id}>
            <span className="small"><b>{c.name}</b> <span className="muted">· {c.sessions} session{c.sessions === 1 ? '' : 's'}</span></span>
            <span className="small num">
              {minutesText(c.seconds)}{c.metres ? ` · ${distanceText(c.metres, units)}` : ''}
              {c.longest_m ? <span className="xs muted"> · longest {distanceText(c.longest_m, units)}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}

export function CaloriesCard({ d }: { d: ProgressDetail }) {
  const days = d.nutrition.daily
  return (
    <ChartCard title="Calories" sub="Per day vs target" empty={days.some((x) => x.calories != null) ? null : 'No meals logged in this period.'}>
      <BarChart label="Calories per day against the target"
        items={days.map((x) => ({
          label: monthDay(x.date), value: x.calories, target: x.calories_target,
          good: x.calories == null || !x.calories_target || Math.abs(x.calories - x.calories_target) <= x.calories_target * 0.1,
          tip: x.calories == null ? `${day(x.date)}: nothing logged` : `${day(x.date)}: ${int(x.calories)}${x.calories_target ? ` of ${int(x.calories_target)}` : ''} kcal`,
        }))} />
      <Legend items={[{ name: 'Within 10% of target', color: 'var(--chart)' }, { name: 'Further off', color: 'var(--peach-ink)' }, { name: 'Target', color: 'var(--leaf)', dashed: true }]} />
    </ChartCard>
  )
}

export function ProteinCard({ d }: { d: ProgressDetail }) {
  const days = d.nutrition.daily
  return (
    <ChartCard title="Protein" sub="Grams per day vs target" empty={days.some((x) => x.protein_g != null) ? null : 'No meals logged in this period.'}>
      <BarChart label="Protein per day against the target" color="var(--macro-p)"
        items={days.map((x) => ({
          label: monthDay(x.date), value: x.protein_g, target: x.protein_target,
          tip: x.protein_g == null ? `${day(x.date)}: nothing logged` : `${day(x.date)}: ${x.protein_g}${x.protein_target ? ` of ${x.protein_target}` : ''} g`,
        }))} />
    </ChartCard>
  )
}

export function OnPlanCard({ d }: { d: ProgressDetail }) {
  const w = d.nutrition.weekly_on_plan
  return (
    <ChartCard title="Meals on plan" sub="Per week ('partly' counts half)" empty={w.some((x) => x.pct != null) ? null : 'No meals logged in this period.'}>
      <BarChart label="Share of meals on plan per week" color="var(--leaf)"
        items={w.map((x) => ({ label: wk(x.week), value: x.pct, target: 80, tip: x.pct == null ? `Week of ${wk(x.week)}: no meals` : `Week of ${wk(x.week)}: ${x.pct}% of ${x.meals} meals` }))} />
    </ChartCard>
  )
}

export function StepsCard({ d }: { d: ProgressDetail }) {
  return (
    <ChartCard title="Steps" sub="Per day vs target" empty={d.habits.some((x) => x.steps != null) ? null : 'No steps logged in this period.'}>
      <BarChart label="Steps per day against the target"
        items={d.habits.map((x) => ({ label: monthDay(x.date), value: x.steps, target: x.steps_target, tip: x.steps == null ? `${day(x.date)}: not logged` : `${day(x.date)}: ${int(x.steps)}${x.steps_target ? ` of ${int(x.steps_target)}` : ''} steps` }))} />
    </ChartCard>
  )
}

export function WaterCard({ d }: { d: ProgressDetail }) {
  return (
    <ChartCard title="Water" sub="Litres per day vs target" empty={d.habits.some((x) => x.water_ml != null) ? null : 'No water logged in this period.'}>
      <BarChart label="Water per day against the target" color="var(--macro-c)"
        items={d.habits.map((x) => ({ label: monthDay(x.date), value: x.water_ml, target: x.water_target, tip: x.water_ml == null ? `${day(x.date)}: not logged` : `${day(x.date)}: ${litres(x.water_ml)}${x.water_target ? ` of ${litres(x.water_target)}` : ''}` }))} />
    </ChartCard>
  )
}

export function SleepCard({ d }: { d: ProgressDetail }) {
  return (
    <ChartCard title="Sleep" sub="Hours per night vs target" empty={d.habits.some((x) => x.sleep_h != null) ? null : 'No sleep logged in this period.'}>
      <BarChart label="Sleep per night against the target" color="var(--chart-sleep)"
        items={d.habits.map((x) => ({ label: monthDay(x.date), value: x.sleep_h, target: x.sleep_target, tip: x.sleep_h == null ? `${day(x.date)}: not logged` : `${day(x.date)}: ${x.sleep_h} h${x.sleep_target ? ` of ${x.sleep_target}` : ''}` }))} />
    </ChartCard>
  )
}

export function MeasureCard({ d }: { d: ProgressDetail }) {
  const voice = useVoice()
  const c = d.check_ins
  const inch = (cm: number | null) => (cm == null ? null : Math.round(cmToIn(cm) * 10) / 10)
  const has = c.filter((x) => x.waist_cm != null || x.hips_cm != null).length >= 1
  return (
    <ChartCard title="Waist and hips" sub={voice === 'coach' ? 'Inches, from check-ins' : 'Inches, from your check-ins'} empty={has ? null : voice === 'coach' ? 'Measurements from weekly check-ins show up here.' : 'Measurements from your weekly check-ins show up here.'}>
      <MultiLineChart labels={c.map((x) => wk(x.week_start))} label="Waist and hips per check-in" connectGaps
        series={[{ name: 'Waist', color: 'var(--chart)', values: c.map((x) => inch(x.waist_cm)) }, { name: 'Hips', color: 'var(--gold)', values: c.map((x) => inch(x.hips_cm)) }]}
        format={(v, s) => `${s.name}: ${v} in`} />
      <Legend items={[{ name: 'Waist', color: 'var(--chart)' }, { name: 'Hips', color: 'var(--gold)' }]} />
    </ChartCard>
  )
}

const SCORE_COLORS = { Energy: 'var(--chart)', Sleep: 'var(--chart-sleep)', Stress: 'var(--orange)', Hunger: 'var(--gold)' }

export function ScoresCard({ d }: { d: ProgressDetail }) {
  const voice = useVoice()
  const c = d.check_ins
  const has = c.some((x) => x.energy != null || x.sleep != null)
  const series = (['Energy', 'Sleep', 'Stress', 'Hunger'] as const).map((name) => ({
    name, color: SCORE_COLORS[name], dashed: name === 'Stress' || name === 'Hunger',
    values: c.map((x) => x[name.toLowerCase() as 'energy' | 'sleep' | 'stress' | 'hunger']),
  }))
  return (
    <ChartCard title={voice === 'coach' ? 'How they felt' : 'How you felt'} sub="Check-in scores, 1 to 5" empty={has ? null : voice === 'coach' ? 'Scores from weekly check-ins show up here.' : 'Scores from your weekly check-ins show up here.'}>
      <MultiLineChart labels={c.map((x) => wk(x.week_start))} series={series} min={1} max={5} connectGaps label="Energy, sleep, stress and hunger per check-in"
        format={(v, s) => `${s.name}: ${v} of 5`} />
      <Legend items={series.map((s) => ({ name: s.name, color: s.color, dashed: s.dashed }))} />
    </ChartCard>
  )
}
