import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { Check, ChevronRight, Plus } from 'lucide-react'
import { api, type PlannedWorkout, type TrainWeek, type WorkoutSummary } from '@/lib/api'
import { monthDay, weekday } from '@/lib/dates'
import { MUSCLE_LABEL } from '@/lib/muscles'
import { volumeLabel } from '@/lib/workouts'

/** Starts (or resumes) a workout and opens the logging screen. */
function useStart() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const start = useMutation({
    mutationFn: (templateId: string | null) => api.startWorkout(templateId),
    onSuccess: ({ id }) => navigate(`/train/workout/${id}`),
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not start the workout.'),
  })
  return { start: (id: string | null) => { setError(null); start.mutate(id) }, pending: start.isPending, error }
}

/** Today's workout: resume an open one, start today's plan, or log your own. */
export function TodayCard({ data, compact }: { data: TrainWeek; compact: boolean }) {
  const { start, pending, error } = useStart()
  const open = data.open_workout
  const todays = data.plan.find((p) => p.date === data.today)

  let label = 'Today'
  let title: string
  let action: React.ReactNode
  if (open) {
    label = open.performed_on === data.today ? 'In progress' : `Unfinished · ${monthDay(open.performed_on)}`
    title = `${open.name} · ${open.sets_done} ${open.sets_done === 1 ? 'set' : 'sets'} logged`
    action = <Link to={`/train/workout/${open.id}`} className="btn btn-gold btn-lg">{compact ? 'Resume' : 'Resume workout'}</Link>
  } else if (todays && todays.status !== 'done') {
    title = `${todays.name} · ${todays.exercises.length} exercises`
    action = <button className="btn btn-gold btn-lg" disabled={pending} onClick={() => start(todays.template_id)}>{pending ? 'Starting…' : compact ? 'Start' : 'Start workout'}</button>
  } else {
    title = todays ? `${todays.name} · done` : data.has_program ? 'Rest day' : 'Your coach is setting up your plan'
    action = <button className="btn btn-outline btn-lg today-own" disabled={pending} onClick={() => start(null)}>{compact ? 'Log' : 'Log a workout'}</button>
  }

  return (
    <section className="today-bar">
      <div className="grow">
        <div className="small" style={{ opacity: 0.8 }}>{label}</div>
        <b className="today-sets">{title}</b>
        {error && <div role="alert" className="small today-error">{error}</div>}
      </div>
      {action}
    </section>
  )
}

const STATUS: Record<PlannedWorkout['status'], { text: string; cls: string }> = {
  done: { text: 'Done', cls: 'good' },
  in_progress: { text: 'In progress', cls: 'gold' },
  today: { text: 'Today', cls: 'gold' },
  missed: { text: 'Missed', cls: 'warn' },
  upcoming: { text: 'Coming up', cls: 'awaiting' },
  anytime: { text: 'Any day', cls: 'awaiting' },
}

/** The rest of this week's plan (catch up on a missed day, or do another one), plus recent sessions. */
export function WorkoutWeek({ data }: { data: TrainWeek }) {
  const { start, pending, error } = useStart()
  const busy = !!data.open_workout

  return (
    <div className="workout-week">
      <section className="card">
        <div className="card-head">
          <h2>This week's workouts</h2>
          {data.plan.length > 0 && <span className="small muted">{data.plan.filter((p) => p.status === 'done').length} of {data.plan.length} done</span>}
        </div>
        {data.plan.length === 0 ? (
          <p className="small muted">
            {data.has_program ? 'No workouts planned this week.' : 'Your coach is setting up your plan.'} You can still log your own workouts.
          </p>
        ) : (
          <ul className="plan-list">
            {data.plan.map((p) => (
              <li key={p.template_id} className={`plan-item${p.status === 'today' || p.status === 'in_progress' ? ' now' : ''}`}>
                <div className="plan-day">{p.date ? weekday(p.date) : '—'}</div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <b className="truncate">{p.name}</b>
                  <div className="xs muted truncate">{p.exercises.map((x) => x.name).join(' · ') || 'No exercises yet'}</div>
                </div>
                <span className={`pill ${STATUS[p.status].cls}`}>{p.status === 'done' && <Check size={12} />}{STATUS[p.status].text}</span>
                {p.session_id ? (
                  <Link className="btn btn-ghost btn-sm" to={`/train/workout/${p.session_id}`}>{p.status === 'in_progress' ? 'Resume' : 'View'}</Link>
                ) : (
                  <button className="btn btn-ghost btn-sm" disabled={busy || pending || !p.exercises.length} onClick={() => start(p.template_id)}
                    title={busy ? 'Finish your open workout first' : undefined}>
                    Start
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {busy && data.plan.some((p) => !p.session_id) && <p className="xs muted" style={{ marginTop: 10 }}>Finish or discard your open workout to start another.</p>}
        {error && <div role="alert" className="auth-note err" style={{ marginTop: 10 }}>{error}</div>}
        {!busy && (
          <button className="btn btn-ghost btn-block" style={{ marginTop: 14 }} disabled={pending} onClick={() => start(null)}>
            <Plus size={18} /> Log your own workout
          </button>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>Recent workouts</h2></div>
        {data.recent.length === 0
          ? <p className="small muted">Finished workouts show up here, with sets, volume and the muscles you hit.</p>
          : <ul className="list-rows">{data.recent.map((w) => <RecentRow key={w.id} w={w} units={data.units} />)}</ul>}
      </section>
    </div>
  )
}

function RecentRow({ w, units }: { w: WorkoutSummary; units: TrainWeek['units'] }) {
  return (
    <li>
      <Link to={`/train/workout/${w.id}`} className="recent-row">
        <div className="grow" style={{ minWidth: 0 }}>
          <b>{w.name}</b> <span className="small muted">· {weekday(w.performed_on)} {monthDay(w.performed_on)}</span>
          <div className="xs muted truncate">
            {w.sets} sets{w.volume_kg > 0 ? ` · ${volumeLabel(w.volume_kg, units)}` : ''}{w.duration_min != null ? ` · ${w.duration_min} min` : ''}
            {w.muscles.length > 0 && ` · ${w.muscles.slice(0, 4).map((m) => MUSCLE_LABEL[m]).join(', ')}`}
          </div>
        </div>
        <ChevronRight size={16} className="faint" />
      </Link>
    </li>
  )
}
