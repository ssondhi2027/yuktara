import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, MessageSquare, Search } from 'lucide-react'
import { api, COACH_REFRESH, type CoachClientRow } from '@/lib/api'
import { localDay, monthDay, shortDay, weekday } from '@/lib/dates'
import { GOAL_LABEL, WEEKDAY_LABEL } from '@/lib/labels'
import { bodyWeight, pointsIn, unitLabel } from '@/lib/units'
import type { ClientStatus, GoalType } from '@/types/db'
import { useLayout } from '@/app/hooks'
import { useUnits } from '@/app/auth'
import { Avatar } from '@/components/ui/Avatar'
import { LineChart } from '@/components/charts/LineChart'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { ClientWorkouts } from './ClientWorkouts'
import { SetupAnswersList } from './SetupAnswers'
import '@/features/coach/review/review.css'
import '@/features/coach/dashboard/dashboard.css'
import './clients.css'

const STATUS_LABEL: Record<ClientStatus, string> = { active: 'Active', paused: 'Paused', archived: 'Archived' }
const STATUS_PILL: Record<ClientStatus, string> = { active: 'on-track', paused: 'awaiting', archived: 'overdue' }
const CHECKIN_LABEL = { due: 'Due', submitted: 'Waiting for review', reviewed: 'Reviewed', missed: 'Missed' } as const
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** Keys for everything that shows a client's status, check-in day or notes. */
const CLIENT_KEYS = [['coach-clients'], ['client-history'], ['client-detail'], ['coach-dashboard'], ['checkin-lists'], ['program-clients'], ['nutrition-rows']]

/**
 * /coach/clients and /coach/clients/:clientId
 *  tablet and desktop — list on the left, the client on the right
 *  phone  — list, then the client as its own screen
 */
export function ClientsPage() {
  const { clientId } = useParams()
  const layout = useLayout()
  const detail = clientId ? <ClientView id={clientId} key={clientId} /> : null
  if (layout === 'phone') {
    return detail ? (
      <div className="page">
        <Link to="/coach/clients" className="back-link"><ChevronLeft size={18} /> Clients</Link>
        {detail}
      </div>
    ) : <div className="page"><ClientList /></div>
  }
  return (
    <div className="split clients-split">
      <aside className="split-list"><ClientList selected={clientId} /></aside>
      <div className="split-detail">
        {detail ?? <div className="builder-pick"><b>Pick a client</b><p className="small muted">Their answers, program, targets, check-ins, weight and your private notes.</p></div>}
      </div>
    </div>
  )
}

type StatusFilter = 'current' | ClientStatus | 'all'
type Sort = 'name' | 'activity' | 'week'

function ClientList({ selected }: { selected?: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ['coach-clients'], queryFn: api.coachClients, ...COACH_REFRESH })
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('current')
  const [goal, setGoal] = useState<GoalType | ''>('')
  const [sort, setSort] = useState<Sort>('name')

  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return (data ?? [])
      .filter((c) => (status === 'all' ? true : status === 'current' ? c.status !== 'archived' : c.status === status))
      .filter((c) => !goal || c.goal === goal)
      .filter((c) => words.every((w) => c.client.full_name.toLowerCase().includes(w)))
      .sort((a, b) => sort === 'activity' ? (b.last_activity ?? '').localeCompare(a.last_activity ?? '')
        : sort === 'week' ? b.week - a.week
          : a.client.full_name.localeCompare(b.client.full_name))
  }, [data, q, status, goal, sort])

  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />
  const archived = data.filter((c) => c.status === 'archived').length

  return (
    <div className="stack client-list">
      <header>
        <h1>Clients</h1>
        <div className="muted small">{data.length - archived} current{archived ? ` · ${archived} archived` : ''}</div>
      </header>
      <label className="search-field">
        <Search size={16} />
        <input className="input" type="search" placeholder="Search by name" aria-label="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="list-filters">
        <select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="current">Active and paused</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <select className="input" aria-label="Goal" value={goal} onChange={(e) => setGoal(e.target.value as GoalType | '')}>
          <option value="">Any goal</option>
          {(Object.keys(GOAL_LABEL) as GoalType[]).map((g) => <option key={g} value={g}>{GOAL_LABEL[g]}</option>)}
        </select>
        <select className="input" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="name">Name</option>
          <option value="activity">Last activity</option>
          <option value="week">Program week</option>
        </select>
      </div>
      {data.length === 0 && <p className="small muted">No clients yet. Share your invite code (Settings).</p>}
      {data.length > 0 && list.length === 0 && <p className="small muted">No clients match these filters.</p>}
      <ul className="list-plain" style={{ gap: 6 }}>
        {list.map((c) => <ClientRow key={c.client.id} c={c} selected={c.client.id === selected} />)}
      </ul>
    </div>
  )
}

function ClientRow({ c, selected }: { c: CoachClientRow; selected: boolean }) {
  return (
    <li>
      <Link to={`/coach/clients/${c.client.id}`} className={`program-row link-row${selected ? ' selected' : ''}`} aria-current={selected ? 'page' : undefined}>
        <Avatar person={c.client} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <b className="truncate">{c.client.full_name}</b>
            {c.status !== 'active' && <span className={`pill ${STATUS_PILL[c.status]}`}>{STATUS_LABEL[c.status]}</span>}
          </div>
          <div className="xs muted truncate">
            {[c.goal ? GOAL_LABEL[c.goal] : 'Setup not finished', `week ${c.week}`, c.program?.name ?? 'No program'].join(' · ')}
          </div>
          <div className="xs muted truncate">
            {c.has_targets ? 'Targets set' : <span className="bad">No targets</span>}
            {' · '}{c.last_check_in ? `Check-in ${monthDay(c.last_check_in.week_start)}: ${CHECKIN_LABEL[c.last_check_in.status].toLowerCase()}` : 'No check-ins yet'}
            {' · '}{c.last_activity ? `active ${shortDay(c.last_activity)}` : 'no logs yet'}
          </div>
        </div>
      </Link>
    </li>
  )
}

function ClientView({ id }: { id: string }) {
  const qc = useQueryClient()
  const units = useUnits()
  const detail = useQuery({ queryKey: ['client-detail', id], queryFn: () => api.clientDetail(id), ...COACH_REFRESH })
  const history = useQuery({ queryKey: ['client-history', id], queryFn: () => api.clientHistory(id), ...COACH_REFRESH })
  const rows = useQuery({ queryKey: ['coach-clients'], queryFn: api.coachClients, ...COACH_REFRESH })
  const [notes, setNotes] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { if (history.data && notes === null) setNotes(history.data.notes) }, [history.data, notes])

  const refresh = () => CLIENT_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }))
  const fail = (e: unknown) => setMessage(e instanceof Error ? e.message : 'Could not save. Try again.')
  const status = useMutation({ mutationFn: (s: ClientStatus) => api.setClientStatus(id, s), onSuccess: (_, s) => { refresh(); setMessage(`Marked ${STATUS_LABEL[s].toLowerCase()}.`) }, onError: fail })
  const day = useMutation({ mutationFn: (d: number) => api.setCheckInDay(id, d), onSuccess: () => { refresh(); setMessage('Check-in day saved. It applies from the next check-in.') }, onError: fail })
  const saveNotes = useMutation({ mutationFn: (n: string) => api.setCoachNotes(id, n), onSuccess: () => qc.invalidateQueries({ queryKey: ['client-history', id] }), onError: fail })

  if (detail.isPending || history.isPending) return <PageLoading />
  if (detail.error) return <PageError error={detail.error} />
  if (history.error) return <PageError error={history.error} />
  const c = detail.data
  const h = history.data
  const row = rows.data?.find((r) => r.client.id === id)
  const current: ClientStatus = row?.status ?? 'active'
  const hasWeights = h.weights.some((w) => w.kg != null)
  const latest = [...h.weights].reverse().find((w) => w.kg != null)

  return (
    <div className="client-view stack" style={{ gap: 16 }}>
      <header className="between" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 12 }}>
          <Avatar person={c.client} size="lg" />
          <div>
            <h1 style={{ fontSize: 28 }}>{c.client.full_name}</h1>
            <div className="small muted">
              <span className={`pill ${STATUS_PILL[current]}`}>{STATUS_LABEL[current]}</span>
              {' '}{c.goal ? GOAL_LABEL[c.goal] : 'Setup not finished'} · week {c.week}
              {h.last_activity && ` · last active ${shortDay(h.last_activity)}`}
            </div>
          </div>
        </div>
        <Link to={`/coach/messages/${id}`} className="btn btn-ghost btn-sm"><MessageSquare size={16} /> Message {c.client.first_name}</Link>
      </header>

      {message && <div role="status" className="auth-note ok" style={{ marginTop: 0 }}>{message}</div>}

      <section className="card stack" style={{ gap: 12 }}>
        <h3>Coaching</h3>
        <div className="coach-controls">
          <div className="field">
            <span className="xs muted">Status</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {current !== 'active' && <button type="button" className="btn btn-primary btn-sm" disabled={status.isPending} onClick={() => status.mutate('active')}>Reactivate</button>}
              {current === 'active' && <button type="button" className="btn btn-ghost btn-sm" disabled={status.isPending} onClick={() => status.mutate('paused')}>Pause</button>}
              {current !== 'archived' && <button type="button" className="btn btn-ghost btn-sm" disabled={status.isPending} onClick={() => status.mutate('archived')}>Archive</button>}
            </div>
            <span className="xs muted">Paused and archived clients get no new check-ins. Archived clients leave the dashboard.</span>
          </div>
          <div className="field">
            <label htmlFor="ci-day" className="xs muted">Check-in day</label>
            <select id="ci-day" className="input" value={c.check_in_day} disabled={day.isPending} onChange={(e) => day.mutate(Number(e.target.value))}>
              {DAY_ORDER.map((d) => <option key={d} value={d}>{WEEKDAY_LABEL[d]}</option>)}
            </select>
          </div>
        </div>
        <div className="sheet-program">
          <div className="between" style={{ gap: 12 }}>
            <span className="small"><span className="muted">Program: </span>{c.program ? <b>{c.program.name}{c.program.week ? ` · week ${Math.min(c.program.week, c.program.weeks)} of ${c.program.weeks}` : ''}</b> : 'none yet'}</span>
            <Link to={c.program ? `/coach/programs/${c.program.id}` : c.draft_program_id ? `/coach/programs/${c.draft_program_id}` : `/coach/programs/new/${id}`} className="btn btn-ghost btn-sm">
              {c.program ? 'Edit program' : c.draft_program_id ? 'Open draft' : 'Create program'}
            </Link>
          </div>
          <div className="between" style={{ gap: 12 }}>
            <span className="small"><span className="muted">Targets: </span>{c.targets ? <b>{c.targets.calories.toLocaleString('en-US')} kcal · P {c.targets.protein_g} · C {c.targets.carbs_g} · F {c.targets.fat_g}</b> : <span className="bad">none yet</span>}</span>
            <Link to={`/coach/nutrition/${id}`} className="btn btn-ghost btn-sm">{c.targets ? 'Edit targets' : 'Set targets'}</Link>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h3>Weight</h3>{latest?.kg != null && <span className="small muted">Latest week {bodyWeight(latest.kg, units)}</span>}</div>
        {hasWeights
          ? <LineChart points={pointsIn(h.weights, units)} unit={unitLabel(units)} height={160} area={false} />
          : <p className="small muted">No weigh-ins yet.</p>}
      </section>

      <section className="card">
        <div className="card-head"><h3>Check-ins</h3><span className="small muted">{WEEKDAY_LABEL[c.check_in_day]}s</span></div>
        {h.check_ins.length === 0 ? <p className="small muted">No check-ins yet.</p> : (
          <ul className="list-rows">
            {h.check_ins.map((ci) => (
              <li key={ci.id} className="between small" style={{ gap: 12 }}>
                <span>Week of {monthDay(ci.week_start)}{ci.submitted_at && <span className="muted"> · sent {weekday(localDay(ci.submitted_at))} {monthDay(localDay(ci.submitted_at))}</span>}</span>
                {ci.status === 'submitted' || ci.status === 'reviewed'
                  ? <Link className="link" to={`/coach/check-ins/${ci.id}`}>{ci.status === 'submitted' ? 'Review' : 'Open review'}</Link>
                  : <span className="muted">{CHECKIN_LABEL[ci.status]}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack" style={{ gap: 8 }}>
        <div className="between"><h3>Private notes</h3><span className="xs muted">Only you see these</span></div>
        <textarea className="textarea notes" aria-label="Private notes" maxLength={5000} value={notes ?? ''}
          onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== null && notes !== h.notes && saveNotes.mutate(notes)} />
        <span className="xs muted">{saveNotes.isPending ? 'Saving…' : saveNotes.isSuccess ? 'Saved' : 'Saves when you click away'}</span>
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <h3>Setup answers</h3>
        <p className="xs muted">The client's own answers; they change them on their Profile page.</p>
        <SetupAnswersList c={c} units={units} withCheckInDay={false} />
      </section>

      <section className="card"><ClientWorkouts clientId={id} firstName={c.client.first_name} /></section>
    </div>
  )
}
