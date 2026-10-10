import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Search } from 'lucide-react'
import { api, COACH_REFRESH, type CheckinLists, type QueueItem } from '@/lib/api'
import { monthDay, shortDay } from '@/lib/dates'
import { weightChange } from '@/lib/units'
import { useUnits } from '@/app/auth'
import type { UnitSystem } from '@/types/db'
import { useLayout } from '@/app/hooks'
import { Avatar } from '@/components/ui/Avatar'
import { StatusPill } from '@/components/ui/StatusPill'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { ReviewFull } from './ReviewFull'
import { ReviewCompact } from './ReviewCompact'
import './review.css'

type Tab = 'review' | 'not_in' | 'done'

/**
 * /coach/check-ins and /coach/check-ins/:id
 *  desktop — full review page for :id (list lives on the dashboard)
 *  tablet  — list on the left, compact review on the right
 *  phone   — list, then compact review as its own screen
 */
export function CheckinsPage() {
  const { id } = useParams()
  const layout = useLayout()
  const { data, error, isPending } = useQuery({ queryKey: ['checkin-lists'], queryFn: api.checkinLists, ...COACH_REFRESH })
  const [tab, setTab] = useState<Tab>('review')

  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />

  const first = data.to_review[0]?.check_in_id
  const list = <CheckinList data={data} tab={tab} setTab={setTab} selected={id} variant={layout === 'tablet' ? 'compact' : 'cards'} />

  if (layout === 'desktop') {
    if (!id) return first ? <Navigate to={`/coach/check-ins/${first}`} replace /> : <AllDone />
    return <ReviewFull id={id} key={id} />
  }

  if (layout === 'tablet') {
    const current = id ?? first
    return (
      <div className="split">
        <aside className="split-list">{list}</aside>
        <div className="split-detail">{current ? <ReviewCompact id={current} key={current} /> : <AllDone />}</div>
      </div>
    )
  }

  if (id) {
    return (
      <div className="page">
        <Link to="/coach/check-ins" className="back-link"><ChevronLeft size={18} /> Check-ins</Link>
        <ReviewCompact id={id} key={id} />
      </div>
    )
  }
  return <div className="page">{list}</div>
}

function CheckinList({ data, tab, setTab, selected, variant }: {
  data: CheckinLists
  tab: Tab
  setTab: (t: Tab) => void
  selected?: string
  variant: 'cards' | 'compact'
}) {
  const units = useUnits()
  const [more, setMore] = useState(false)
  const items = tab === 'review' ? data.to_review : tab === 'done' ? data.done : []
  const shown = variant === 'cards' && !more ? items.slice(0, 5) : items

  return (
    <div className="stack checkin-list">
      <header className="between" style={{ alignItems: 'flex-start' }}>
        <div>
          {variant === 'cards' && <div className="page-date">{shortDay(data.today)} · {data.checked_in} of {data.total} in</div>}
          <h1>Check-ins</h1>
          {variant === 'compact' && <div className="muted small">Week of {monthDay(data.week_start)} · {data.checked_in} of {data.total} in</div>}
        </div>
        {variant === 'cards' && <button className="icon-btn" aria-label="Search"><Search size={20} /></button>}
      </header>

      <div className="seg light block tabs3" role="tablist">
        {([['review', `To review ${data.to_review.length}`], ['not_in', `Not in ${data.not_in.length}`], ['done', `Done ${data.done.length}`]] as const).map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} aria-pressed={tab === v} onClick={() => setTab(v)}>{l}</button>
        ))}
      </div>

      {tab === 'not_in' ? (
        <ul className="list-plain">
          {data.not_in.map((n) => (
            <li key={n.client.id} className={variant === 'cards' ? 'card review-card' : 'compact-item'}>
              <div className="row">
                <Avatar person={n.client} size={variant === 'compact' ? 'sm' : undefined} />
                <div className="grow">
                  <b>{n.client.full_name}</b>
                  <div className="small muted">{n.due_label}</div>
                </div>
                <StatusPill status={n.status} />
              </div>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="muted" style={{ padding: 20 }}>{tab === 'review' ? 'All caught up.' : 'Nothing reviewed yet.'}</p>
      ) : variant === 'cards' ? (
        <ul className="list-plain">
          {shown.map((q) => <ReviewCard key={q.check_in_id} q={q} done={tab === 'done'} />)}
        </ul>
      ) : (
        <ul className="list-plain">
          {shown.map((q) => (
            <li key={q.check_in_id}>
              <Link to={`/coach/check-ins/${q.check_in_id}`} className={`compact-item${selected === q.check_in_id ? ' selected' : ''}`}>
                <Avatar person={q.client} size="sm" tone={q.flags.length ? 'peach' : undefined} />
                <div className="grow">
                  <div className="between"><b>{q.client.full_name}</b><span className="xs muted">{q.submitted_label.replace('Today ', '')}</span></div>
                  <div className={`xs ${q.flags.length ? 'bad strong' : q.has_question ? 'good strong' : 'muted'}`}>
                    {q.flags.length ? q.flags.join(' · ').toLowerCase().replace(/^./, (c) => c.toUpperCase())
                      : q.has_question ? 'Asked you a question' : queueFacts(q, units) || 'Ready to review'}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {variant === 'cards' && items.length > 5 && (
        <button className="link" style={{ alignSelf: 'center' }} onClick={() => setMore((m) => !m)}>
          {more ? 'Show fewer' : `Show ${items.length - 5} more`}
        </button>
      )}
    </div>
  )
}

function ReviewCard({ q, done }: { q: QueueItem; done: boolean }) {
  const units = useUnits()
  const urgent = q.flags.length > 0 || q.has_question
  return (
    <li className="card review-card">
      <div className="row">
        <Avatar person={q.client} tone={q.flags.length ? 'peach' : undefined} />
        <div className="grow">
          <b className="review-name">{q.client.full_name}</b>
          <div className="small muted">{[q.submitted_label.replace('Today ', ''), queueFacts(q, units)].filter(Boolean).join(' · ')}</div>
        </div>
        <Link to={`/coach/check-ins/${q.check_in_id}`} className={`btn btn-square ${urgent && !done ? 'btn-primary' : 'btn-outline'}`}>
          {done ? 'Open' : 'Review'}
        </Link>
      </div>
      {(q.flags.length > 0 || q.has_question) && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {q.flags.map((f) => <span key={f} className="pill warn">{f}</span>)}
          {q.has_question && <span className="pill good">Question for you</span>}
        </div>
      )}
    </li>
  )
}

function AllDone() {
  return (
    <div className="page placeholder">
      <h2>All caught up</h2>
      <p className="muted">Every check-in this week has been reviewed.</p>
      <Link to="/coach" className="btn btn-primary">Back to dashboard</Link>
    </div>
  )
}

const queueFacts = (q: QueueItem, units: UnitSystem) =>
  [q.plan_pct != null ? `plan ${q.plan_pct}%` : null, q.weight_change != null ? weightChange(q.weight_change, units) : null].filter(Boolean).join(' · ')
