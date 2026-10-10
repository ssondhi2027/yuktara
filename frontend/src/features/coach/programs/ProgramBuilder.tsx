import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowDown, ArrowLeftRight, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { api, type LibraryExercise, type Program, type ProgramExercise, type ProgramWorkout } from '@/lib/api'
import { addDays, shortDay, today } from '@/lib/dates'
import { EXPERIENCE_LABEL, GOAL_LABEL, LEVEL_LABEL, LOCATION_LABEL, WEEKDAY_LABEL } from '@/lib/labels'
import { MUSCLE_LABEL } from '@/lib/muscles'
import { GOALS, kindOf, MAJOR_MUSCLES } from '@/lib/programGen'
import { assignProblems, comingMonday, plannedSets, programProblems, setsRange } from '@/lib/programs'
import { MUSCLE_GROUPS, type ExerciseLevel, type GoalType } from '@/types/db'
import { ExercisePicker } from '@/features/client/train/ExercisePicker'

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const STATUS_LABEL = { template: 'Template', draft: 'Draft', upcoming: 'Assigned', active: 'Running', ended: 'Ended' } as const

/** Everything that shows programs; refreshed after a save, assign, copy or delete. */
const PROGRAM_KEYS = [['program-clients'], ['program-templates'], ['client-detail'], ['coach-dashboard'], ['checkin-lists'], ['review']]

/**
 * Edits one program in memory and saves it in one go (save_program). Client
 * programs can be assigned; any program can be saved as a template.
 */
export function ProgramBuilder({ initial }: { initial: Program }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [p, setP] = useState<Program>(() => structuredClone(initial))
  const [dirty, setDirty] = useState(initial.id == null)
  const [problems, setProblems] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ workout: number; replace?: number } | null>(null)
  const [start, setStart] = useState(initial.draft_start ?? initial.start_date ?? comingMonday(today()))
  const library = useQuery({ queryKey: ['exercise-library'], queryFn: api.exerciseLibrary, staleTime: Infinity })
  const client = useQuery({ queryKey: ['client-detail', p.client_id], queryFn: () => api.clientDetail(p.client_id!), enabled: !!p.client_id })
  const templates = useQuery({ queryKey: ['program-templates'], queryFn: api.programTemplates, enabled: p.status === 'draft' })
  const clients = useQuery({ queryKey: ['program-clients'], queryFn: api.programClients, enabled: p.status === 'template' })
  const byId = useMemo(() => new Map((library.data ?? []).map((e) => [e.id, e])), [library.data])

  const change = (f: (d: Program) => void) => {
    setP((cur) => {
      const next = structuredClone(cur)
      f(next)
      return next
    })
    setDirty(true)
    setNotice(null)
  }
  const refresh = () => PROGRAM_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }))

  /** After a write, the builder continues from what was saved (so new rows have their ids). */
  const reload = async (id: string) => {
    const fresh = await api.program(id)
    qc.setQueryData(['program', id], fresh)
    if (p.id === id) {
      setP(fresh)
      setDirty(false)
    }
  }
  const fail = (e: unknown) => setProblems([e instanceof Error ? e.message : 'Something went wrong. Try again.'])

  /** Saves if needed; returns the program id. */
  const persist = async (draft = p): Promise<string> => {
    if (!dirty && draft.id) return draft.id
    const { id } = await api.saveProgram({ ...draft, draft_start: draft.status === 'draft' ? start : draft.draft_start })
    setDirty(false)
    return id
  }

  const save = useMutation({
    mutationFn: async () => {
      const found = programProblems(p)
      setProblems(found)
      if (found.length) return null
      const id = await persist()
      await reload(id)
      return id
    },
    onSuccess: (id) => {
      if (!id) return
      refresh()
      setNotice(p.status === 'active' ? 'Saved. Changes apply to upcoming workouts; logged workouts keep what was done.' : 'Saved.')
      if (!p.id) navigate(`/coach/programs/${id}`, { replace: true })
    },
    onError: fail,
  })

  const assign = useMutation({
    mutationFn: async () => {
      const found = assignProblems(p)
      setProblems(found)
      if (found.length) return null
      const id = await persist()
      await api.assignProgram(id, start)
      await reload(id)
      return id
    },
    onSuccess: (id) => {
      if (!id) return
      refresh()
      const name = client.data?.client.first_name ?? 'The client'
      setNotice(`Assigned. ${name} sees it on Train ${start <= today() ? 'now' : `from ${shortDay(start)}`}.`)
      if (p.id !== id) navigate(`/coach/programs/${id}`, { replace: true })
    },
    onError: fail,
  })

  const asTemplate = useMutation({
    mutationFn: async () => {
      const found = programProblems(p)
      setProblems(found)
      if (found.length) return null
      const source = await persist()
      await reload(source)
      return (await api.copyProgram(source, null)).id
    },
    onSuccess: (id) => {
      if (!id) return
      refresh()
      setNotice('Saved to your templates.')
    },
    onError: fail,
  })

  const useFor = useMutation({
    mutationFn: async ({ template, clientId }: { template: string; clientId: string }) => (await api.copyProgram(template, clientId)).id,
    onSuccess: (id) => {
      refresh()
      navigate(`/coach/programs/${id}`)
    },
    onError: fail,
  })

  const remove = useMutation({
    mutationFn: () => api.deleteProgram(p.id!),
    onSuccess: () => {
      refresh()
      navigate(p.status === 'template' ? '/coach/programs?view=templates' : '/coach/programs')
    },
    onError: fail,
  })

  const busy = save.isPending || assign.isPending || asTemplate.isPending || remove.isPending || useFor.isPending
  const sets = library.data ? plannedSets(p, library.data) : {}
  const [min, max] = setsRange(p)
  const c = client.data
  const isClient = !!p.client_id
  const assignable = isClient && (p.status === 'draft' || p.status === 'upcoming')

  const addExercise = (wi: number, e: LibraryExercise) => {
    const dose = GOALS[p.goal ?? 'health'][kindOf(e)]
    change((d) => {
      const x: ProgramExercise = { id: null, exercise_id: e.id, name: e.name, sets: 3, reps: dose.reps, rpe: 8, rest_seconds: dose.rest, notes: '' }
      if (picker?.replace != null) Object.assign(d.workouts[wi].exercises[picker.replace], { exercise_id: e.id, name: e.name })
      else d.workouts[wi].exercises.push(x)
    })
    setPicker(null)
  }

  return (
    <div className="builder">
      <header className="builder-head">
        <div className="between" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="page-date">
              <span className={`pill ${p.status === 'active' ? 'good' : p.status === 'draft' ? 'gold' : 'awaiting'}`}>{STATUS_LABEL[p.status]}</span>
              {p.status === 'active' && p.start_date && <span> · started {shortDay(p.start_date)} · week {Math.min(p.week ?? 1, p.weeks)} of {p.weeks}</span>}
              {p.status === 'upcoming' && p.start_date && <span> · starts {shortDay(p.start_date)}</span>}
              {c && <span> · for {c.client.full_name}</span>}
            </div>
            <label className="sr-only" htmlFor="prog-name">Program name</label>
            <input id="prog-name" className="input builder-name" value={p.name} maxLength={80} onChange={(e) => change((d) => { d.name = e.target.value })} />
          </div>
        </div>
        <div className="builder-fields">
          <div className="field">
            <label htmlFor="prog-weeks">Weeks</label>
            <input id="prog-weeks" className="input" type="number" min={4} max={16} value={p.weeks}
              onChange={(e) => change((d) => { d.weeks = Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="prog-goal">Goal</label>
            <select id="prog-goal" className="input" value={p.goal ?? ''} onChange={(e) => change((d) => { d.goal = (e.target.value || null) as GoalType | null })}>
              <option value="">Not set</option>
              {(Object.keys(GOAL_LABEL) as GoalType[]).map((g) => <option key={g} value={g}>{GOAL_LABEL[g]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="prog-level">Level</label>
            <select id="prog-level" className="input" value={p.level ?? ''} onChange={(e) => change((d) => { d.level = (e.target.value || null) as ExerciseLevel | null })}>
              <option value="">Not set</option>
              {(Object.keys(LEVEL_LABEL) as ExerciseLevel[]).map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
            </select>
          </div>
          {assignable && (
            <div className="field">
              <label htmlFor="prog-start">Starts</label>
              <input id="prog-start" className="input" type="date" min={addDays(today(), 0)} value={start} onChange={(e) => { setStart(e.target.value); setDirty(true) }} />
              <span className="xs">
                <button type="button" className="link" onClick={() => setStart(today())}>Today</button>
                {' · '}
                <button type="button" className="link" onClick={() => setStart(comingMonday(addDays(today(), 1)))}>Next Monday</button>
              </span>
            </div>
          )}
        </div>
      </header>

      {c && (
        <section className="card builder-client">
          <div className="xs muted">Setup answers</div>
          <div className="small">
            {[c.goal && GOAL_LABEL[c.goal], c.experience && `${EXPERIENCE_LABEL[c.experience]} training`, c.training_days && `${c.training_days} days a week`, c.train_location && LOCATION_LABEL[c.train_location]].filter(Boolean).join(' · ') || 'Not finished yet'}
          </div>
          {c.injuries && (
            <div className="injury-callout" role="note">
              <AlertTriangle size={18} />
              <div><b>Injuries and limits</b><p>{c.injuries}</p><span className="xs">Not read by the generator: check the exercises yourself.</span></div>
            </div>
          )}
        </section>
      )}

      {!!initial.warnings?.length && (
        <div className="builder-warnings small" role="note">
          <b>From the generator</b>
          <ul>{initial.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {p.status === 'draft' && !!templates.data?.length && (
        <div className="row small" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="muted">Or start from a template:</span>
          <select className="input" style={{ width: 'auto', minWidth: 220 }} defaultValue="" aria-label="Start from a template"
            onChange={(e) => e.target.value && p.client_id && useFor.mutate({ template: e.target.value, clientId: p.client_id })}>
            <option value="" disabled>Choose a template</option>
            {templates.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      <section className="card sets-card">
        <div className="between">
          <h3>Weekly hard sets</h3>
          <span className="xs muted">Major muscles: aim for {min}–{max}</span>
        </div>
        <div className="sets-grid">
          {MUSCLE_GROUPS.map((m) => {
            const n = sets[m] ?? 0
            const major = MAJOR_MUSCLES.includes(m)
            const tone = n === 0 ? (major ? 'low' : 'none') : n > max || (major && n < min) ? 'low' : 'ok'
            return <span key={m} className={`sets-chip ${tone}`}>{MUSCLE_LABEL[m]} <b className="num">{n}</b></span>
          })}
        </div>
      </section>

      <div className="workouts">
        {p.workouts.map((w, wi) => (
          <WorkoutCard key={w.id ?? `new-${wi}`} w={w} index={wi} count={p.workouts.length} library={byId}
            onChange={(f) => change((d) => f(d.workouts[wi]))}
            onMove={(dir) => change((d) => { const [x] = d.workouts.splice(wi, 1); d.workouts.splice(wi + dir, 0, x) })}
            onRemove={() => change((d) => { d.workouts.splice(wi, 1) })}
            onAdd={() => setPicker({ workout: wi })}
            onReplace={(xi) => setPicker({ workout: wi, replace: xi })} />
        ))}
        <button type="button" className="btn btn-outline btn-block" onClick={() => change((d) => {
          const used = new Set(d.workouts.map((x) => x.day_of_week))
          d.workouts.push({ id: null, name: `Workout ${d.workouts.length + 1}`, day_of_week: DAY_ORDER.find((x) => !used.has(x)) ?? null, notes: '', exercises: [] })
        })}>
          <Plus size={18} /> Add a workout
        </button>
      </div>

      <footer className="builder-actions">
        {problems.length > 0 && (
          <div role="alert" className="auth-note err">
            {problems.length === 1 ? problems[0] : <ul style={{ margin: 0, paddingLeft: 18 }}>{problems.slice(0, 6).map((x) => <li key={x}>{x}</li>)}</ul>}
          </div>
        )}
        {notice && <div role="status" className="auth-note ok" style={{ marginTop: 0 }}>{notice}</div>}
        {p.status === 'active' && <p className="xs muted">Edits apply to upcoming workouts. Logged workouts and sets are never changed.</p>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {assignable && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => assign.mutate()}>
              {assign.isPending ? 'Assigning…' : p.status === 'upcoming' ? `Move start to ${shortDay(start)}` : `Assign from ${shortDay(start)}`}
            </button>
          )}
          <button type="button" className={`btn ${assignable ? 'btn-ghost' : 'btn-primary'}`} disabled={busy || (!dirty && !!p.id)} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : p.status === 'draft' ? 'Save draft' : 'Save changes'}
          </button>
          {p.status !== 'template' && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => asTemplate.mutate()}>Save as template</button>
          )}
          {p.status === 'template' && clients.data && (
            <select className="input" style={{ width: 'auto' }} defaultValue="" aria-label="Use this template for a client" disabled={busy}
              onChange={(e) => e.target.value && p.id && useFor.mutate({ template: p.id, clientId: e.target.value })}>
              <option value="" disabled>Use for a client…</option>
              {clients.data.map((x) => <option key={x.client.id} value={x.client.id}>{x.client.full_name}</option>)}
            </select>
          )}
          {p.id && (p.status === 'draft' || p.status === 'template') && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => remove.mutate()}>
              <Trash2 size={16} /> Delete {p.status}
            </button>
          )}
          {isClient && p.id && <Link to={`/coach/messages/${p.client_id}`} className="btn btn-ghost">Message {c?.client.first_name ?? 'client'}</Link>}
        </div>
      </footer>

      {picker && library.data && (
        <ExercisePicker library={library.data}
          swapFor={picker.replace != null ? byId.get(p.workouts[picker.workout].exercises[picker.replace].exercise_id) : undefined}
          exclude={new Set(p.workouts[picker.workout].exercises.map((x) => x.exercise_id))}
          onPick={(e) => addExercise(picker.workout, e)} onClose={() => setPicker(null)} />
      )}
    </div>
  )
}

function WorkoutCard({ w, index, count, library, onChange, onMove, onRemove, onAdd, onReplace }: {
  w: ProgramWorkout
  index: number
  count: number
  library: Map<string, LibraryExercise>
  onChange: (f: (w: ProgramWorkout) => void) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onAdd: () => void
  onReplace: (exerciseIndex: number) => void
}) {
  const id = `w${index}`
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  return (
    <section className="card workout-card">
      <div className="workout-top">
        <label className="sr-only" htmlFor={`${id}-name`}>Workout name</label>
        <input id={`${id}-name`} className="input workout-name" value={w.name} maxLength={80} onChange={(e) => onChange((x) => { x.name = e.target.value })} />
        <label className="sr-only" htmlFor={`${id}-day`}>Day</label>
        <select id={`${id}-day`} className="input workout-day" value={w.day_of_week ?? ''}
          onChange={(e) => onChange((x) => { x.day_of_week = e.target.value === '' ? null : Number(e.target.value) })}>
          {DAY_ORDER.map((d) => <option key={d} value={d}>{WEEKDAY_LABEL[d]}</option>)}
          <option value="">Any day</option>
        </select>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="icon-btn" aria-label={`Move ${w.name} up`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={16} /></button>
          <button type="button" className="icon-btn" aria-label={`Move ${w.name} down`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown size={16} /></button>
          <button type="button" className="icon-btn" aria-label={`Remove ${w.name}`} onClick={onRemove}><Trash2 size={16} /></button>
        </div>
      </div>
      <input className="input workout-notes" placeholder="Note for this workout" aria-label={`${w.name} note`} maxLength={1000} value={w.notes}
        onChange={(e) => onChange((x) => { x.notes = e.target.value })} />

      <ol className="ex-rows">
        {w.exercises.map((x, xi) => {
          const e = library.get(x.exercise_id)
          const xid = `${id}-x${xi}`
          return (
            <li key={x.id ?? `${xi}-${x.exercise_id}`} className="ex-row">
              <div className="ex-row-top">
                <b className="grow truncate">{x.name}</b>
                {e && <span className="xs muted truncate">{e.primary.map((m) => MUSCLE_LABEL[m]).join(', ')}</span>}
                <button type="button" className="icon-btn sm" aria-label={`Swap ${x.name}`} onClick={() => onReplace(xi)}><ArrowLeftRight size={15} /></button>
                <button type="button" className="icon-btn sm" aria-label={`Move ${x.name} up`} disabled={xi === 0}
                  onClick={() => onChange((wk) => { const [m] = wk.exercises.splice(xi, 1); wk.exercises.splice(xi - 1, 0, m) })}><ArrowUp size={15} /></button>
                <button type="button" className="icon-btn sm" aria-label={`Move ${x.name} down`} disabled={xi === w.exercises.length - 1}
                  onClick={() => onChange((wk) => { const [m] = wk.exercises.splice(xi, 1); wk.exercises.splice(xi + 1, 0, m) })}><ArrowDown size={15} /></button>
                <button type="button" className="icon-btn sm" aria-label={`Remove ${x.name}`} onClick={() => onChange((wk) => { wk.exercises.splice(xi, 1) })}><Trash2 size={15} /></button>
              </div>
              <div className="ex-row-fields">
                <label htmlFor={`${xid}-sets`}>Sets<input id={`${xid}-sets`} className="input" type="number" min={1} max={10} value={x.sets}
                  onChange={(ev) => onChange((wk) => { wk.exercises[xi].sets = Number(ev.target.value) })} /></label>
                <label htmlFor={`${xid}-reps`}>Reps<input id={`${xid}-reps`} className="input" maxLength={20} value={x.reps}
                  onChange={(ev) => onChange((wk) => { wk.exercises[xi].reps = ev.target.value })} /></label>
                <label htmlFor={`${xid}-rpe`}>RPE<input id={`${xid}-rpe`} className="input" type="number" min={1} max={10} step={0.5} value={x.rpe ?? ''}
                  onChange={(ev) => onChange((wk) => { wk.exercises[xi].rpe = num(ev.target.value) })} /></label>
                <label htmlFor={`${xid}-rest`}>Rest (s)<input id={`${xid}-rest`} className="input" type="number" min={0} max={900} step={15} value={x.rest_seconds ?? ''}
                  onChange={(ev) => onChange((wk) => { wk.exercises[xi].rest_seconds = num(ev.target.value) })} /></label>
              </div>
              <input className="input ex-note" placeholder="Note for the client" aria-label={`${x.name} note`} maxLength={500} value={x.notes}
                onChange={(ev) => onChange((wk) => { wk.exercises[xi].notes = ev.target.value })} />
            </li>
          )
        })}
      </ol>
      {w.exercises.length === 0 && <p className="small muted">No exercises yet.</p>}
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onAdd}><Plus size={16} /> Add exercise</button>
    </section>
  )
}
