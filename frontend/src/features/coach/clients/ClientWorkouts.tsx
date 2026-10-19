import { useQuery } from '@tanstack/react-query'
import { api, COACH_REFRESH } from '@/lib/api'
import { monthDay, weekday } from '@/lib/dates'
import { MUSCLE_LABEL } from '@/lib/muscles'
import { setsLine, supersetLine, volumeLabel } from '@/lib/workouts'
import { useUnits } from '@/app/auth'

/** The client's logged workouts, read-only (RLS doesn't let the coach change them). Weights in the coach's own unit. */
export function ClientWorkouts({ clientId, firstName }: { clientId: string; firstName: string }) {
  const units = useUnits()
  const { data, error } = useQuery({ queryKey: ['client-workouts', clientId], queryFn: () => api.clientWorkouts(clientId), ...COACH_REFRESH })

  return (
    <section className="stack client-workouts" style={{ gap: 8 }}>
      <div className="between">
        <h3>Workouts</h3>
        <span className="xs muted">Logged by {firstName}, read-only</span>
      </div>
      {error && <p className="small muted">{error.message}</p>}
      {!data && !error && <div className="skeleton" style={{ height: 80 }} />}
      {data?.length === 0 && <p className="small muted">No workouts logged yet.</p>}
      {data && data.length > 0 && (
        <ul className="list-rows">
          {data.map((w) => w.skipped ? (
            <li key={w.id}>
              <b>{w.name}</b> <span className="small muted">· {weekday(w.performed_on)} {monthDay(w.performed_on)}</span>
              <span className="pill awaiting" style={{ marginLeft: 8 }}>Skipped</span>
              {w.notes && <div className="xs muted">Reason: {w.notes}</div>}
            </li>
          ) : (
            <li key={w.id}>
              <details>
                <summary>
                  <b>{w.name}</b> <span className="small muted">· {weekday(w.performed_on)} {monthDay(w.performed_on)}</span>
                  {!w.finished && <span className="pill gold" style={{ marginLeft: 8 }}>In progress</span>}
                  <div className="xs muted">
                    {w.sets} sets{w.volume_kg > 0 ? ` · ${volumeLabel(w.volume_kg, units)}` : ''}{w.duration_min != null ? ` · ${w.duration_min} min` : ''}{w.effort != null ? ` · effort ${w.effort}/10` : ''}
                    {w.muscles.length > 0 && ` · ${w.muscles.map((m) => MUSCLE_LABEL[m]).join(', ')}`}
                  </div>
                </summary>
                {w.supersets.map((g) => <div key={g.join('+')} className="xs muted">{supersetLine(g)}</div>)}
                <dl className="answers-list workout-detail">
                  {w.exercises.map((e) => <div key={e.name}><dt>{e.name}</dt><dd>{setsLine(e.sets, units)}</dd></div>)}
                  {w.notes && <div><dt>Note</dt><dd>{w.notes}</dd></div>}
                </dl>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
