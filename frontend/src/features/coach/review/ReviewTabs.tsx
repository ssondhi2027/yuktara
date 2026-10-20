import { useState } from 'react'
import { Link } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Image as ImageIcon } from 'lucide-react'
import { api, COACH_REFRESH, type CheckinReview, type Meal, type Period, type ProgressDetail } from '@/lib/api'
import { addDays, clockTime, localDay, monthDay, shortDay } from '@/lib/dates'
import { amountText } from '@/lib/meals'
import { bodyWeight, cmToIn, int, litres } from '@/lib/units'
import type { MealType } from '@/types/db'
import { useLayout } from '@/app/hooks'
import { useUnits } from '@/app/auth'
import { Segmented } from '@/components/ui/Segmented'
import { PageError } from '@/components/ui/Loading'
import { ClientWorkouts } from '@/features/coach/clients/ClientWorkouts'
import { PlanVsEaten } from '@/features/coach/PlanVsEaten'
import {
  CaloriesCard, MeasureCard, MusclesCard, OnPlanCard, ProgressDashboard, ProgressVoice, ProteinCard, ScoresCard, StrengthCard, VolumeCard,
  WorkoutsCard,
} from '@/features/client/progress/ProgressPage'

/** The check-in review's tabs: the check-in itself (ReviewFull / ReviewCompact), then the client's whole picture. */
export const REVIEW_TABS = ['check-in', 'Training', 'Nutrition', 'Progress', 'Past check-ins'] as const
export type ReviewTab = (typeof REVIEW_TABS)[number]

export function ReviewTabBar({ r, tab, onChange }: { r: CheckinReview; tab: ReviewTab; onChange: (t: ReviewTab) => void }) {
  return (
    <nav className="tabs-line" role="tablist" aria-label={`${r.client.first_name}'s check-in and history`}>
      {REVIEW_TABS.map((t) => (
        <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => onChange(t)}>
          {t === 'check-in' ? `Week ${r.week} check-in` : t}
        </button>
      ))}
    </nav>
  )
}

/** Everything but the check-in tab, for one client. */
export function ReviewTabPanel({ r, tab }: { r: CheckinReview; tab: Exclude<ReviewTab, 'check-in'> }) {
  return (
    <div className="review-tab" role="tabpanel" aria-label={tab}>
      {tab === 'Training' && <TrainingTab r={r} />}
      {tab === 'Nutrition' && <NutritionTab r={r} />}
      {tab === 'Progress' && <ProgressTab r={r} />}
      {tab === 'Past check-ins' && <PastCheckinsTab r={r} />}
    </div>
  )
}

/** The client's Progress numbers (same maths as their own page), cached per period. */
const useClientProgress = (clientId: string, period: Period) =>
  useQuery({ queryKey: ['client-progress', clientId, period], queryFn: () => api.clientProgress(clientId, period), placeholderData: keepPreviousData, staleTime: 60_000 })

function Loading({ height = 220 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} />
}

// ---------- Training ----------

function TrainingTab({ r }: { r: CheckinReview }) {
  const units = useUnits()
  const progress = useClientProgress(r.client.id, 'p12')
  const detail = useQuery({ queryKey: ['client-detail', r.client.id], queryFn: () => api.clientDetail(r.client.id), ...COACH_REFRESH })
  const program = detail.data?.program
  return (
    <>
      <section className="card review-week">
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="eyebrow">Week of {monthDay(r.week_start)}</div>
            <b className="num review-big">{r.workouts_done} of {r.workouts_planned || '—'}</b> <span className="muted">planned workouts done</span>
            {r.skipped_note && <p className="small muted" style={{ margin: '4px 0 0' }}>{r.skipped_note}</p>}
          </div>
          <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
            {program
              ? <span className="small">{program.name}{program.week ? ` · week ${Math.min(program.week, program.weeks)} of ${program.weeks}` : ''}</span>
              : detail.data && <span className="small muted">No program assigned</span>}
            <Link className="btn btn-ghost btn-sm" to={program ? `/coach/programs/${program.id}` : `/coach/programs/new/${r.client.id}`}>
              {program ? 'Open program' : 'Create a program'}
            </Link>
          </div>
        </div>
      </section>
      {progress.error ? <PageError error={progress.error} /> : !progress.data ? <Loading /> : (
        <ProgressVoice value="coach">
          <div className="chart-grid review-charts">
            <WorkoutsCard d={progress.data} />
            <VolumeCard d={progress.data} units={units} />
            <MusclesCard d={progress.data} />
            <StrengthCard d={progress.data} units={units} />
          </div>
        </ProgressVoice>
      )}
      <section className="card"><ClientWorkouts clientId={r.client.id} firstName={r.client.first_name} /></section>
    </>
  )
}

// ---------- Nutrition ----------

const TYPE_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }

function NutritionTab({ r }: { r: CheckinReview }) {
  const units = useUnits()
  const progress = useClientProgress(r.client.id, 'p4')
  const end = addDays(r.week_start, 6)
  const meals = useQuery({ queryKey: ['client-meals', r.client.id, r.week_start], queryFn: () => api.clientMeals(r.client.id, r.week_start, end), staleTime: 60_000 })
  const t = r.targets
  return (
    <>
      <section className="card stack" style={{ gap: 8 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3>Targets</h3>
          <Link className="btn btn-ghost btn-sm" to={`/coach/nutrition/${r.client.id}`}>{t ? 'Change targets or meal plan' : 'Set targets'}</Link>
        </div>
        {t ? (
          <>
            <p className="small" style={{ margin: 0 }}><b>{int(t.calories)} kcal</b> · P {t.protein_g} g · C {t.carbs_g} g · F {t.fat_g} g</p>
            <p className="xs muted" style={{ margin: 0 }}>
              {[t.water_ml ? `${litres(t.water_ml)} water` : null, t.steps ? `${int(t.steps)} steps` : null, t.sleep_h ? `${t.sleep_h} h sleep` : null].filter(Boolean).join(' · ')}
            </p>
          </>
        ) : <p className="small muted" style={{ margin: 0 }}>No targets yet: {r.client.first_name} sees "waiting for your coach".</p>}
        <p className="xs muted" style={{ margin: 0 }}>This week: {r.meals_on_plan} of {r.meals_planned} meals on plan{r.meals_pct != null ? ` (${r.meals_pct}%)` : ''}.</p>
      </section>

      <PlanVsEaten clientId={r.client.id} weekStart={r.week_start} firstName={r.client.first_name} />

      <section className="card stack" style={{ gap: 10 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3>Meals that week</h3>
          <span className="small muted">{shortDay(r.week_start)} – {shortDay(end)}</span>
        </div>
        {meals.error ? <p className="small muted">{meals.error.message}</p> : !meals.data ? <Loading height={140} /> : (
          <MealsWeek meals={meals.data} from={r.week_start} to={end} target={t?.calories ?? null} proteinTarget={t?.protein_g ?? null} units={units} />
        )}
      </section>

      {progress.error ? <PageError error={progress.error} /> : !progress.data ? <Loading /> : (
        <ProgressVoice value="coach">
          <div className="chart-grid review-charts">
            <CaloriesCard d={progress.data} />
            <ProteinCard d={progress.data} />
            <OnPlanCard d={progress.data} />
          </div>
        </ProgressVoice>
      )}
    </>
  )
}

/** The week's meals by day: totals against targets, then each meal with its foods. */
function MealsWeek({ meals, from, to, target, proteinTarget, units }: {
  meals: Meal[]; from: string; to: string; target: number | null; proteinTarget: number | null; units: ReturnType<typeof useUnits>
}) {
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d)
  const byDay = (d: string) => meals.filter((m) => localDay(m.eaten_at) === d).sort((a, b) => a.eaten_at.localeCompare(b.eaten_at))
  if (!meals.length) return <p className="small muted">No meals logged that week.</p>
  return (
    <ul className="meals-week">
      {days.map((d) => {
        const ms = byDay(d)
        const kcal = ms.reduce((a, m) => a + m.calories, 0)
        const protein = Math.round(ms.reduce((a, m) => a + m.protein_g, 0))
        const off = target ? Math.abs(kcal - target) / target : 0
        return (
          <li key={d} className="meals-day">
            <div className="between" style={{ gap: 8, flexWrap: 'wrap' }}>
              <b className="small">{shortDay(d)}</b>
              {ms.length ? (
                <span className={`xs ${target && off > 0.1 ? 'bad' : 'muted'}`}>
                  {int(kcal)}{target ? ` of ${int(target)}` : ''} kcal · P {protein}{proteinTarget ? ` of ${proteinTarget}` : ''} g
                </span>
              ) : <span className="xs muted">Nothing logged</span>}
            </div>
            {ms.length > 0 && (
              <ul className="meals-day-list">
                {ms.map((m) => (
                  <li key={m.id} className="meals-row">
                    <span className="meals-thumb" aria-hidden>{m.photo_url ? <img src={m.photo_url} alt="" /> : <ImageIcon size={16} />}</span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="small"><b>{TYPE_LABEL[m.meal_type]}</b> <span className="muted">· {clockTime(m.eaten_at)}</span></div>
                      <div className="small truncate">{m.title}</div>
                      <div className="xs muted">{m.calories} kcal · P {m.protein_g} · C {m.carbs_g} · F {m.fat_g}</div>
                      {m.items && m.items.length > 0 && (
                        <details className="meal-items">
                          <summary className="xs">{m.items.length} {m.items.length === 1 ? 'food' : 'foods'}</summary>
                          <ul>{m.items.map((x, i) => <li key={i} className="xs muted">{x.food_name} · {amountText(x.quantity, x.unit, x.serving, units)} · {x.calories} kcal</li>)}</ul>
                        </details>
                      )}
                    </div>
                    <span className={`pill xs ${m.on_plan === 'yes' ? 'good' : m.on_plan === 'no' ? 'warn' : ''}`}>
                      {m.on_plan === 'yes' ? 'On plan' : m.on_plan === 'partly' ? 'Partly' : 'Off plan'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------- Progress ----------

const PERIODS: { value: Period; label: string }[] = [
  { value: 'p4', label: '4 weeks' },
  { value: 'p12', label: '12 weeks' },
  { value: 'all', label: 'Since start' },
]

function ProgressTab({ r }: { r: CheckinReview }) {
  const units = useUnits()
  const layout = useLayout()
  const [period, setPeriod] = useState<Period>('p12')
  const progress = useClientProgress(r.client.id, period)
  return (
    <div className={`progress ${layout}`}>
      <div className="between review-tab-head">
        <span className="small muted">{r.client.first_name}'s Progress page, as they see it, in your units.</span>
        <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      </div>
      {progress.error ? <PageError error={progress.error} /> : !progress.data ? <Loading height={320} /> : (
        <ProgressDashboard d={progress.data} units={units} layout={layout} voice="coach" />
      )}
    </div>
  )
}

// ---------- Past check-ins ----------

const STATUS: Record<string, { text: string; cls: string }> = {
  due: { text: 'Due', cls: 'awaiting' },
  submitted: { text: 'Waiting for review', cls: 'gold' },
  reviewed: { text: 'Reviewed', cls: 'good' },
  missed: { text: 'Missed', cls: 'warn' },
}

function PastCheckinsTab({ r }: { r: CheckinReview }) {
  const units = useUnits()
  const history = useQuery({ queryKey: ['client-history', r.client.id], queryFn: () => api.clientHistory(r.client.id), ...COACH_REFRESH })
  const all = useClientProgress(r.client.id, 'all')
  if (history.error) return <PageError error={history.error} />
  if (!history.data) return <Loading />
  const list = [...history.data.check_ins].sort((a, b) => b.week_start.localeCompare(a.week_start))
  const d: ProgressDetail | undefined = all.data
  const scores = (ws: string) => d?.check_ins.find((c) => c.week_start === ws)
  const weightOf = (ws: string) => d?.weight.weekly.find((w) => w.week === ws)?.kg ?? null
  return (
    <>
      <section className="card stack" style={{ gap: 8 }}>
        <div className="between"><h3>Check-ins</h3><span className="small muted">{list.length} so far</span></div>
        {list.length === 0 ? <p className="small muted">No check-ins yet.</p> : (
          <ul className="past-checkins">
            {list.map((c) => {
              const s = scores(c.week_start)
              const kg = weightOf(c.week_start)
              const current = c.id === r.check_in_id
              const open = c.status === 'submitted' || c.status === 'reviewed'
              const st = STATUS[c.status] ?? { text: c.status, cls: '' }
              return (
                <li key={c.id} className={`past-row${current ? ' current' : ''}`}>
                  <div className="between" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <b className="small">Week of {monthDay(c.week_start)}{current && <span className="muted"> · this check-in</span>}</b>
                    <span className={`pill xs ${st.cls}`}>{st.text}</span>
                  </div>
                  <div className="xs muted past-facts">
                    {[
                      kg != null ? `Weight ${bodyWeight(kg, units)} (week average)` : null,
                      s?.waist_cm != null ? `waist ${Math.round(cmToIn(s.waist_cm) * 10) / 10} in` : null,
                      s && [s.energy, s.sleep, s.stress, s.hunger].some((x) => x != null)
                        ? `energy ${s.energy ?? '–'} · sleep ${s.sleep ?? '–'} · stress ${s.stress ?? '–'} · hunger ${s.hunger ?? '–'} (of 5)` : null,
                      c.submitted_at ? `sent ${shortDay(localDay(c.submitted_at))}` : null,
                      c.reviewed_at ? `reviewed ${shortDay(localDay(c.reviewed_at))}` : null,
                    ].filter(Boolean).join(' · ') || 'Nothing sent'}
                  </div>
                  {open && !current && <Link className="link small" to={`/coach/check-ins/${c.id}`}>Open review</Link>}
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {d && (
        <ProgressVoice value="coach">
          <div className="chart-grid review-charts">
            <MeasureCard d={d} />
            <ScoresCard d={d} />
          </div>
        </ProgressVoice>
      )}
    </>
  )
}
