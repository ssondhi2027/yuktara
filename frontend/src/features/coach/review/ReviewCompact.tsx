import { useQuery } from '@tanstack/react-query'
import { api, COACH_REFRESH, type CheckinReview } from '@/lib/api'
import { clockTime } from '@/lib/dates'
import { cmToIn, delta, inches } from '@/lib/units'
import { Avatar } from '@/components/ui/Avatar'
import { PageError } from '@/components/ui/Loading'
import { GOAL_LABEL } from '@/lib/labels'
import { FeedbackBox } from './Feedback'

/** Tablet right pane and phone detail: numbers, answers, feedback. */
export function ReviewCompact({ id }: { id: string }) {
  const { data: r, error } = useQuery({ queryKey: ['review', id], queryFn: () => api.checkinReview(id), ...COACH_REFRESH })
  if (error) return <PageError error={error} />
  if (!r) return <div className="skeleton" style={{ height: 480, margin: 24 }} />

  return (
    <div className="review-compact">
      <header className="row">
        <Avatar person={r.client} size="lg" />
        <div className="grow">
          <h1 style={{ fontSize: 28 }}>{r.client.full_name}</h1>
          <div className="muted small">
            {r.goal ? GOAL_LABEL[r.goal] : 'Goal not set'} · week {r.week}{r.weeks ? ` of ${r.weeks}` : ''}
            {r.submitted_at && ` · submitted ${clockTime(r.submitted_at)}`}
          </div>
        </div>
      </header>

      <StatTiles r={r} />

      <div className="compact-cols">
        <section className="card stack">
          <Scores r={r} />
          <hr className="rule" />
          <Answers r={r} />
        </section>
        <FeedbackBox r={r} targets={r.targets} compact />
      </div>
    </div>
  )
}

export function StatTiles({ r, inset }: { r: CheckinReview; inset?: boolean }) {
  const tiles = [
    {
      label: 'Average weight', value: r.avg_weight_kg != null ? `${r.avg_weight_kg} kg` : '—',
      sub: r.weight_change != null ? delta(r.weight_change) : 'First check-in', tone: r.weight_change != null && r.weight_change > 0 ? 'bad' : 'good',
    },
    {
      label: 'Waist', value: r.waist_cm != null ? inches(r.waist_cm) : '—',
      sub: r.waist_change != null ? delta(cmToIn(r.waist_change), 'in') : r.waist_cm != null ? 'First measurement' : 'Not measured', tone: 'good',
    },
    {
      label: 'Training', value: r.workouts_planned ? `${r.workouts_done} of ${r.workouts_planned}` : String(r.workouts_done),
      sub: r.workouts_planned ? r.skipped_note ?? 'All done' : 'No plan yet', tone: r.skipped_note ? 'bad' : 'good',
    },
    {
      label: 'Meals on plan', value: r.meals_pct != null ? `${r.meals_pct}%` : '—',
      sub: r.meals_planned ? `${r.meals_on_plan} of ${r.meals_planned}` : 'No meals logged', tone: 'muted',
    },
  ]
  return (
    <div className="stat-tiles">
      {tiles.map((t) => (
        <div key={t.label} className={inset ? 'tile' : 'card tile-plain'}>
          <div className="xs muted">{t.label}</div>
          <b className="num tile-value">{t.value}</b>
          <div className={`xs strong ${t.tone}`}>{t.sub}</div>
        </div>
      ))}
    </div>
  )
}

export function Scores({ r, bars }: { r: CheckinReview; bars?: React.ReactNode }) {
  const rows = [
    { label: 'Energy', v: r.energy, warn: r.energy != null && r.energy <= 2 },
    { label: 'Sleep quality', v: r.sleep, warn: r.sleep != null && r.sleep <= 3 },
    { label: 'Stress', v: r.stress, warn: r.stress != null && r.stress >= 4 },
    { label: 'Hunger', v: r.hunger, warn: r.hunger != null && r.hunger >= 4 },
  ]
  return (
    <div className="scores">
      {rows.map((s) => (
        <div key={s.label} className="score">
          <div className="between small"><span>{s.label}</span><b className={s.warn ? 'bad' : undefined}>{s.v ?? '—'} / 5</b></div>
          {bars && <div className="score-bar">{bars}</div>}
        </div>
      ))}
    </div>
  )
}

export function Answers({ r }: { r: CheckinReview }) {
  return (
    <div className="answers">
      <div>
        <div className="eyebrow">Wins</div>
        <p>{r.wins || '—'}</p>
      </div>
      <div>
        <div className="eyebrow">What was hard</div>
        <p>{r.struggles || '—'}</p>
      </div>
      <CoachAnswers r={r} />
      {r.question && (
        <div className="question">
          <div className="eyebrow">Question for you</div>
          <p>{r.question}</p>
        </div>
      )}
    </div>
  )
}

/** Answers to the coach's own check-in questions. */
export function CoachAnswers({ r }: { r: CheckinReview }) {
  if (!r.answers.length) return null
  return (
    <dl className="coach-answers">
      {r.answers.map((a) => (
        <div key={a.prompt}><dt>{a.prompt}</dt><dd>{a.value || '—'}</dd></div>
      ))}
    </dl>
  )
}
