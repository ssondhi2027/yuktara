import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api, type PlanWeek } from '@/lib/api'
import { monthDay } from '@/lib/dates'
import { lineAmountText, planDays, PLAN_DAY_LABEL, planMeal, sumNutrition } from '@/lib/meals'
import { useUnits } from '@/app/auth'
import type { MealType } from '@/types/db'
import '@/components/food/food.css'

const TYPE_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' }

/**
 * The client's meal plan next to what they logged, per meal, for a week
 * (client view and check-in review). Averages are per day: planned over the days
 * with a plan, eaten over the days the meal was logged. Amounts in the coach's unit.
 */
export function PlanVsEaten({ clientId, weekStart, firstName }: { clientId: string; weekStart: string; firstName: string }) {
  const { data, error } = useQuery({ queryKey: ['plan-week', clientId, weekStart], queryFn: () => api.planWeek(clientId, weekStart), staleTime: 60_000 })
  if (error) return <section className="card"><h3>Meal plan vs eaten</h3><p className="small muted">Couldn't load this right now.</p></section>
  if (!data) return <div className="skeleton" style={{ height: 160 }} />
  return <PlanWeekCard w={data} clientId={clientId} firstName={firstName} />
}

function PlanWeekCard({ w, clientId, firstName }: { w: PlanWeek; clientId: string; firstName: string }) {
  const units = useUnits()
  const planned = sumNutrition(w.rows.filter((r) => r.planned_days).map((r) => r.planned))
  const eatenDays = Math.max(0, ...w.rows.map((r) => r.logged_days))
  return (
    <section className="card stack plan-week" style={{ gap: 10 }} aria-label="Meal plan vs eaten">
      <div className="between" style={{ flexWrap: 'wrap', gap: 6 }}>
        <h3>Meal plan vs eaten</h3>
        <span className="xs muted">Week of {monthDay(w.week_start)} · {w.days} {w.days === 1 ? 'day' : 'days'} so far</span>
      </div>
      {!w.plan ? (
        <p className="small muted">No meal plan for {firstName} yet. <Link className="link" to={`/coach/nutrition/${clientId}`}>Create one</Link> on the Nutrition plans page.</p>
      ) : (
        <>
          <div className="pve-table" role="table" aria-label="Planned and eaten per meal, daily averages">
            <div className="pve-row pve-head" role="row">
              <span role="columnheader">Meal</span>
              <span role="columnheader">Planned</span>
              <span role="columnheader">Eaten (avg)</span>
            </div>
            {w.rows.map((r) => (
              <div key={r.meal_type} className="pve-row" role="row">
                <span role="cell"><b>{TYPE_LABEL[r.meal_type]}</b></span>
                <span role="cell" className="small">{r.planned_days ? <>{r.planned.calories} kcal<br /><span className="muted">P {r.planned.protein_g} g</span></> : <span className="muted">Not planned</span>}</span>
                <span role="cell" className="small">
                  {r.logged_days ? <>{r.eaten.calories} kcal<br /><span className="muted">P {r.eaten.protein_g} g · {r.logged_days} of {w.days} days{r.meals ? ` · ${r.on_plan} on plan` : ''}</span></> : <span className="muted">Not logged</span>}
                </span>
              </div>
            ))}
            <div className="pve-row pve-total" role="row">
              <span role="cell"><b>Day</b></span>
              <span role="cell" className="small"><b>{planned.calories} kcal</b><br /><span className="muted">P {planned.protein_g} g</span></span>
              <span role="cell" className="small">{eatenDays ? <><b>{sumNutrition(w.rows.filter((r) => r.logged_days).map((r) => r.eaten)).calories} kcal</b><br /><span className="muted">sum of meal averages</span></> : <span className="muted">Nothing logged</span>}</span>
            </div>
          </div>
          {w.targets && <p className="xs muted">Targets: {w.targets.calories.toLocaleString('en-US')} kcal · P {w.targets.protein_g} g a day.</p>}
          <details>
            <summary className="small">The plan{w.plan.split ? ' (training and rest days)' : ''}, since {monthDay(w.plan.effective_from!)}</summary>
            {planDays(w.plan.split).map((day) => (
              <div key={day} className="stack" style={{ gap: 6, marginTop: 8 }}>
                {w.plan!.split && <b className="small">{PLAN_DAY_LABEL[day]}</b>}
                {w.types.map((t) => {
                  const m = planMeal(w.plan!, day, t)
                  if (!m?.lines.length) return null
                  return (
                    <div key={t} className="xs">
                      <b>{TYPE_LABEL[t]}:</b> {m.lines.map((l) => `${l.food.name} ${lineAmountText(l, units)}`).join(', ')}
                      {m.notes && <span className="muted"> · {m.notes}</span>}
                    </div>
                  )
                })}
              </div>
            ))}
          </details>
        </>
      )}
    </section>
  )
}
