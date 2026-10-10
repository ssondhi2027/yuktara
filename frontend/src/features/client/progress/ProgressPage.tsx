import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { monthDay } from '@/lib/dates'
import { bodyValue, bodyWeight, cmToIn, delta, inches, loadWeight, pointsIn, unitLabel, weightChange } from '@/lib/units'
import { useUnits } from '@/app/auth'
import { LineChart } from '@/components/charts/LineChart'
import { PlanBars } from '@/components/charts/Bars'
import { PageError, PageLoading } from '@/components/ui/Loading'
import './progress.css'

export function ProgressPage() {
  const { data: p, error, isPending } = useQuery({ queryKey: ['progress'], queryFn: api.progress })
  const units = useUnits()
  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />

  const since = monthDay(p.start_date)
  const hasWeights = p.weight.points.some((x) => x.kg != null)

  return (
    <div className="page progress">
      <header className="page-head">
        <div>
          <h1>Progress</h1>
          <div className="sub">Since {since} · Week {p.week}{p.weeks ? ` of ${p.weeks}` : ''}</div>
        </div>
      </header>

      <div className="progress-grid">
        <section className="card weight-card">
          <div className="between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="muted">Weekly average weight</div>
              <b className="num big">{p.weight.current != null ? bodyWeight(p.weight.current, units) : '—'}</b>
            </div>
            {p.weight.change != null && <span className="pill good lg-pill">{weightChange(p.weight.change, units)} since {since}</span>}
          </div>
          {hasWeights ? (
            <LineChart
              points={pointsIn(p.weight.points, units)}
              unit={unitLabel(units)}
              goal={p.weight.goal != null ? bodyValue(p.weight.goal, units) : undefined}
              goalLabel={p.weight.goal != null ? `Goal ${bodyWeight(p.weight.goal, units)}` : undefined}
              height={220}
            />
          ) : (
            <p className="small muted">No weigh-ins yet. Log your morning weight from Home and your trend shows up here.</p>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Plan followed</h3>
            <span className="muted small">training and food, target {p.plan_target}%</span>
          </div>
          {p.plan.some((w) => w.pct != null) ? (
            <PlanBars weeks={p.plan} target={p.plan_target} />
          ) : (
            <p className="small muted">Log meals and workouts this week to see how closely you're following your plan.</p>
          )}
        </section>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <section className="card stat-card">
            <div className="muted">Waist</div>
            {p.waist ? (
              <>
                <b className="num">{inches(p.waist.cm)}</b>
                <span className="good small strong-600">{delta(cmToIn(p.waist.change), 'in')} since {since}</span>
              </>
            ) : (
              <span className="small muted">Measured in your weekly check-in.</span>
            )}
          </section>
          <section className="card stat-card">
            {p.lift ? (
              <>
                <div className="muted">{p.lift.exercise}, {p.lift.reps} reps</div>
                <b className="num">{loadWeight(p.lift.kg, units)}</b>
                <span className="good small strong-600">{weightChange(p.lift.change, units)} since your first session</span>
              </>
            ) : (
              <>
                <div className="muted">Best lift</div>
                <span className="small muted">Shows up once you log workouts.</span>
              </>
            )}
          </section>
        </div>

        {p.coach_note && (
          <section className="card dark coach-note-p">
            <div className="row">
              <span className="avatar gold">{p.coach_note.coach.initials}</span>
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
    </div>
  )
}
