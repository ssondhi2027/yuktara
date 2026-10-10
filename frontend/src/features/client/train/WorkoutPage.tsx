import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Check, ChevronLeft, Minus, Plus, Trash2 } from 'lucide-react'
import {
  api, TRAINING_KEYS, type LastTime, type LibraryExercise, type PlannedExercise, type SetWrite, type WorkoutLog,
} from '@/lib/api'
import { clockTime, monthDay, weekday } from '@/lib/dates'
import { MUSCLE_LABEL } from '@/lib/muscles'
import {
  BODYWEIGHT, minutesSince, OWN_WORKOUT, plainReps, setsLine, summarize, toDisplay, toKg, volumeLabel, weightUnit,
} from '@/lib/workouts'
import type { UnitSystem } from '@/types/db'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { ExercisePicker } from './ExercisePicker'
import './workout.css'

export default function WorkoutPage() {
  const { id = '' } = useParams()
  const log = useQuery({ queryKey: ['workout', id], queryFn: () => api.workoutLog(id), refetchOnWindowFocus: false })
  const library = useQuery({ queryKey: ['exercise-library'], queryFn: api.exerciseLibrary, staleTime: Infinity })
  if (log.isPending || library.isPending) return <PageLoading />
  if (log.error) return <PageError error={log.error} />
  if (library.error) return <PageError error={library.error} />
  return log.data.finished_at
    ? <Summary log={log.data} library={library.data} />
    // Keyed by unit too: switching kg/lb rebuilds the rows in the new unit (ticked sets are already saved).
    : <Logger key={`${id}-${log.data.units}`} log={log.data} library={library.data} />
}

// ---------- Logging ----------

interface Row { n: number; weight: string; reps: string; rpe: string; done: boolean; dirty: boolean; saving: boolean; error: string | null }
interface Card { key: string; slot: PlannedExercise | null; exercise_id: string; rows: Row[] }

/** What's kept in browser storage so a reload restores added and swapped exercises (sets live in Supabase). */
interface Layout { cards: { key: string; slot_id: string | null; exercise_id: string; numbers: number[] }[] }

const layoutKey = (id: string) => `yuktara.workout.${id}`

function readLayout(id: string): Layout | null {
  try {
    const raw = localStorage.getItem(layoutKey(id))
    return raw ? (JSON.parse(raw) as Layout) : null
  } catch {
    return null
  }
}

function writeLayout(id: string, cards: Card[] | null) {
  try {
    if (!cards) localStorage.removeItem(layoutKey(id))
    else localStorage.setItem(layoutKey(id), JSON.stringify({
      cards: cards.map((c) => ({ key: c.key, slot_id: c.slot?.template_exercise_id ?? null, exercise_id: c.exercise_id, numbers: c.rows.map((r) => r.n) })),
    } satisfies Layout))
  } catch {
    // Storage blocked: the sets themselves are already saved.
  }
}

const emptyRow = (n: number): Row => ({ n, weight: '', reps: '', rpe: '', done: false, dirty: false, saving: false, error: null })

function loggedRow(s: SetWrite, units: UnitSystem): Row {
  return {
    n: s.set_number, done: true, dirty: false, saving: false, error: null,
    weight: s.weight_kg != null ? toDisplay(s.weight_kg, units) : '', reps: s.reps != null ? String(s.reps) : '', rpe: s.rpe != null ? String(s.rpe) : '',
  }
}

/** Cards from the plan (or the saved layout), with every saved set in place. */
function buildCards(log: WorkoutLog, layout: Layout | null): Card[] {
  const range = (k: number) => Array.from({ length: k }, (_, i) => i + 1)
  const cards: { key: string; slot: PlannedExercise | null; exercise_id: string; numbers: number[] }[] = layout
    ? layout.cards.map((c) => ({ ...c, slot: log.plan.find((p) => p.template_exercise_id === c.slot_id) ?? null }))
    : log.plan.map((p) => ({
      key: p.template_exercise_id, slot: p, numbers: range(p.sets),
      // A session-only swap is stored on the sets themselves.
      exercise_id: log.sets.find((s) => s.template_exercise_id === p.template_exercise_id)?.exercise_id ?? p.exercise_id,
    }))
  for (const s of log.sets) {
    const slotId = s.template_exercise_id
    let c = cards.find((x) => x.exercise_id === s.exercise_id && (x.slot?.template_exercise_id ?? null) === slotId)
    if (!c) {
      c = { key: slotId ?? `x-${s.exercise_id}`, slot: log.plan.find((p) => p.template_exercise_id === slotId) ?? null, exercise_id: s.exercise_id, numbers: [] }
      cards.push(c)
    }
    if (!c.numbers.includes(s.set_number)) c.numbers.push(s.set_number)
  }
  return cards.map((c) => ({
    key: c.key, slot: c.slot, exercise_id: c.exercise_id,
    rows: [...c.numbers].sort((a, b) => a - b).map((n) => {
      const s = log.sets.find((x) => x.exercise_id === c.exercise_id && x.set_number === n)
      return s ? loggedRow(s, log.units) : emptyRow(n)
    }),
  }))
}

function Logger({ log, library }: { log: WorkoutLog; library: LibraryExercise[] }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const units = log.units
  const byId = useMemo(() => new Map(library.map((e) => [e.id, e])), [library])
  const [cards, setCards] = useState<Card[]>(() => buildCards(log, readLayout(log.id)))
  const [picker, setPicker] = useState<{ swap?: string } | null>(null)
  const [notes, setNotes] = useState(log.notes)
  const [error, setError] = useState<string | null>(null)
  const [, tick] = useState(0)

  useEffect(() => { writeLayout(log.id, cards) }, [log.id, cards])
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const exerciseIds = useMemo(() => [...new Set(cards.map((c) => c.exercise_id))].sort(), [cards])
  const last = useQuery({
    queryKey: ['workout-last', log.id, exerciseIds.join(',')],
    queryFn: () => api.lastTime(log.id, exerciseIds),
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  })

  const refresh = () => TRAINING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }))
  const update = (key: string, f: (c: Card) => Card) => setCards((cs) => cs.map((c) => (c.key === key ? f(c) : c)))
  const updateRow = (key: string, n: number, patch: Partial<Row>) =>
    update(key, (c) => ({ ...c, rows: c.rows.map((r) => (r.n === n ? { ...r, ...patch } : r)) }))

  const doneSets = cards.reduce((k, c) => k + c.rows.filter((r) => r.done).length, 0)

  /** Validates a row (blank fields take their placeholder) and saves it as a set. */
  async function save(c: Card, r: Row, lastTime: LastTime | undefined) {
    const e = byId.get(c.exercise_id)
    const prev = lastTime?.sets.find((s) => s.set_number === r.n) ?? lastTime?.sets.at(-1)
    const weight = r.weight.trim() || (prev?.weight_kg != null ? toDisplay(prev.weight_kg, units) : '')
    const reps = r.reps.trim() || String(plainReps(c.slot?.reps) ?? prev?.reps ?? '')
    const rpe = r.rpe.trim()
    const repsN = Number(reps)
    if (reps === '' || !Number.isInteger(repsN) || repsN < 0 || repsN > 100) return updateRow(c.key, r.n, { error: 'Reps: a whole number from 0 to 100.' })
    let kg: number | null = null
    if (weight !== '') {
      const w = Number(weight)
      kg = Number.isFinite(w) ? toKg(w, units) : NaN
      if (!(kg >= 0 && kg <= 1000)) return updateRow(c.key, r.n, { error: `Weight: 0 to ${units === 'imperial' ? '2,204 lb' : '1,000 kg'}.` })
    } else if (!BODYWEIGHT.has(e?.equipment ?? '')) {
      return updateRow(c.key, r.n, { error: 'Enter the weight you used.' })
    }
    let rpeN: number | null = null
    if (rpe !== '') {
      rpeN = Number(rpe)
      if (!(rpeN >= 1 && rpeN <= 10) || rpeN * 2 !== Math.round(rpeN * 2)) return updateRow(c.key, r.n, { error: 'RPE: 1 to 10, in steps of 0.5.' })
    }
    updateRow(c.key, r.n, { saving: true, error: null })
    try {
      await api.saveSet(log.id, { exercise_id: c.exercise_id, template_exercise_id: c.slot?.template_exercise_id ?? null, set_number: r.n, weight_kg: kg, reps: repsN, rpe: rpeN })
      updateRow(c.key, r.n, { saving: false, done: true, dirty: false, weight, reps, rpe })
      refresh()
    } catch (err) {
      updateRow(c.key, r.n, { saving: false, error: err instanceof Error ? err.message : 'Could not save. Try again.' })
    }
  }

  async function untick(c: Card, r: Row) {
    updateRow(c.key, r.n, { saving: true, error: null })
    try {
      await api.deleteSet(log.id, c.exercise_id, r.n)
      updateRow(c.key, r.n, { saving: false, done: false })
      refresh()
    } catch (err) {
      updateRow(c.key, r.n, { saving: false, error: err instanceof Error ? err.message : 'Could not undo. Try again.' })
    }
  }

  async function removeLast(c: Card) {
    const r = c.rows.at(-1)
    if (!r) return
    if (r.done) await untick(c, r)
    update(c.key, (x) => ({ ...x, rows: x.rows.filter((y) => y.n !== r.n) }))
  }

  const addSet = (c: Card) => update(c.key, (x) => ({ ...x, rows: [...x.rows, emptyRow(Math.max(0, ...x.rows.map((y) => y.n)) + 1)] }))

  const pick = (e: LibraryExercise) => {
    if (picker?.swap) update(picker.swap, (c) => ({ ...c, exercise_id: e.id }))
    else setCards((cs) => [...cs, { key: `x-${e.id}`, slot: null, exercise_id: e.id, rows: [1, 2, 3].map(emptyRow) }])
    setPicker(null)
  }

  const saveNote = useMutation({ mutationFn: (text: string) => api.saveWorkoutNote(log.id, text) })
  const finish = useMutation({
    mutationFn: async () => {
      if (notes !== log.notes) await api.saveWorkoutNote(log.id, notes)
      return api.finishWorkout(log.id)
    },
    onSuccess: () => {
      writeLayout(log.id, null)
      refresh()
      qc.invalidateQueries({ queryKey: ['workout', log.id] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not finish. Try again.'),
  })
  const discard = useMutation({
    mutationFn: () => api.discardWorkout(log.id),
    onSuccess: () => {
      writeLayout(log.id, null)
      refresh()
      navigate('/train')
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not discard. Try again.'),
  })

  const elapsed = minutesSince(log.started_at)
  const swapCard = picker?.swap ? cards.find((c) => c.key === picker.swap) : undefined
  const w = weightUnit(units)

  return (
    <div className="page workout-page">
      <Link to="/train" className="back-btn"><ChevronLeft size={18} /> Train</Link>
      <header className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h1>{log.name}</h1>
          <div className="sub">
            {log.started_at ? `Started ${clockTime(log.started_at)}` : weekday(log.performed_on)}
            {elapsed != null && ` · ${elapsed} min`} · {doneSets} {doneSets === 1 ? 'set' : 'sets'} logged
          </div>
        </div>
      </header>

      {log.coach_notes && <div className="coach-callout small"><b>From your coach</b> {log.coach_notes}</div>}
      {log.name === OWN_WORKOUT && cards.length === 0 && (
        <section className="card empty-workout">
          <p className="muted">Add the exercises you're doing. Sets save as you tick them.</p>
        </section>
      )}

      <div className="workout-cards">
        {cards.map((c) => {
          const e = byId.get(c.exercise_id)
          const lastTime = last.data?.[c.exercise_id]
          const anyDone = c.rows.some((r) => r.done)
          const swappedFrom = c.slot && c.slot.exercise_id !== c.exercise_id ? c.slot.name : null
          const bw = BODYWEIGHT.has(e?.equipment ?? '')
          return (
            <section key={c.key} className="card ex-card">
              <div className="ex-card-head">
                <div className="grow" style={{ minWidth: 0 }}>
                  <h2 className="ex-name">{e?.name ?? c.slot?.name ?? 'Exercise'}</h2>
                  {swappedFrom && <div className="xs muted">Swapped from {swappedFrom} for today</div>}
                  {c.slot && (
                    <div className="small plan-line">
                      {c.slot.sets} × {c.slot.reps}{c.slot.rpe != null && ` · RPE ${c.slot.rpe}`}
                      {c.slot.rest_seconds != null && ` · rest ${restLabel(c.slot.rest_seconds)}`}
                    </div>
                  )}
                </div>
                {!anyDone && (
                  <button type="button" className="icon-btn" aria-label={`Swap ${e?.name ?? 'exercise'}`} title="Swap for today" onClick={() => setPicker({ swap: c.key })}>
                    <ArrowLeftRight size={18} />
                  </button>
                )}
                {!c.slot && !anyDone && (
                  <button type="button" className="icon-btn" aria-label={`Remove ${e?.name ?? 'exercise'}`}
                    onClick={() => setCards((cs) => cs.filter((x) => x.key !== c.key))}>
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
              {c.slot?.notes && <p className="small ex-coach-note"><b>Coach:</b> {c.slot.notes}</p>}
              {(e?.cue ?? c.slot?.cue) && <p className="xs muted ex-cue-line">{e?.cue ?? c.slot?.cue}</p>}
              <p className="xs last-time">
                {lastTime ? <>Last time ({monthDay(lastTime.date)}): {setsLine(lastTime.sets, units)}</> : 'First time logging this one.'}
              </p>

              <div className="set-grid" role="table" aria-label={`${e?.name ?? 'Exercise'} sets`}>
                <div className="set-row set-head" role="row">
                  <span role="columnheader">Set</span>
                  <span role="columnheader">{w}</span>
                  <span role="columnheader">Reps</span>
                  <span role="columnheader">RPE</span>
                  <span role="columnheader" className="sr-only">Done</span>
                </div>
                {c.rows.map((r, i) => {
                  const prev = lastTime?.sets.find((s) => s.set_number === r.n) ?? lastTime?.sets.at(-1)
                  const field = (k: 'weight' | 'reps' | 'rpe', label: string, placeholder: string, step: string, mode: 'decimal' | 'numeric') => (
                    <input className="input set-input" type="number" inputMode={mode} step={step} min="0" aria-label={`Set ${i + 1} ${label}`}
                      placeholder={r.done ? '–' : placeholder} value={r[k]} disabled={r.saving}
                      onChange={(ev) => updateRow(c.key, r.n, { ...({ [k]: ev.target.value } as Pick<Row, typeof k>), dirty: r.done, error: null })}
                      onBlur={() => { if (r.done && r.dirty) void save(c, r, lastTime) }} />
                  )
                  return (
                    <div key={r.n} className={`set-row${r.done ? ' done' : ''}`} role="row">
                      <span className="set-n num">{i + 1}</span>
                      {field('weight', w, prev?.weight_kg != null ? toDisplay(prev.weight_kg, units) : bw ? 'BW' : '–', units === 'imperial' ? '1' : '0.5', 'decimal')}
                      {field('reps', 'reps', c.slot?.reps ?? (prev?.reps != null ? String(prev.reps) : '–'), '1', 'numeric')}
                      {field('rpe', 'RPE', c.slot?.rpe != null ? String(c.slot.rpe) : '–', '0.5', 'decimal')}
                      <button type="button" className="set-tick" aria-pressed={r.done} aria-label={r.done ? `Undo set ${i + 1}` : `Set ${i + 1} done`}
                        disabled={r.saving} onClick={() => (r.done ? untick(c, r) : save(c, r, lastTime))}>
                        <Check size={20} />
                      </button>
                      {r.error && <div role="alert" className="set-error xs">{r.error}</div>}
                    </div>
                  )
                })}
              </div>
              <div className="row set-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => addSet(c)}><Plus size={16} /> Add set</button>
                {c.rows.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeLast(c)}><Minus size={16} /> Remove set</button>}
              </div>
            </section>
          )
        })}
      </div>

      <button type="button" className="btn btn-outline btn-block add-exercise" onClick={() => setPicker({})}><Plus size={18} /> Add an exercise</button>

      <section className="card workout-end">
        <div className="field">
          <label htmlFor="session-note">Note for this workout</label>
          <textarea id="session-note" className="textarea" rows={3} maxLength={2000} placeholder="How it felt, anything for your coach"
            value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== log.notes && saveNote.mutate(notes)} />
          {saveNote.error && <span className="xs bad">Note not saved: {saveNote.error.message}</span>}
        </div>
        {error && <div role="alert" className="auth-note err">{error}</div>}
        <button type="button" className="btn btn-primary btn-lg btn-block" disabled={finish.isPending || doneSets === 0} onClick={() => { setError(null); finish.mutate() }}>
          {finish.isPending ? 'Finishing…' : 'Finish workout'}
        </button>
        {doneSets === 0 && (
          <button type="button" className="btn btn-ghost btn-block" disabled={discard.isPending} onClick={() => { setError(null); discard.mutate() }}>
            Discard workout
          </button>
        )}
      </section>

      {picker && (
        <ExercisePicker library={library} swapFor={swapCard ? byId.get(swapCard.exercise_id) : undefined}
          exclude={new Set(cards.map((c) => c.exercise_id))} onPick={pick} onClose={() => setPicker(null)} />
      )}
    </div>
  )
}

const restLabel = (s: number) => (s >= 60 ? `${Math.round((s / 60) * 10) / 10} min` : `${s} s`)

// ---------- Finished ----------

function Summary({ log, library }: { log: WorkoutLog; library: LibraryExercise[] }) {
  const byId = new Map(library.map((e) => [e.id, e]))
  const s = summarize(
    { id: log.id, name: log.name, performed_on: log.performed_on, finished: true, duration_min: log.duration_min, notes: log.notes || null },
    [...log.sets].sort((a, b) => a.set_number - b.set_number).map((x) => ({ ...x, name: byId.get(x.exercise_id)?.name ?? 'Exercise', primary: byId.get(x.exercise_id)?.primary ?? [] })),
  )
  return (
    <div className="page workout-page">
      <Link to="/train" className="back-btn"><ChevronLeft size={18} /> Train</Link>
      <header className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h1>{log.name}</h1>
          <div className="sub">Finished · {weekday(log.performed_on)} {monthDay(log.performed_on)}</div>
        </div>
      </header>
      <section className="card summary-card">
        <div className="summary-tiles">
          <div className="tile"><span className="xs muted">Duration</span><b className="num">{s.duration_min != null ? `${s.duration_min} min` : '—'}</b></div>
          <div className="tile"><span className="xs muted">Sets</span><b className="num">{s.sets}</b></div>
          <div className="tile"><span className="xs muted">Volume</span><b className="num">{s.volume_kg > 0 ? volumeLabel(s.volume_kg, log.units) : '—'}</b></div>
          <div className="tile"><span className="xs muted">Muscles hit</span><b className="num">{s.muscles.length}</b></div>
        </div>
        {s.muscles.length > 0 && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
            {s.muscles.map((m) => <span key={m} className="pill good">{MUSCLE_LABEL[m]}</span>)}
          </div>
        )}
        <ul className="list-rows summary-list">
          {s.exercises.map((e) => (
            <li key={e.name}><b>{e.name}</b><div className="small muted">{setsLine(e.sets, log.units)}</div></li>
          ))}
        </ul>
        {s.notes && <p className="small" style={{ marginTop: 10 }}><b>Note:</b> {s.notes}</p>}
        <p className="xs muted" style={{ marginTop: 10 }}>Your coach can see this workout. The body map on Train now includes these sets.</p>
        <Link to="/train" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 16 }}>Back to Train</Link>
      </section>
    </div>
  )
}
