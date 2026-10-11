import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Copy, Plus, Search } from 'lucide-react'
import { api, COACH_REFRESH, type ClientRow, type ClientWeekStatus, type QueueItem } from '@/lib/api'
import { longDay } from '@/lib/dates'
import { bodyValue, bodyWeight, delta, weightChange } from '@/lib/units'
import { useUnits } from '@/app/auth'
import { GOAL_LABEL } from '@/lib/labels'
import { Avatar } from '@/components/ui/Avatar'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill } from '@/components/ui/StatusPill'
import { MiniRing } from '@/components/charts/DayRing'
import { Sparkline } from '@/components/charts/Bars'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { ClientSheet } from '@/features/coach/clients/ClientSheet'
import './dashboard.css'

type QueueFilter = 'all' | 'flagged' | 'questions'
type ClientFilter = 'all' | ClientWeekStatus

export function CoachDashboardPage() {
  const { data, error, isPending } = useQuery({ queryKey: ['coach-dashboard'], queryFn: api.coachDashboard, ...COACH_REFRESH })
  const [qf, setQf] = useState<QueueFilter>('all')
  const [cf, setCf] = useState<ClientFilter>('all')
  const [showAllQueue, setShowAllQueue] = useState(false)
  const [showAllClients, setShowAllClients] = useState(false)
  const [search, setSearch] = useState('')
  const [openClient, setOpenClient] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)

  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />
  const d = data

  const flagged = d.queue.filter((q) => q.flags.length)
  const questions = d.queue.filter((q) => q.has_question)
  const queue = qf === 'flagged' ? flagged : qf === 'questions' ? questions : d.queue
  const visibleQueue = showAllQueue ? queue : queue.slice(0, 5)

  const count = (s: ClientWeekStatus) => d.clients.filter((c) => c.status === s).length
  const term = search.trim().toLowerCase()
  const clients = d.clients
    .filter((c) => cf === 'all' || c.status === cf)
    .filter((c) => !term || c.client.full_name.toLowerCase().includes(term))
  const visibleClients = showAllClients || term ? clients : clients.slice(0, 8)

  const names = d.stats.attention.map((p) => p.first_name)

  return (
    <div className="page coach-dash">
      <header className="page-head">
        <div>
          <div className="page-date">{longDay(d.today)}</div>
          <h1>{d.stats.waiting ? `${d.stats.waiting} check-in${d.stats.waiting === 1 ? '' : 's'} to review` : `Hello, ${d.coach.first_name}`}</h1>
        </div>
        <div className="row dash-actions">
          {d.clients.length > 0 && (
            <label className="search">
              <Search size={16} />
              <input placeholder="Search clients" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search clients" />
            </label>
          )}
          <button className="btn btn-primary btn-square add-client" onClick={() => setInviteOpen(true)} aria-label="Add client"><Plus size={18} /> <span className="hide-phone">Add client</span></button>
        </div>
      </header>

      {d.clients.length === 0 ? (
        <section className="card empty-roster">
          <h2>No clients yet</h2>
          <p className="muted">
            Clients join by creating an account in Yuktara with your invite code. They'll show up here as soon as they sign up.
          </p>
          <InviteCode code={d.invite_code} />
        </section>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="Active clients" value={String(d.stats.active)} sub={`${d.stats.new_this_month} started this month`} />
            <Stat label="Check-ins, last 7 days" value={String(d.stats.checked_in)} sub={`${d.stats.reviewed} reviewed · ${d.stats.waiting} waiting on you`} />
            <Stat
              label="Plan followed this week"
              value={d.stats.plan_pct != null ? `${d.stats.plan_pct}%` : '—'}
              sub={d.stats.plan_pct == null ? 'No meals or workouts logged yet' : d.stats.plan_change != null ? <b className="good">{delta(d.stats.plan_change, ' points')} on last week</b> : 'Across clients with logs'}
            />
            <Stat label="Need attention" value={<span className={names.length ? 'bad' : undefined}>{names.length}</span>} sub={names.length ? listNames(names) : 'Everyone is on track'} />
          </div>

          <div className="dash-two">
            <section className="card">
              <div className="card-head queue-head" style={{ marginBottom: 6 }}>
                <h2>Review queue</h2>
                <div className="row filter-row">
                  <FilterChip on={qf === 'all'} onClick={() => setQf('all')}>All {d.queue.length}</FilterChip>
                  <FilterChip on={qf === 'flagged'} onClick={() => setQf('flagged')}>Flagged {flagged.length}</FilterChip>
                  <FilterChip on={qf === 'questions'} onClick={() => setQf('questions')}>Questions {questions.length}</FilterChip>
                </div>
              </div>
              <p className="small muted" style={{ marginBottom: 6 }}>Flagged check-ins come first, then oldest first.</p>
              {queue.length === 0 ? (
                <p className="muted" style={{ padding: '24px 0' }}>Nothing waiting. Check-ins land here when clients send them.</p>
              ) : (
                <ul className="list-rows">
                  {visibleQueue.map((q) => <QueueRow key={q.check_in_id} q={q} />)}
                </ul>
              )}
              {queue.length > 5 && (
                <button className="link small" style={{ marginTop: 10 }} onClick={() => setShowAllQueue((s) => !s)}>
                  {showAllQueue ? 'Show fewer' : `Show ${queue.length - 5} more`}
                </button>
              )}
            </section>

            <section className="card">
              <h2 style={{ marginBottom: 14 }}>Needs attention</h2>
              {d.attention.length === 0 ? (
                <p className="muted">Nobody needs a nudge right now.</p>
              ) : (
                <div className="stack">
                  {d.attention.map((a) => (
                    <div key={a.client.id} className="attention">
                      <div className="between">
                        <b>{a.client.full_name}</b>
                        <StatusPill status={a.status} />
                      </div>
                      <p className="small">{a.text}</p>
                      <button className="btn btn-ghost btn-sm btn-square" style={{ alignSelf: 'flex-start' }} onClick={() => setOpenClient(a.client.id)}>
                        {a.action}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="card">
            <div className="card-head clients-head">
              <h2>Clients this week</h2>
              <div className="row filter-row">
                <FilterChip on={cf === 'all'} onClick={() => setCf('all')}>All {d.clients.length}</FilterChip>
                <FilterChip on={cf === 'on_track'} onClick={() => setCf('on_track')}>On track {count('on_track')}</FilterChip>
                <FilterChip on={cf === 'slipping'} onClick={() => setCf('slipping')}>Slipping {count('slipping')}</FilterChip>
                <FilterChip on={cf === 'overdue'} onClick={() => setCf('overdue')}>Overdue {count('overdue')}</FilterChip>
                <FilterChip on={cf === 'awaiting'} onClick={() => setCf('awaiting')}>Awaiting {count('awaiting')}</FilterChip>
              </div>
            </div>
            <div className="table-wrap">
              <table className="clients-table">
                <thead>
                  <tr>
                    <th>Client</th><th>Days logged</th><th>Training</th><th>Food on plan</th>
                    <th>Weight, 6 weeks</th><th>Last check-in</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleClients.map((c) => <ClientTr key={c.client.id} c={c} onOpen={() => setOpenClient(c.client.id)} />)}
                </tbody>
              </table>
            </div>
            {!term && clients.length > 8 && (
              <button className="link small" style={{ marginTop: 12 }} onClick={() => setShowAllClients((s) => !s)}>
                {showAllClients ? 'Show fewer' : `View all ${clients.length} clients`}
              </button>
            )}
          </section>
        </>
      )}

      {openClient && <ClientSheet clientId={openClient} onClose={() => setOpenClient(null)} />}
      {inviteOpen && (
        <Sheet title="Add a client" onClose={() => setInviteOpen(false)}>
          <p className="muted">Ask your client to create an account in Yuktara and enter this invite code. They'll appear on your dashboard straight away.</p>
          <InviteCode code={d.invite_code} />
        </Sheet>
      )}
    </div>
  )
}

function InviteCode({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!code) {
    return <p className="small muted">You don't have an invite code yet. Set one with the SQL step in docs/schema.md, or rotate one from the API.</p>
  }
  return (
    <div className="invite-code">
      <span className="eyebrow">Your invite code</span>
      <b className="mono">{code}</b>
      <button type="button" className="btn btn-ghost btn-sm btn-square" onClick={async () => {
        try {
          await navigator.clipboard.writeText(code)
          setCopied(true)
        } catch {
          setCopied(false)
        }
      }}>
        <Copy size={16} /> {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div className="card stat">
      <div className="small muted">{label}</div>
      <div className="num stat-value">{value}</div>
      <div className="xs muted">{sub}</div>
    </div>
  )
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="chip-btn" aria-pressed={on} onClick={onClick}>{children}</button>
}

function QueueRow({ q }: { q: QueueItem }) {
  const units = useUnits()
  const urgent = q.flags.length > 0 || q.has_question
  const facts = [q.plan_pct != null ? `Plan ${q.plan_pct}%` : null, q.weight_change != null ? weightChange(q.weight_change, units) : null].filter(Boolean).join(' · ')
  return (
    <li className="queue-row">
      <Avatar person={q.client} tone={q.flags.length ? 'peach' : undefined} />
      <div className="grow">
        <div><b>{q.client.full_name}</b> <span className="small muted nowrap">· {q.submitted_label}</span></div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {q.flags.map((f) => <span key={f} className="pill warn xs">{f}</span>)}
          {q.has_question && <span className="pill good xs">Question for you</span>}
          {facts && <span className="xs muted">{facts}</span>}
        </div>
      </div>
      <Link to={`/coach/check-ins/${q.check_in_id}`} className={`btn btn-sm btn-square ${urgent ? 'btn-primary' : 'btn-outline'}`}>Review</Link>
    </li>
  )
}

function ClientTr({ c, onOpen }: { c: ClientRow; onOpen: () => void }) {
  const units = useUnits()
  const trainingLow = c.workouts_planned > 0 && c.workouts_done / c.workouts_planned < 0.6
  const foodLow = c.food_pct != null && c.food_pct < 70
  const bad = c.status === 'slipping' || c.status === 'overdue'
  return (
    <tr className="client-row" onClick={onOpen}>
      <td className="cell-client">
        <button type="button" className="row-link" onClick={(e) => { e.stopPropagation(); onOpen() }}>
          <b className="small">{c.client.full_name}</b>
        </button>
        <div className="xs muted">
          {c.goal ? GOAL_LABEL[c.goal] : 'Goal not set'} · week {c.week}{c.weeks ? ` of ${c.weeks}` : ''}
          {c.is_new && <span className="pill good xs new-pill">New</span>}
          {c.setup_done && !c.has_targets && <span className="pill warn xs new-pill">No targets</span>}
        </div>
      </td>
      <td data-label="Days logged"><span className="row" style={{ gap: 8 }}><MiniRing value={c.days_logged} /> {c.days_logged}/7</span></td>
      <td data-label="Training" className={trainingLow ? 'bad strong' : undefined}>{c.workouts_planned ? `${c.workouts_done} of ${c.workouts_planned}` : c.workouts_done || '—'}</td>
      <td data-label="Food on plan" className={foodLow ? 'bad strong' : undefined}>{c.food_pct != null ? `${c.food_pct}%` : '—'}</td>
      <td data-label="Weight, 6 weeks" className="cell-weight">
        {c.weight_trend.length >= 2 ? (
          <span className="row" style={{ gap: 10 }}><Sparkline values={c.weight_trend.map((kg) => bodyValue(kg, units))} tone={bad ? 'bad' : 'good'} /> {c.weight_change != null ? weightChange(c.weight_change, units) : ''}</span>
        ) : (
          <span className="muted small">{c.weight_trend.length === 1 ? bodyWeight(c.weight_trend[0], units) : 'No weigh-ins'}</span>
        )}
      </td>
      <td data-label="Last check-in" className="small">{c.last_check_in}</td>
      <td className="cell-status"><StatusPill status={c.status} /></td>
    </tr>
  )
}

function listNames(n: string[]) {
  if (n.length <= 1) return n.join('')
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}
