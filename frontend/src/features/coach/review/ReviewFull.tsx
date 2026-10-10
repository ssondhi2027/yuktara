import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, PersonStanding } from 'lucide-react'
import { api, COACH_REFRESH, type CheckinReview, type Targets } from '@/lib/api'
import { clockTime, monthDay, today, toISODate, weekRange } from '@/lib/dates'
import { Avatar } from '@/components/ui/Avatar'
import { StatusPill } from '@/components/ui/StatusPill'
import { LineChart } from '@/components/charts/LineChart'
import { PairBars, ScaleBar } from '@/components/charts/Bars'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { GOAL_LABEL } from '@/lib/labels'
import { bodyValue, bodyWeight, pointsIn, unitLabel } from '@/lib/units'
import { useUnits } from '@/app/auth'
import { FeedbackBox } from './Feedback'
import { CoachAnswers, StatTiles } from './ReviewCompact'
import { EMPTY_TARGETS, TargetsForm } from '@/features/coach/clients/TargetsForm'

const TABS = ['check-in', 'Training', 'Nutrition', 'Progress', 'Past check-ins'] as const

/** Desktop check-in review (artboard "Check-in review"). */
export function ReviewFull({ id }: { id: string }) {
  const { data: r, error, isPending } = useQuery({ queryKey: ['review', id], queryFn: () => api.checkinReview(id), ...COACH_REFRESH })
  const [tab, setTab] = useState<(typeof TABS)[number]>('check-in')
  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />
  return <Review r={r} tab={tab} setTab={setTab} />
}

function Review({ r, tab, setTab }: { r: CheckinReview; tab: (typeof TABS)[number]; setTab: (t: (typeof TABS)[number]) => void }) {
  const units = useUnits()
  // null = leave targets as they are; set = new targets from next Monday
  const [targets, setTargets] = useState<Targets | null>(r.targets)
  const status = r.status == null ? null : r.status === 'on_track' ? 'on_track' : r.status === 'slipping' ? 'slipping' : 'overdue'
  const submittedDay = r.submitted_at ? toISODate(new Date(r.submitted_at)) : null

  return (
    <div className="page review-full">
      <div className="between">
        <Link to="/coach" className="back-link"><ChevronLeft size={18} /> Review queue</Link>
        {r.queue_position > 0 && (
          <div className="row small muted" style={{ gap: 8 }}>
            {r.queue_position} of {r.queue_total} to review
            <Link to={r.prev_id ? `/coach/check-ins/${r.prev_id}` : '#'} aria-disabled={!r.prev_id} className={`icon-btn${r.prev_id ? '' : ' disabled'}`} aria-label="Previous check-in"><ChevronLeft size={18} /></Link>
            <Link to={r.next_id ? `/coach/check-ins/${r.next_id}` : '#'} aria-disabled={!r.next_id} className={`icon-btn${r.next_id ? '' : ' disabled'}`} aria-label="Next check-in"><ChevronRight size={18} /></Link>
          </div>
        )}
      </div>

      <header className="between review-head">
        <div className="row">
          <Avatar person={r.client} size="lg" />
          <div>
            <h1>{r.client.full_name}</h1>
            <div className="row small muted" style={{ gap: 8, flexWrap: 'wrap' }}>
              {r.goal ? GOAL_LABEL[r.goal] : 'Goal not set'} · Week {r.week}{r.weeks ? ` of ${r.weeks}` : ''} · Started {monthDay(r.start_date)} · Checks in {r.check_in_weekday}
              {status && <StatusPill status={status} />}
            </div>
          </div>
        </div>
      </header>

      <nav className="tabs-line" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'check-in' ? `Week ${r.week} check-in` : t}
          </button>
        ))}
      </nav>

      {tab !== 'check-in' ? (
        <div className="card placeholder"><p>{tab} for {r.client.first_name} is not built yet.</p></div>
      ) : (
        <div className="review-cols">
          <div className="stack" style={{ gap: 16 }}>
            <section className="card">
              <div className="card-head">
                <h2>Week {r.week} · {weekRange(r.week_start)}</h2>
                {submittedDay && (
                  <span className="small muted">Submitted {submittedDay === today() ? 'today' : monthDay(submittedDay)} at {clockTime(r.submitted_at)}</span>
                )}
              </div>
              <StatTiles r={r} inset />
              <div className="score-grid">
                {([
                  ['Energy', r.energy, r.energy != null && r.energy <= 2],
                  ['Sleep quality', r.sleep, r.sleep != null && r.sleep <= 3],
                  ['Stress', r.stress, r.stress != null && r.stress >= 4],
                  ['Hunger', r.hunger, r.hunger != null && r.hunger >= 4],
                ] as const).map(([l, v, warn]) => (
                  <div key={l}>
                    <div className="between small"><span>{l}</span><b className={warn ? 'bad' : undefined}>{v ?? '—'} / 5</b></div>
                    <ScaleBar value={v ?? 0} tone={warn ? 'warn' : 'ink'} />
                  </div>
                ))}
              </div>
              <div className="grid grid-2" style={{ marginTop: 16 }}>
                <div><div className="eyebrow">Wins</div><p className="small" style={{ marginTop: 4 }}>{r.wins || '—'}</p></div>
                <div><div className="eyebrow">What was hard</div><p className="small" style={{ marginTop: 4 }}>{r.struggles || '—'}</p></div>
              </div>
              <CoachAnswers r={r} />
              {r.question && (
                <div className="question" style={{ marginTop: 14 }}>
                  <div className="eyebrow">Question for you</div>
                  <p>{r.question}</p>
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Weight across the program</h2>
                {r.projection_kg != null && (
                  <span className="small muted">
                    On pace for <b style={{ color: 'var(--ink)' }}>{bodyWeight(r.projection_kg, units)}</b> by week {r.weeks}{r.goal_kg != null ? ` · goal ${bodyWeight(r.goal_kg, units)}` : ''}
                  </span>
                )}
              </div>
              {r.weights.some((w) => w.kg != null) ? (
                <>
                  <LineChart points={pointsIn(r.weights, units)} unit={unitLabel(units)} goal={r.goal_kg != null ? bodyValue(r.goal_kg, units) : undefined}
                    projection={r.projection_kg != null ? bodyValue(r.projection_kg, units) : undefined} area={false} height={200} highlight={`W${r.week}`} />
                  <div className="legend-line xs muted">
                    <span><i className="ll solid" /> Weekly average</span>
                    {r.projection_kg != null && <span><i className="ll dashed" /> At current pace</span>}
                    {r.goal_kg != null && <span><i className="ll goal" /> Goal {bodyWeight(r.goal_kg, units)}</span>}
                  </div>
                </>
              ) : (
                <p className="small muted">No weigh-ins logged yet.</p>
              )}
              <hr className="rule" />
              <div className="between" style={{ marginBottom: 10 }}>
                <b className="small">Plan followed by week</b>
                <span className="xs muted row" style={{ gap: 12 }}>
                  <span className="row" style={{ gap: 4 }}><i className="sq training" /> Training</span>
                  <span className="row" style={{ gap: 4 }}><i className="sq food" /> Food</span>
                </span>
              </div>
              {r.plan_by_week.length ? (
                <PairBars weeks={r.plan_by_week} highlight={`W${r.week}`} />
              ) : (
                <p className="small muted">Weekly percentages appear after the first full week.</p>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Progress photos</h2>
              </div>
              <div className="photo-row">
                {r.photos.map((p) => (
                  <div key={p.pose} className={`review-photo${p.url ? '' : ' empty'}`}>
                    {p.url ? (
                      <>
                        {p.url === 'placeholder'
                          ? <PersonStanding size={34} strokeWidth={1.4} />
                          : <img src={p.url} alt={`${cap(p.pose)} photo, week ${r.week}`} className="review-photo-img" />}
                        <span className="xs strong photo-caption">{cap(p.pose)} · week {r.week}</span>
                      </>
                    ) : (
                      <>
                        <b className="small">{cap(p.pose)}</b>
                        <span className="xs muted">Not added this week</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="stack" style={{ gap: 16 }}>
            <FeedbackBox r={r} targets={targets} />
            <TargetsCard r={r} targets={targets} setTargets={setTargets} />
            {r.suggestion && <Suggestion r={r} />}
            <PrivateNotes r={r} />
          </div>
        </div>
      )}
    </div>
  )
}

function TargetsCard({ r, targets, setTargets }: { r: CheckinReview; targets: Targets | null; setTargets: (t: Targets | null) => void }) {
  return (
    <section className="card stack">
      <h2>Targets for week {r.week + 1}</h2>
      {targets ? (
        <>
          <TargetsForm value={targets} onChange={setTargets} idPrefix="review" />
          <p className="xs muted">Sent with your feedback. They start next Monday, and {r.client.first_name} sees them on Home.</p>
        </>
      ) : (
        <>
          <p className="small muted">{r.client.first_name} has no targets yet.</p>
          <button type="button" className="btn btn-ghost btn-sm btn-square" style={{ alignSelf: 'flex-start' }}
            onClick={() => setTargets({ ...EMPTY_TARGETS, calories: 2000 })}>Set targets</button>
        </>
      )}
    </section>
  )
}

function Suggestion({ r }: { r: CheckinReview }) {
  const qc = useQueryClient()
  const apply = useMutation({
    mutationFn: () => api.applySuggestion(r.check_in_id, r.suggestion?.swap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review', r.check_in_id] }),
  })
  return (
    <section className="suggestion">
      <div className="eyebrow">{r.suggestion!.title}</div>
      <p className="small">{r.suggestion!.text}</p>
      <div className="row">
        <button className="btn btn-primary btn-sm btn-square" disabled={apply.isPending} onClick={() => apply.mutate()}>Apply swap</button>
        <button className="link small">Edit program</button>
      </div>
    </section>
  )
}

function PrivateNotes({ r }: { r: CheckinReview }) {
  const [notes, setNotes] = useState(r.private_notes)
  const save = useMutation({ mutationFn: (n: string) => api.saveReviewDraft(r.check_in_id, { private_notes: n }) })
  return (
    <section className="card">
      <div className="field">
        <label htmlFor="notes">Private notes, only you see these</label>
        <textarea id="notes" className="textarea notes" value={notes} onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== r.private_notes && save.mutate(notes)} />
      </div>
    </section>
  )
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
