import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { MessageSquare } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Targets } from '@/lib/api'
import { monthDay } from '@/lib/dates'
import { Sheet } from '@/components/ui/Sheet'
import { useUnits } from '@/app/auth'
import { EMPTY_TARGETS, TargetsForm, targetsProblem } from './TargetsForm'
import { ClientWorkouts } from './ClientWorkouts'
import { SetupAnswersList } from './SetupAnswers'

/** A client's setup answers, plus the coach's targets for them (nutrition_targets, from today). */
export function ClientSheet({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const units = useUnits()
  const { data: c, error } = useQuery({ queryKey: ['client-detail', clientId], queryFn: () => api.clientDetail(clientId) })
  const [targets, setTargets] = useState<Targets>(EMPTY_TARGETS)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (c?.targets) setTargets(c.targets) }, [c?.targets])

  const save = useMutation({
    mutationFn: (t: Targets) => api.setTargets(clientId, t),
    onSuccess: () => {
      setSaved(true)
      qc.invalidateQueries({ queryKey: ['client-detail', clientId] })
      qc.invalidateQueries({ queryKey: ['coach-dashboard'] })
      qc.invalidateQueries({ queryKey: ['review'] })
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const p = targetsProblem(targets)
    setProblem(p)
    setSaved(false)
    if (!p) save.mutate(targets)
  }

  if (error) return <Sheet title="Client" onClose={onClose}><p className="muted">{error.message}</p></Sheet>
  if (!c) return <Sheet title="Client" onClose={onClose}><div className="skeleton" style={{ height: 300 }} /></Sheet>


  return (
    <Sheet title={c.client.full_name} onClose={onClose}>
      <Link to={`/coach/messages/${clientId}`} className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}>
        <MessageSquare size={16} /> Message {c.client.first_name}
      </Link>
      <Link to={`/coach/clients/${clientId}`} className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}>
        Open full profile: history, notes, status
      </Link>
      <section className="sheet-program">
        <div className="xs muted">Program</div>
        {c.program ? (
          <div className="between" style={{ gap: 12 }}>
            <span className="small">
              <b>{c.program.name}</b>
              {c.program.status === 'active' && ` · week ${Math.min(c.program.week ?? 1, c.program.weeks)} of ${c.program.weeks}`}
              {c.program.status === 'upcoming' && c.program.start_date && ` · starts ${monthDay(c.program.start_date)}`}
              {c.program.status === 'ended' && ' · ended'}
            </span>
            <Link to={`/coach/programs/${c.program.id}`} className="btn btn-ghost btn-sm">Edit program</Link>
          </div>
        ) : (
          <div className="between" style={{ gap: 12 }}>
            <span className="small muted">{c.draft_program_id ? 'A draft is ready, not assigned yet.' : 'No program yet.'}</span>
            <Link to={c.draft_program_id ? `/coach/programs/${c.draft_program_id}` : `/coach/programs/new/${clientId}`} className="btn btn-primary btn-sm">
              {c.draft_program_id ? 'Open draft' : `Create program for ${c.client.first_name}`}
            </Link>
          </div>
        )}
      </section>
      {!c.setup_done && <div className="auth-note ok">Signed up, but hasn't finished profile setup yet.</div>}
      <SetupAnswersList c={c} units={units} />

      <form className="stack" onSubmit={submit} noValidate>
        <div className="between">
          <h3>Targets</h3>
          <span className="xs muted">
            {c.targets_from ? `In force since ${monthDay(c.targets_from)}` : 'None yet: the client sees "waiting for your coach"'}
          </span>
        </div>
        <TargetsForm value={targets} onChange={(t) => { setTargets(t); setSaved(false) }} idPrefix={`c-${clientId}`} />
        <p className="xs muted">Saved targets apply from today. Targets sent with a check-in review start next Monday.</p>
        {problem && <div role="alert" className="auth-note err">{problem}</div>}
        {save.error && <div role="alert" className="auth-note err">{save.error.message}</div>}
        {saved && <div role="status" className="auth-note ok">Targets saved. {c.client.first_name} sees them now.</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save targets'}</button>
      </form>

      <ClientWorkouts clientId={clientId} firstName={c.client.first_name} />
    </Sheet>
  )
}
