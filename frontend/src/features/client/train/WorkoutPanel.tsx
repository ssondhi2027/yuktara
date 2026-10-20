import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, Plus } from 'lucide-react'
import { api, TRAINING_KEYS, type PlannedWorkout, type TrainWeek, type WorkoutSummary } from '@/lib/api'
import { monthDay, shortDay, weekday } from '@/lib/dates'
import { MUSCLE_LABEL } from '@/lib/muscles'
import { SKIP_REASONS, volumeLabel } from '@/lib/workouts'
import { Sheet } from '@/components/ui/Sheet'
import { useIsGuest } from '@/components/guest/Guest'

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
  const guest = useIsGuest()
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
  } else if (todays && todays.status !== 'done' && todays.status !== 'skipped') {
    title = `${todays.name} · ${todays.exercises.length} exercises`
    action = <button className="btn btn-gold btn-lg" disabled={pending} onClick={() => start(todays.template_id)}>{pending ? 'Starting…' : compact ? 'Start' : 'Start workout'}</button>
  } else {
    title = todays ? `${todays.name} · ${todays.status === 'skipped' ? 'skipped' : 'done'}`
      : data.has_program ? 'Rest day'
        : data.next_program ? `${data.next_program.name} starts ${shortDay(data.next_program.start_date)}`
          : guest ? 'Log a workout of your own' : 'Your coach is setting up your plan'
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
  skipped: { text: 'Skipped', cls: 'awaiting' },
}

/** Skip a planned workout, with an optional reason the coach sees. */
function SkipSheet({ p, today, onClose }: { p: PlannedWorkout; today: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const skip = useMutation({
    mutationFn: () => api.skipWorkout(p.template_id, p.date ?? today, reason),
    onSuccess: () => {
      TRAINING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }))
      onClose()
    },
  })
  return (
    <Sheet title={`Skip ${p.name}?`} onClose={onClose}>
      <p className="small muted">It shows as skipped instead of missed, and your coach sees why. You can still do it later this week.</p>
      <div className="picker-muscles" role="group" aria-label="Reason">
        {SKIP_REASONS.map((r) => (
          <button key={r} type="button" className="chip-btn" aria-pressed={reason === r} onClick={() => setReason(reason === r ? '' : r)}>{r}</button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="skip-reason">Reason (optional)</label>
        <input id="skip-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="A word for your coach" />
      </div>
      {skip.error && <div role="alert" className="auth-note err">{skip.error.message}</div>}
      <button type="button" className="btn btn-primary" disabled={skip.isPending} onClick={() => skip.mutate()}>{skip.isPending ? 'Saving…' : 'Skip workout'}</button>
    </Sheet>
  )
}

/** The rest of this week's plan (catch up on a missed day, or do another one), plus recent sessions. */
export function WorkoutWeek({ data }: { data: TrainWeek }) {
  const guest = useIsGuest()
  const { start, pending, error } = useStart()
  const qc = useQueryClient()
  const busy = !!data.open_workout
  const [skipping, setSkipping] = useState<PlannedWorkout | null>(null)
  const undo = useMutation({
    mutationFn: (id: string) => api.undoSkip(id),
    onSuccess: () => TRAINING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] })),
  })

  return (
    <div className="workout-week">
      <section className="card">
        <div className="card-head">
          <h2>This week's workouts</h2>
          {data.plan.length > 0 && <span className="small muted">{data.plan.filter((p) => p.status === 'done').length} of {data.plan.length} done</span>}
        </div>
        {data.plan.length === 0 ? (
          <p className="small muted">
            {data.has_program ? 'No workouts planned this week.'
              : data.next_program ? `Your program starts ${shortDay(data.next_program.start_date)}.`
                : guest ? 'Programs come from a coach.' : 'Your coach is setting up your plan.'} You can still log your own workouts.
          </p>
        ) : (
          <ul className="plan-list">
            {data.plan.map((p) => (
              <li key={p.template_id} className={`plan-item${p.status === 'today' || p.status === 'in_progress' ? ' now' : ''}`}>
                <div className="plan-day">{p.date ? weekday(p.date) : '—'}</div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <b className="truncate">{p.name}</b>
                  <div className="xs muted truncate">
                    {p.status === 'skipped' ? `Skipped${p.skip_reason ? ` · ${p.skip_reason}` : ''}` : p.exercises.map((x) => x.name).join(' · ') || 'No exercises yet'}
                  </div>
                </div>
                <span className={`pill ${STATUS[p.status].cls}`}>{p.status === 'done' && <Check size={12} />}{STATUS[p.status].text}</span>
                {p.status === 'skipped' && p.session_id ? (
                  <button className="btn btn-ghost btn-sm" disabled={undo.isPending} onClick={() => undo.mutate(p.session_id!)}>Undo</button>
                ) : p.session_id ? (
                  <Link className="btn btn-ghost btn-sm" to={`/train/workout/${p.session_id}`}>{p.status === 'in_progress' ? 'Resume' : 'View'}</Link>
                ) : (
                  <span className="row" style={{ gap: 2 }}>
                    <button className="btn btn-ghost btn-sm" disabled={busy || pending || !p.exercises.length} onClick={() => start(p.template_id)}
                      title={busy ? 'Finish your open workout first' : undefined}>
                      Start
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSkipping(p)} aria-label={`Skip ${p.name}`}>Skip</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {busy && data.plan.some((p) => !p.session_id) && <p className="xs muted" style={{ marginTop: 10 }}>Finish or discard your open workout to start another.</p>}
        {error && <div role="alert" className="auth-note err" style={{ marginTop: 10 }}>{error}</div>}
        {undo.error && <div role="alert" className="auth-note err" style={{ marginTop: 10 }}>{undo.error.message}</div>}
        {skipping && <SkipSheet p={skipping} today={data.today} onClose={() => setSkipping(null)} />}
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
  if (w.skipped) {
    return (
      <li className="recent-row skipped">
        <div className="grow" style={{ minWidth: 0 }}>
          <b>{w.name}</b> <span className="small muted">· {weekday(w.performed_on)} {monthDay(w.performed_on)}</span>
          <div className="xs muted truncate">Skipped{w.notes ? ` · ${w.notes}` : ''}</div>
        </div>
      </li>
    )
  }
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
