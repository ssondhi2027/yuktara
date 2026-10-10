import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Plus } from 'lucide-react'
import { api, COACH_REFRESH, type ProgramClientRow } from '@/lib/api'
import { shortDay } from '@/lib/dates'
import { EXPERIENCE_LABEL, GOAL_LABEL, LEVEL_LABEL, LOCATION_LABEL } from '@/lib/labels'
import type { GoalType } from '@/types/db'
import { useLayout } from '@/app/hooks'
import { Avatar } from '@/components/ui/Avatar'
import { Segmented } from '@/components/ui/Segmented'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { ProgramBuilder } from './ProgramBuilder'
import '@/features/coach/review/review.css'
import './programs.css'

/**
 * /coach/programs, /coach/programs/:programId and /coach/programs/new/:clientId
 *  tablet and desktop — list on the left (Clients / Templates), builder on the right
 *  phone  — list, then the builder as its own screen
 */
export function ProgramsPage() {
  const { programId, clientId } = useParams()
  const layout = useLayout()
  const detail = programId
    ? <SavedProgram id={programId} key={programId} />
    : clientId ? <NewProgram clientId={clientId} key={clientId} /> : null

  if (layout === 'phone') {
    return detail ? (
      <div className="page">
        <Link to="/coach/programs" className="back-link"><ChevronLeft size={18} /> Programs</Link>
        {detail}
      </div>
    ) : <div className="page"><ProgramList /></div>
  }
  return (
    <div className="split programs-split">
      <aside className="split-list"><ProgramList selectedClient={clientId} selectedProgram={programId} /></aside>
      <div className="split-detail">
        {detail ?? (
          <div className="builder-pick">
            <b>Pick a client or a template</b>
            <p className="small muted">"Create" builds a first draft from the client's setup answers. Edit it, then assign it.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function SavedProgram({ id }: { id: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ['program', id], queryFn: () => api.program(id), staleTime: Infinity, refetchOnWindowFocus: false })
  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />
  return <ProgramBuilder initial={data} />
}

/** A draft generated from the client's answers; nothing is saved until the coach saves or assigns it. */
function NewProgram({ clientId }: { clientId: string }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['program-draft', clientId], queryFn: () => api.generateProgram(clientId), staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false,
  })
  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />
  return <ProgramBuilder initial={data} />
}

type View = 'clients' | 'templates'

function ProgramList({ selectedClient, selectedProgram }: { selectedClient?: string; selectedProgram?: string }) {
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'templates' ? 'templates' : 'clients'
  return (
    <div className="stack program-list">
      <header>
        <h1>Programs</h1>
        <div className="muted small">Build each client's plan from their setup answers, or reuse a template.</div>
      </header>
      <Segmented label="Show" block value={view} onChange={(v) => setParams(v === 'clients' ? {} : { view: v }, { replace: true })}
        options={[{ value: 'clients', label: 'Clients' }, { value: 'templates', label: 'Templates' }]} />
      {view === 'clients' ? <ClientsView selectedClient={selectedClient} selectedProgram={selectedProgram} /> : <TemplatesView selected={selectedProgram} />}
    </div>
  )
}

function ClientsView({ selectedClient, selectedProgram }: { selectedClient?: string; selectedProgram?: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ['program-clients'], queryFn: api.programClients, ...COACH_REFRESH })
  if (isPending) return <div className="skeleton" style={{ height: 240 }} />
  if (error) return <PageError error={error} />
  if (!data.length) return <p className="small muted">No clients yet. Share your invite code from the dashboard.</p>
  return (
    <ul className="list-plain" style={{ gap: 6 }}>
      {data.map((c) => <ClientRow key={c.client.id} c={c} selected={selectedClient === c.client.id || [c.current?.id, c.upcoming?.id, c.draft?.id].includes(selectedProgram)} />)}
    </ul>
  )
}

function ClientRow({ c, selected }: { c: ProgramClientRow; selected: boolean }) {
  const answers = [
    c.goal && GOAL_LABEL[c.goal],
    c.experience && EXPERIENCE_LABEL[c.experience],
    c.training_days && `${c.training_days} days`,
    c.train_location && LOCATION_LABEL[c.train_location],
  ].filter(Boolean).join(' · ')
  const target = c.draft?.id ?? c.upcoming?.id ?? c.current?.id
  return (
    <li className={`program-row${selected ? ' selected' : ''}`}>
      <Avatar person={c.client} />
      <div className="grow" style={{ minWidth: 0 }}>
        <b className="truncate" style={{ display: 'block' }}>{c.client.full_name}</b>
        <div className="xs muted truncate">{answers || 'Setup not finished'}</div>
        <div className="small program-state">
          {c.current && <span>{c.current.name} · week {Math.min(c.current.week, c.current.weeks)} of {c.current.weeks}</span>}
          {c.upcoming && <span>{c.current ? 'Next: ' : ''}{c.upcoming.name} · starts {shortDay(c.upcoming.start_date)}</span>}
          {c.draft && <span className="pill gold">Draft: {c.draft.name}</span>}
          {!c.current && !c.upcoming && !c.draft && <span className="muted">No program yet</span>}
        </div>
      </div>
      {target
        ? <Link to={`/coach/programs/${target}`} className="btn btn-ghost btn-sm">{c.draft ? 'Edit draft' : 'Open'}</Link>
        : <Link to={`/coach/programs/new/${c.client.id}`} className="btn btn-primary btn-sm"><Plus size={16} /> Create</Link>}
    </li>
  )
}

function TemplatesView({ selected }: { selected?: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ['program-templates'], queryFn: api.programTemplates, ...COACH_REFRESH })
  const [goal, setGoal] = useState<GoalType | null>(null)
  if (isPending) return <div className="skeleton" style={{ height: 240 }} />
  if (error) return <PageError error={error} />
  const list = data.filter((t) => !goal || t.goal === goal)
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Filter by goal">
        <button type="button" className="chip-btn" aria-pressed={goal === null} onClick={() => setGoal(null)}>All</button>
        {(Object.keys(GOAL_LABEL) as GoalType[]).map((g) => (
          <button key={g} type="button" className="chip-btn" aria-pressed={goal === g} onClick={() => setGoal(goal === g ? null : g)}>{GOAL_LABEL[g]}</button>
        ))}
      </div>
      {data.length === 0 && <p className="small muted">No templates yet. Open a client's program and choose "Save as template".</p>}
      {data.length > 0 && list.length === 0 && <p className="small muted">No templates for that goal.</p>}
      <ul className="list-plain" style={{ gap: 6 }}>
        {list.map((t) => (
          <li key={t.id}>
            <Link to={`/coach/programs/${t.id}?view=templates`} className={`program-row link-row${selected === t.id ? ' selected' : ''}`}>
              <div className="grow" style={{ minWidth: 0 }}>
                <b className="truncate" style={{ display: 'block' }}>{t.name}</b>
                <div className="xs muted">
                  {[t.goal && GOAL_LABEL[t.goal], t.level && LEVEL_LABEL[t.level], t.days_per_week && `${t.days_per_week} days`, `${t.weeks} weeks`, `${t.workouts} workouts`].filter(Boolean).join(' · ')}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
