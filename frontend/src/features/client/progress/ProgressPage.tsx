import { useState } from 'react'
import { Link } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react'
import { api, type Period, type ProgressDetail } from '@/lib/api'
import { monthDay, weekday } from '@/lib/dates'
import { MUSCLE_LABEL } from '@/lib/muscles'
import { pctOf, plusDays, trend, type Kpi } from '@/lib/progress'
import { monthDayOf } from '@/lib/insights'
import { bodyValue, bodyWeight, cmToIn, int, litres, loadValue, unitLabel, weightChange } from '@/lib/units'
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
  const [section, setSection] = useState<Section>('weight')
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
  const phone = layout === 'phone'

  const cards: Record<Section, React.ReactNode[]> = {
    weight: phone
      ? [<SignalsCard key="s" d={d} units={units} voice="client" />, <WeightCard key="w" d={d} units={units} big={false} />]
      : [<WeightCard key="w" d={d} units={units} big={layout === 'desktop'} />, <SignalsCard key="s" d={d} units={units} voice="client" />],
    training: [
      <WorkoutsCard key="t1" d={d} />,
      <VolumeCard key="t2" d={d} units={units} />,
      <MusclesCard key="t3" d={d} />,
      <StrengthCard key="t4" d={d} units={units} />,
    ],
    nutrition: [<CaloriesCard key="n1" d={d} />, <ProteinCard key="n2" d={d} />, <OnPlanCard key="n3" d={d} />],
    habits: [<StepsCard key="h1" d={d} />, <WaterCard key="h2" d={d} />, <SleepCard key="h3" d={d} />],
    checkins: [<MeasureCard key="c1" d={d} />, <ScoresCard key="c2" d={d} />],
  }

  return (
    <div className={`page progress ${layout}`}>
      <header className="page-head progress-head">
        <div>
          <div className="page-date">Since {monthDay(p.start_date)} · week {p.week}{p.weeks ? ` of ${p.weeks}` : ''}</div>
          <h1>Progress</h1>
        </div>
        <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      </header>

      <Kpis d={d} units={units} />

      {phone ? (
        <>
          <div className="section-tabs">
            <Segmented label="Charts" block value={section} onChange={setSection} options={SECTIONS} />
          </div>
          <div className="chart-stack">{cards[section]}</div>
        </>
      ) : (
        <div className="chart-grid">
          {cards.weight}
          {cards.training}
          {cards.nutrition}
          {cards.habits}
          {cards.checkins}
        </div>
      )}

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

function KpiCard({ title, value, k, prevLabel, flat, line, note }: { title: string; value: string | null; k: Kpi; prevLabel: string; flat?: number; line: string; note?: string | null }) {
  return (
    <div className="card kpi">
      <div className="kpi-title xs muted">{title}</div>
      <div className="kpi-value">
        <b className="num">{value ?? '—'}</b>
        {value != null && <Arrow k={k} flat={flat} label={prevLabel} />}
      </div>
      <div className="kpi-line xs">{line}</div>
      {note && <div className="kpi-note xs">{note}</div>}
    </div>
  )
}

function Kpis({ d, units }: { d: ProgressDetail; units: UnitSystem }) {
  const k = d.kpis
  const u = unitLabel(units)
  const w = k.weight
  const of = (v: number | null | undefined, t: number | null | undefined) => (v != null && t ? `${pctOf(v, t)}% of ` : '')
  return (
    <div className="kpis">
      <KpiCard title="Weight (weekly average)" k={w} flat={0.2} prevLabel={w.previous != null ? bodyWeight(w.previous, units) : ''}
        note={d.weight.plateau ? `Steady for ${d.weight.plateau.weeks} weeks, since ${monthDay(d.weight.plateau.since)}` : null}
        value={w.value != null ? bodyWeight(w.value, units) : null}
        line={w.value == null ? 'No weigh-ins in this period yet.'
          : [w.change != null ? `${weightChange(w.change, units)} this period` : 'One week of weigh-ins so far', w.to_goal != null ? `${Math.abs(bodyValue(w.to_goal, units))} ${u} ${w.to_goal > 0 ? 'to go' : 'past'} goal` : null].filter(Boolean).join(' · ')} />
      <KpiCard title="Workouts done" k={k.workouts} flat={2} prevLabel={`${k.workouts.previous}%`}
        value={k.workouts.value != null ? `${k.workouts.value}%` : null}
        line={k.workouts.planned ? `${k.workouts.done} of ${k.workouts.planned} planned · ${k.workouts.streak ? `${k.workouts.streak}-week streak` : 'no streak yet'}` : 'No planned workouts in this period.'}
        note={d.strength.some((l) => l.plateau) ? `${d.strength.filter((l) => l.plateau).map((l) => l.name).join(', ')} steady for ${Math.max(...d.strength.filter((l) => l.plateau).map((l) => l.plateau!.weeks))}+ weeks` : null} />
      <KpiCard title="Calories (daily average)" k={k.calories} flat={25} prevLabel={`${int(k.calories.previous ?? 0)} kcal`}
        value={k.calories.value != null ? `${int(k.calories.value)} kcal` : null}
        line={k.calories.value == null ? 'No meals logged in this period.'
          : `${of(k.calories.value, k.calories.target)}${k.calories.target ? `${int(k.calories.target)} target` : 'no target yet'}${k.meals_on_plan.value != null ? ` · ${k.meals_on_plan.value}% meals on plan` : ''}`} />
      <KpiCard title="Protein (daily average)" k={k.protein} flat={3} prevLabel={`${k.protein.previous} g`}
        value={k.protein.value != null ? `${k.protein.value} g` : null}
        line={k.protein.value == null ? 'No meals logged in this period.' : k.protein.target ? `${of(k.protein.value, k.protein.target)}${k.protein.target} g target` : 'No target yet'} />
      <KpiCard title="Steps (daily average)" k={k.steps} flat={150} prevLabel={int(k.steps.previous ?? 0)}
        value={k.steps.value != null ? int(k.steps.value) : null}
        line={k.steps.value == null ? 'No steps logged in this period.' : k.steps.target ? `${of(k.steps.value, k.steps.target)}${int(k.steps.target)} target` : 'No target yet'} />
      <KpiCard title="Sleep and water" k={k.sleep} flat={0.15} prevLabel={`${k.sleep.previous} h`}
        value={k.sleep.value != null ? `${k.sleep.value} h` : k.water.value != null ? litres(k.water.value) : null}
        line={k.sleep.value == null && k.water.value == null ? 'No sleep or water logged yet.'
          : [k.sleep.value != null && k.sleep.target ? `${of(k.sleep.value, k.sleep.target)}${k.sleep.target} h` : null,
            k.water.value != null ? `water ${litres(k.water.value)}${k.water.target ? ` of ${litres(k.water.target)}` : ''}` : null].filter(Boolean).join(' · ')} />
    </div>
  )
}

// ---------- Cards ----------

function ChartCard({ title, sub, empty, className, children }: { title: string; sub?: string; empty?: string | null; className?: string; children?: React.ReactNode }) {
  return (
    <section className={`card chart-card${className ? ` ${className}` : ''}`}>
      <div className="card-head"><h3>{title}</h3>{sub && <span className="small muted">{sub}</span>}</div>
      {empty ? <p className="small muted chart-empty">{empty}</p> : children}
    </section>
  )
}

function WeightCard({ d, units, big }: { d: ProgressDetail; units: UnitSystem; big: boolean }) {
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
      empty={has ? null : 'No weigh-ins in this period. Log your morning weight from Home; the trend shows up here.'}>
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

function WorkoutsCard({ d }: { d: ProgressDetail }) {
  const t = d.training.weekly
  const any = t.some((x) => x.planned > 0 || x.done > 0)
  return (
    <ChartCard title="Workouts" sub="Done vs planned, per week" empty={any ? null : 'No planned workouts yet. Your coach assigns your program.'}>
      <BarChart label="Workouts done and planned per week"
        items={t.map((x) => ({ label: wk(x.week), value: x.done, planned: x.planned, good: x.planned === 0 || x.done >= x.planned, tip: `Week of ${wk(x.week)}: ${x.done} of ${x.planned}` }))} />
      <Legend items={[{ name: 'Done', color: 'var(--chart)' }, { name: 'Planned', color: 'var(--line-strong)', dashed: true }]} />
    </ChartCard>
  )
}

function VolumeCard({ d, units }: { d: ProgressDetail; units: UnitSystem }) {
  const t = d.training.weekly
  const u = unitLabel(units)
  return (
    <ChartCard title="Volume" sub={`Sets × reps × weight, ${u} per week`} empty={t.some((x) => x.volume_kg > 0) ? null : 'No weighted sets logged in this period.'}>
      <BarChart label={`Training volume per week in ${u}`}
        items={t.map((x) => ({ label: wk(x.week), value: Math.round(loadValue(x.volume_kg, units)), tip: `Week of ${wk(x.week)}: ${int(loadValue(x.volume_kg, units))} ${u} · ${x.sets} sets` }))} />
    </ChartCard>
  )
}

function MusclesCard({ d }: { d: ProgressDetail }) {
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

const LIFT_COLORS = ['var(--chart)', 'var(--gold)', 'var(--orange)']

function StrengthCard({ d, units }: { d: ProgressDetail; units: UnitSystem }) {
  const lifts = d.strength
  const u = unitLabel(units)
  const ahead = d.period === 'p4' ? 4 : 8
  // Session dates, then the forecast dates; spaced by real time.
  const future = [...new Set(lifts.flatMap((l) => (l.forecast.enough ? l.forecast.points.filter((p) => (new Date(`${p.week}T00:00:00`).getTime() - new Date(`${l.points[l.points.length - 1].date}T00:00:00`).getTime()) / (7 * 86_400_000) <= ahead).map((p) => p.week) : [])))]
  const dates = [...new Set([...lifts.flatMap((l) => l.points.map((p) => p.date)), ...future])].sort()
  const day0 = dates.length ? new Date(`${dates[0]}T00:00:00`).getTime() : 0
  const positions = dates.map((x) => (new Date(`${x}T00:00:00`).getTime() - day0) / 86_400_000)
  const lv = (kg: number) => loadValue(kg, units)
  const series: Series[] = lifts.flatMap((l, i) => {
    const color = LIFT_COLORS[i]
    const at = new Map(l.points.map((p) => [p.date, p]))
    const fc = new Map(l.forecast.points.map((p) => [p.week, p]))
    const last = l.points[l.points.length - 1]
    const out: Series[] = [
      { name: `${l.name} (sessions)`, color, faint: true, values: dates.map((dt) => (at.has(dt) ? lv(at.get(dt)!.raw) : null)) },
      { name: l.name, color, values: dates.map((dt) => (at.has(dt) ? lv(at.get(dt)!.smooth) : null)) },
    ]
    if (l.forecast.enough && future.length) {
      const inView = (dt: string) => future.includes(dt) && fc.has(dt)
      out.push({
        name: `${l.name} estimate`, color, dashed: true,
        values: dates.map((dt) => (dt === last.date ? lv(last.smooth) : inView(dt) ? lv(fc.get(dt)!.kg) : null)),
        band: dates.map((dt) => (dt === last.date ? { lo: lv(last.smooth), hi: lv(last.smooth) } : inView(dt) ? { lo: lv(fc.get(dt)!.lo), hi: lv(fc.get(dt)!.hi) } : null)),
      })
    }
    return out
  })
  const notes = lifts.map((l) => {
    const p = l.forecast.points.filter((x) => future.includes(x.week)).pop()
    const fcText = l.forecast.enough && p
      ? `about ${lv(p.kg)} ${u} by ${monthDayOf(p.week, d.weeks[d.weeks.length - 1])} (likely ${lv(p.lo)}–${lv(p.hi)}), an estimate`
      : 'not enough data yet for a forecast (5+ sessions over 3+ weeks)'
    return `${l.name}: ${fcText}${l.plateau ? `; steady for ${l.plateau.weeks} weeks` : ''}.`
  })
  return (
    <ChartCard title="Strength" sub="Estimated 1-rep max, smoothed; faint dots are each session's best set" className="span-2"
      empty={lifts.length && dates.length > 1 ? null : 'Log a few workouts with weights and your main lifts show up here.'}>
      <MultiLineChart labels={dates.map((x) => monthDay(x))} positions={positions} series={series} connectGaps label="Estimated one-rep max over time, with estimates ahead"
        format={(v, s, i) => {
          if (s.faint) return null
          const l = lifts.find((x) => s.name === x.name || s.name === `${x.name} estimate`)
          if (!l) return null
          if (s.name.endsWith(' estimate')) {
            const p = l.forecast.points.find((x) => x.week === dates[i])
            return p ? `${l.name} estimate: ${v} ${u} (likely ${lv(p.lo)}–${lv(p.hi)})` : null
          }
          const p = l.points.find((x) => x.date === dates[i])
          return p ? `${l.name}: ${v} ${u} · best set ${lv(p.kg)} ${u} × ${p.reps}${p.rpe != null ? ` @ RPE ${p.rpe}` : ''} → ${lv(p.raw)}` : null
        }} />
      <Legend items={[
        ...lifts.map((l, i) => ({ name: l.name, color: LIFT_COLORS[i] })),
        ...(series.some((s) => s.band) ? [{ name: 'Estimate, shaded: likely range (80%)', color: 'var(--ink-3)', dashed: true }] : []),
      ]} />
      <ul className="lift-notes xs muted">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </ChartCard>
  )
}

function CaloriesCard({ d }: { d: ProgressDetail }) {
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

function ProteinCard({ d }: { d: ProgressDetail }) {
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

function OnPlanCard({ d }: { d: ProgressDetail }) {
  const w = d.nutrition.weekly_on_plan
  return (
    <ChartCard title="Meals on plan" sub="Per week ('partly' counts half)" empty={w.some((x) => x.pct != null) ? null : 'No meals logged in this period.'}>
      <BarChart label="Share of meals on plan per week" color="var(--leaf)"
        items={w.map((x) => ({ label: wk(x.week), value: x.pct, target: 80, tip: x.pct == null ? `Week of ${wk(x.week)}: no meals` : `Week of ${wk(x.week)}: ${x.pct}% of ${x.meals} meals` }))} />
    </ChartCard>
  )
}

function StepsCard({ d }: { d: ProgressDetail }) {
  return (
    <ChartCard title="Steps" sub="Per day vs target" empty={d.habits.some((x) => x.steps != null) ? null : 'No steps logged in this period.'}>
      <BarChart label="Steps per day against the target"
        items={d.habits.map((x) => ({ label: monthDay(x.date), value: x.steps, target: x.steps_target, tip: x.steps == null ? `${day(x.date)}: not logged` : `${day(x.date)}: ${int(x.steps)}${x.steps_target ? ` of ${int(x.steps_target)}` : ''} steps` }))} />
    </ChartCard>
  )
}

function WaterCard({ d }: { d: ProgressDetail }) {
  return (
    <ChartCard title="Water" sub="Litres per day vs target" empty={d.habits.some((x) => x.water_ml != null) ? null : 'No water logged in this period.'}>
      <BarChart label="Water per day against the target" color="var(--macro-c)"
        items={d.habits.map((x) => ({ label: monthDay(x.date), value: x.water_ml, target: x.water_target, tip: x.water_ml == null ? `${day(x.date)}: not logged` : `${day(x.date)}: ${litres(x.water_ml)}${x.water_target ? ` of ${litres(x.water_target)}` : ''}` }))} />
    </ChartCard>
  )
}

function SleepCard({ d }: { d: ProgressDetail }) {
  return (
    <ChartCard title="Sleep" sub="Hours per night vs target" empty={d.habits.some((x) => x.sleep_h != null) ? null : 'No sleep logged in this period.'}>
      <BarChart label="Sleep per night against the target" color="var(--chart-sleep)"
        items={d.habits.map((x) => ({ label: monthDay(x.date), value: x.sleep_h, target: x.sleep_target, tip: x.sleep_h == null ? `${day(x.date)}: not logged` : `${day(x.date)}: ${x.sleep_h} h${x.sleep_target ? ` of ${x.sleep_target}` : ''}` }))} />
    </ChartCard>
  )
}

function MeasureCard({ d }: { d: ProgressDetail }) {
  const c = d.check_ins
  const inch = (cm: number | null) => (cm == null ? null : Math.round(cmToIn(cm) * 10) / 10)
  const has = c.filter((x) => x.waist_cm != null || x.hips_cm != null).length >= 1
  return (
    <ChartCard title="Waist and hips" sub="Inches, from your check-ins" empty={has ? null : 'Measurements from your weekly check-ins show up here.'}>
      <MultiLineChart labels={c.map((x) => wk(x.week_start))} label="Waist and hips per check-in" connectGaps
        series={[{ name: 'Waist', color: 'var(--chart)', values: c.map((x) => inch(x.waist_cm)) }, { name: 'Hips', color: 'var(--gold)', values: c.map((x) => inch(x.hips_cm)) }]}
        format={(v, s) => `${s.name}: ${v} in`} />
      <Legend items={[{ name: 'Waist', color: 'var(--chart)' }, { name: 'Hips', color: 'var(--gold)' }]} />
    </ChartCard>
  )
}

const SCORE_COLORS = { Energy: 'var(--chart)', Sleep: 'var(--chart-sleep)', Stress: 'var(--orange)', Hunger: 'var(--gold)' }

function ScoresCard({ d }: { d: ProgressDetail }) {
  const c = d.check_ins
  const has = c.some((x) => x.energy != null || x.sleep != null)
  const series = (['Energy', 'Sleep', 'Stress', 'Hunger'] as const).map((name) => ({
    name, color: SCORE_COLORS[name], dashed: name === 'Stress' || name === 'Hunger',
    values: c.map((x) => x[name.toLowerCase() as 'energy' | 'sleep' | 'stress' | 'hunger']),
  }))
  return (
    <ChartCard title="How you felt" sub="Check-in scores, 1 to 5" empty={has ? null : 'Scores from your weekly check-ins show up here.'}>
      <MultiLineChart labels={c.map((x) => wk(x.week_start))} series={series} min={1} max={5} connectGaps label="Energy, sleep, stress and hunger per check-in"
        format={(v, s) => `${s.name}: ${v} of 5`} />
      <Legend items={series.map((s) => ({ name: s.name, color: s.color, dashed: s.dashed }))} />
    </ChartCard>
  )
}
