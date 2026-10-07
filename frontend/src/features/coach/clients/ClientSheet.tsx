import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Targets } from '@/lib/api'
import { monthDay } from '@/lib/dates'
import { DIET_LABEL, EXPERIENCE_LABEL, GOAL_LABEL, LOCATION_LABEL, MEALS_LABEL, WEEKDAY_LABEL } from '@/lib/labels'
import { Sheet } from '@/components/ui/Sheet'
import { EMPTY_TARGETS, TargetsForm, targetsProblem } from './TargetsForm'
import { ClientWorkouts } from './ClientWorkouts'

/** A client's setup answers, plus the coach's targets for them (nutrition_targets, from today). */
export function ClientSheet({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const qc = useQueryClient()
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

  const rows: [string, string | null][] = [
    ['Email', c.email],
    ['Started', `${monthDay(c.start_date)} · week ${c.week}`],
    ['Goal', c.goal ? GOAL_LABEL[c.goal] : null],
    ['Weight', c.start_weight_kg != null ? `${c.start_weight_kg} kg${c.goal_weight_kg != null ? ` → goal ${c.goal_weight_kg} kg` : ''}` : null],
    ['Height', c.height_cm != null ? `${c.height_cm} cm` : null],
    ['Born', c.date_of_birth ? monthDay(c.date_of_birth) + ', ' + c.date_of_birth.slice(0, 4) : null],
    ['Check-in day', WEEKDAY_LABEL[c.check_in_day]],
    ['Experience', c.experience ? EXPERIENCE_LABEL[c.experience] : null],
    ['Trains', c.training_days ? `${c.training_days} days a week${c.train_location ? `, ${LOCATION_LABEL[c.train_location].toLowerCase()}` : ''}` : null],
    ['Injuries', c.injuries],
    ['Eats', c.diet ? `${DIET_LABEL[c.diet]}${c.meals_per_day ? `, ${MEALS_LABEL[c.meals_per_day] ?? `${c.meals_per_day} meals`}` : ''}` : null],
    ['Avoids', c.foods_to_avoid],
  ]

  return (
    <Sheet title={c.client.full_name} onClose={onClose}>
      {!c.setup_done && <div className="auth-note ok">Signed up, but hasn't finished profile setup yet.</div>}
      <dl className="answers-list">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>

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
