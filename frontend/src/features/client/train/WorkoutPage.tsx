import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Award, Check, ChevronLeft, Minus, Plus, Trash2 } from 'lucide-react'
import {
  api, TRAINING_KEYS, type LastTime, type LibraryExercise, type PlannedExercise, type SetWrite, type WorkoutLog,
} from '@/lib/api'
import { clockTime, monthDay, weekday } from '@/lib/dates'
import { MUSCLE_LABEL } from '@/lib/muscles'
import {
  BODYWEIGHT, dropSuggestionKg, minutesSince, OWN_WORKOUT, plainReps, roundOrder, setsLine, summarize, supersetBlocks, supersetLine,
  toDisplay, toKg, volumeLabel, weightUnit,
} from '@/lib/workouts'
import { LOAD_STEP } from '@/lib/units'
import { recordCount, setBadges, visibleRecords, type ExerciseInfo, type RecordKind, type RecordSet } from '@/lib/records'
import type { UnitSystem } from '@/types/db'
import { useCelebrations } from '@/app/hooks'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { RecordBadges, RecordList } from '@/components/records/Records'
import {
  cardioTargetText, cardioTotals, distanceText, distanceUnit, inputFromMetres, inputFromSeconds, metresFromInput, minutesText, parseDuration, ZONE_HINT,
} from '@/lib/cardio'
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

/** One set row. `dropOf`: a drop set, after the working set with that number. */
/** `time`, `dist`, `level`, `hr`: a cardio bout's fields, as typed. */
interface Row {
  n: number; warmup: boolean; dropOf: number | null; weight: string; reps: string; rpe: string
  time: string; dist: string; level: string; hr: string
  done: boolean; dirty: boolean; saving: boolean; error: string | null
}
interface Card { key: string; slot: PlannedExercise | null; exercise_id: string; rows: Row[] }

/**
 * What's kept in browser storage so a reload restores added and swapped
 * exercises, and the kind of rows not ticked yet ('w' warm-up, or the set a drop
 * follows). Ticked sets live in Supabase.
 */
interface Layout { cards: { key: string; slot_id: string | null; exercise_id: string; numbers: number[]; kinds?: Record<string, 'w' | number> }[] }

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
      cards: cards.map((c) => ({
        key: c.key, slot_id: c.slot?.template_exercise_id ?? null, exercise_id: c.exercise_id, numbers: c.rows.map((r) => r.n),
        kinds: Object.fromEntries(c.rows.flatMap((r): [number, 'w' | number][] => (r.warmup ? [[r.n, 'w']] : r.dropOf != null ? [[r.n, r.dropOf]] : []))),
      })),
    } satisfies Layout))
  } catch {
    // Storage blocked: the sets themselves are already saved.
  }
}

const emptyRow = (n: number, warmup = false, dropOf: number | null = null): Row =>
  ({ n, warmup, dropOf, weight: '', reps: '', rpe: '', time: '', dist: '', level: '', hr: '', done: false, dirty: false, saving: false, error: null })

/** Warm-ups first, then working sets in the order they were added, each followed by its drops. */
function ordered(rows: Row[]): Row[] {
  const heads = rows.filter((r) => !r.warmup && r.dropOf == null)
  const withDrops = heads.flatMap((h) => [h, ...rows.filter((r) => r.dropOf === h.n)])
  return [...rows.filter((r) => r.warmup), ...withDrops, ...rows.filter((r) => r.dropOf != null && !withDrops.includes(r))]
}

const isHead = (r: Row) => !r.warmup && r.dropOf == null

function loggedRow(s: SetWrite, units: UnitSystem): Row {
  return {
    n: s.set_number, warmup: !!s.is_warmup, dropOf: s.drop_of ?? null, done: true, dirty: false, saving: false, error: null,
    weight: s.weight_kg != null ? toDisplay(s.weight_kg, units) : '', reps: s.reps != null ? String(s.reps) : '', rpe: s.rpe != null ? String(s.rpe) : '',
    time: s.duration_s != null ? inputFromSeconds(s.duration_s) : '', dist: s.distance_m != null ? inputFromMetres(s.distance_m, units) : '',
    level: s.level != null ? String(s.level) : '', hr: s.avg_hr != null ? String(s.avg_hr) : '',
  }
}

/** Cards from the plan (or the saved layout), with every saved set in place. */
function buildCards(log: WorkoutLog, layout: Layout | null): Card[] {
  const range = (k: number) => Array.from({ length: k }, (_, i) => i + 1)
  const cards: { key: string; slot: PlannedExercise | null; exercise_id: string; numbers: number[]; kinds?: Record<string, 'w' | number> }[] = layout
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
    rows: ordered([...c.numbers].sort((a, b) => a - b).map((n) => {
      const s = log.sets.find((x) => x.exercise_id === c.exercise_id && x.set_number === n)
      const kind = c.kinds?.[n]
      return s ? loggedRow(s, log.units) : emptyRow(n, kind === 'w', typeof kind === 'number' ? kind : null)
    })),
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

  // Record badges: the ticked sets against the bests from earlier workouts (lib/records.ts).
  const bests = useQuery({
    queryKey: ['record-bests', log.id, exerciseIds.join(',')],
    queryFn: () => api.recordBests(log.id, exerciseIds),
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  })
  const badges = useMemo(() => {
    const info: ExerciseInfo = new Map([...byId.values()].map((e) => [e.id, { name: e.name, bodyweight: BODYWEIGHT.has(e.equipment), cardio: e.kind === 'cardio' }]))
    return setBadges(bests.data ?? {}, cards.flatMap((c) => c.rows.filter((r) => r.done).map((r) => tickedSet(c, r, units, info.get(c.exercise_id)?.cardio))), info)
  }, [bests.data, cards, byId, units])

  const refresh = () => TRAINING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }))
  const update = (key: string, f: (c: Card) => Card) => setCards((cs) => cs.map((c) => (c.key === key ? f(c) : c)))
  const updateRow = (key: string, n: number, patch: Partial<Row>) =>
    update(key, (c) => ({ ...c, rows: c.rows.map((r) => (r.n === n ? { ...r, ...patch } : r)) }))

  const cardioCard = (c: Card) => byId.get(c.exercise_id)?.kind === 'cardio'
  const doneSets = cards.reduce((k, c) => k + c.rows.filter((r) => r.done).length, 0)
  const doneWarmups = cards.reduce((k, c) => k + c.rows.filter((r) => r.done && r.warmup).length, 0)
  const doneDrops = cards.reduce((k, c) => k + c.rows.filter((r) => r.done && r.dropOf != null).length, 0)
  const doneBouts = cards.filter(cardioCard).flatMap((c) => c.rows.filter((r) => r.done))
  const doneHard = doneSets - doneWarmups - doneDrops - doneBouts.length
  const cardioDone = cardioTotals(doneBouts.map((r) => ({ duration_s: parseDuration(r.time) })))

  /**
   * Validates a row (blank fields of a working set take their placeholder: last
   * time's matching working set, or the plan) and saves it as a set.
   */
  async function save(c: Card, r: Row, lastTime: LastTime | undefined) {
    if (cardioCard(c)) return saveBout(c, r, lastTime)
    const e = byId.get(c.exercise_id)
    const head = r.dropOf != null ? c.rows.find((x) => x.n === r.dropOf) : undefined
    if (r.dropOf != null && !head?.done) return updateRow(c.key, r.n, { error: 'Tick the set above first.' })
    // A drop suggests a lighter weight than its set and no reps; nothing comes from last time.
    const prev = r.warmup || head ? undefined : previousFor(c, r, lastTime)
    const dropKg = head ? dropSuggestionKg(headWeightKg(head, units), units) : null
    const weight = r.weight.trim() || (head ? (dropKg != null ? toDisplay(dropKg, units) : '') : prev?.weight_kg != null ? toDisplay(prev.weight_kg, units) : '')
    const reps = r.reps.trim() || (r.warmup || head ? '' : String(plainReps(c.slot?.reps) ?? prev?.reps ?? ''))
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
      await api.saveSet(log.id, {
        exercise_id: c.exercise_id, template_exercise_id: c.slot?.template_exercise_id ?? null, set_number: r.n,
        weight_kg: kg, reps: repsN, rpe: rpeN, is_warmup: r.warmup, drop_of: r.dropOf,
      })
      updateRow(c.key, r.n, { saving: false, done: true, dirty: false, weight, reps, rpe })
      refresh()
    } catch (err) {
      updateRow(c.key, r.n, { saving: false, error: err instanceof Error ? err.message : 'Could not save. Try again.' })
    }
  }

  /**
   * A cardio bout: a blank time takes the plan's minutes (or last time's), a
   * blank distance the plan's distance; level, heart rate and RPE are optional.
   */
  async function saveBout(c: Card, r: Row, lastTime: LastTime | undefined) {
    const prev = previousFor(c, r, lastTime)
    const planned = c.slot?.minutes != null ? Math.round(c.slot.minutes * 60) : prev?.duration_s ?? null
    const seconds = r.time.trim() ? parseDuration(r.time) : planned
    if (seconds == null || seconds > 86400) return updateRow(c.key, r.n, { error: 'Time: minutes (30), or minutes and seconds (30:15).' })
    const metres = r.dist.trim() ? metresFromInput(r.dist, units) : c.slot?.distance_m ?? null
    if (r.dist.trim() && (metres == null || metres > 1_000_000)) return updateRow(c.key, r.n, { error: `Distance: in ${distanceUnit(units)}, e.g. 5.2.` })
    const level = r.level.trim() === '' ? null : Number(r.level)
    if (level != null && !(level >= 0 && level <= 100 && level * 2 === Math.round(level * 2))) return updateRow(c.key, r.n, { error: 'Level or incline: 0 to 100.' })
    const hr = r.hr.trim() === '' ? null : Number(r.hr)
    if (hr != null && !(Number.isInteger(hr) && hr >= 30 && hr <= 250)) return updateRow(c.key, r.n, { error: 'Heart rate: 30 to 250 bpm.' })
    const rpe = r.rpe.trim() === '' ? null : Number(r.rpe)
    if (rpe != null && (!(rpe >= 1 && rpe <= 10) || rpe * 2 !== Math.round(rpe * 2))) return updateRow(c.key, r.n, { error: 'RPE: 1 to 10, in steps of 0.5.' })
    updateRow(c.key, r.n, { saving: true, error: null })
    try {
      await api.saveSet(log.id, {
        exercise_id: c.exercise_id, template_exercise_id: c.slot?.template_exercise_id ?? null, set_number: r.n,
        weight_kg: null, reps: null, rpe, is_warmup: false, drop_of: null, duration_s: seconds, distance_m: metres, level, avg_hr: hr,
      })
      updateRow(c.key, r.n, {
        saving: false, done: true, dirty: false, time: inputFromSeconds(seconds), dist: metres != null ? inputFromMetres(metres, units) : '',
      })
      refresh()
    } catch (err) {
      updateRow(c.key, r.n, { saving: false, error: err instanceof Error ? err.message : 'Could not save. Try again.' })
    }
  }

  async function untick(c: Card, r: Row) {
    updateRow(c.key, r.n, { saving: true, error: null })
    try {
      await api.deleteSet(log.id, c.exercise_id, r.n)
      // Unticking a working set also unticks its drops (they're deleted with it).
      update(c.key, (x) => ({ ...x, rows: x.rows.map((y) => (y.n === r.n ? { ...y, saving: false, done: false } : y.dropOf === r.n && isHead(r) ? { ...y, done: false } : y)) }))
      refresh()
    } catch (err) {
      updateRow(c.key, r.n, { saving: false, error: err instanceof Error ? err.message : 'Could not undo. Try again.' })
    }
  }

  /** Removes the last working set (with its drops), or the last row if there's no working set. */
  async function removeLast(c: Card) {
    const r = [...c.rows].reverse().find(isHead) ?? c.rows.at(-1)
    if (!r) return
    if (r.done) await untick(c, r)
    update(c.key, (x) => ({ ...x, rows: x.rows.filter((y) => y.n !== r.n && !(isHead(r) && y.dropOf === r.n)) }))
  }

  /** "Add drop": a drop right under the set (after any drops it already has). */
  const addDrop = (c: Card, head: Row) => update(c.key, (x) => ({ ...x, rows: ordered([...x.rows, emptyRow(nextN(x), false, head.n)]) }))

  async function removeDrop(c: Card, r: Row) {
    if (r.done) await untick(c, r)
    update(c.key, (x) => ({ ...x, rows: x.rows.filter((y) => y.n !== r.n) }))
  }

  /** A drop back into a normal working set (saved again if it was ticked). */
  async function makeNormal(c: Card, r: Row, lastTime: LastTime | undefined) {
    const next = { ...r, dropOf: null }
    const rows = ordered(c.rows.map((y) => (y.n === r.n ? next : y)))
    update(c.key, (x) => ({ ...x, rows }))
    if (r.done) await save({ ...c, rows }, next, lastTime)
  }

  const nextN = (c: Card) => Math.max(0, ...c.rows.map((y) => y.n)) + 1
  const addSet = (c: Card) => update(c.key, (x) => ({ ...x, rows: [...x.rows, emptyRow(nextN(x))] }))
  const addWarmup = (c: Card) => update(c.key, (x) => ({ ...x, rows: ordered([...x.rows, emptyRow(nextN(x), true)]) }))

  /** Switches a set between warm-up and working; a ticked set is saved again with the new kind. */
  async function toggleWarmup(c: Card, r: Row, lastTime: LastTime | undefined) {
    if (r.saving) return
    if (r.dropOf != null) return makeNormal(c, r, lastTime)
    if (c.rows.some((y) => y.dropOf === r.n)) return updateRow(c.key, r.n, { error: "A warm-up can't have drops. Remove its drops first." })
    const next = { ...r, warmup: !r.warmup }
    update(c.key, (x) => ({ ...x, rows: ordered(x.rows.map((y) => (y.n === r.n ? next : y))) }))
    if (r.done) await save({ ...c, rows: ordered(c.rows.map((y) => (y.n === r.n ? next : y))) }, next, lastTime)
  }

  const pick = (e: LibraryExercise) => {
    if (picker?.swap) update(picker.swap, (c) => ({ ...c, exercise_id: e.id }))
    // A cardio exercise starts with one bout; strength with three sets.
    else setCards((cs) => [...cs, { key: `x-${e.id}`, slot: null, exercise_id: e.id, rows: (e.kind === 'cardio' ? [1] : [1, 2, 3]).map((n) => emptyRow(n)) }])
    setPicker(null)
  }

  const saveNote = useMutation({ mutationFn: (text: string) => api.saveWorkoutNote(log.id, text) })
  const [effort, setEffort] = useState<number | null>(null)
  const finish = useMutation({
    mutationFn: async () => {
      if (notes !== log.notes) await api.saveWorkoutNote(log.id, notes)
      return api.finishWorkout(log.id, effort)
    },
    onSuccess: () => {
      writeLayout(log.id, null)
      justFinished.add(log.id)
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
  const view: LoggerView = {
    units, byId, last: last.data, badges, updateRow, save, untick, toggleWarmup, addSet, addWarmup, removeLast, addDrop, removeDrop, makeNormal,
    swap: (c) => setPicker({ swap: c.key }), remove: (c) => setCards((cs) => cs.filter((x) => x.key !== c.key)),
  }

  return (
    <div className="page workout-page">
      <Link to="/train" className="back-btn"><ChevronLeft size={18} /> Train</Link>
      <header className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h1>{log.name}</h1>
          <div className="sub">
            {log.started_at ? `Started ${clockTime(log.started_at)}` : weekday(log.performed_on)}
            {elapsed != null && ` · ${elapsed} min`} · {doneHard} {doneHard === 1 ? 'set' : 'sets'} logged
            {cardioDone.seconds > 0 && ` + ${minutesText(cardioDone.seconds)} cardio`}
            {doneDrops > 0 && ` + ${doneDrops} drop${doneDrops === 1 ? '' : 's'}`}
            {doneWarmups > 0 && ` + ${doneWarmups} warm-up${doneWarmups === 1 ? '' : 's'}`}
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
        {supersetBlocks(cards.map((c) => ({ card: c, superset: cardioCard(c) ? null : c.slot?.superset ?? null }))).map((block) => block.label && block.items.length > 1
          ? <SupersetBlock key={`ss-${block.label}-${block.items[0].card.key}`} label={block.label} cards={block.items.map((x) => x.card)} view={view} />
          : <ExerciseCard key={block.items[0].card.key} c={block.items[0].card} view={view} />)}
      </div>

      <button type="button" className="btn btn-outline btn-block add-exercise" onClick={() => setPicker({})}><Plus size={18} /> Add an exercise</button>

      <section className="card workout-end">
        <EffortPicker value={effort} onChange={setEffort} />
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

const EFFORT_HINT = ['', 'Very easy', 'Easy', 'Easy', 'Moderate', 'Moderate', 'Somewhat hard', 'Hard', 'Very hard', 'Near max', 'All out']

/** "How hard was this workout?" 1–10, optional; tap the chosen number again to clear it. */
function EffortPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <fieldset className="field effort-field">
      <legend>How hard was this workout?</legend>
      <div className="effort-scale" role="radiogroup" aria-label="Effort, 1 to 10">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} className={value === n ? 'on' : undefined}
            onClick={() => onChange(value === n ? null : n)}>{n}</button>
        ))}
      </div>
      <div className="between xs muted"><span>1 · very easy</span><b>{value != null ? `${value} · ${EFFORT_HINT[value]}` : 'Optional'}</b><span>10 · all out</span></div>
    </fieldset>
  )
}

/** A ticked row as the records see it (what's typed, in kg; a cardio bout's time and metres). */
function tickedSet(c: Card, r: Row, units: UnitSystem, cardio = false): RecordSet {
  const w = Number(r.weight)
  const rpe = Number(r.rpe)
  if (cardio) {
    return {
      exercise_id: c.exercise_id, set_number: r.n, weight_kg: null, reps: null, rpe: null,
      duration_s: parseDuration(r.time), distance_m: r.dist.trim() ? metresFromInput(r.dist, units) : null,
    }
  }
  return {
    exercise_id: c.exercise_id, set_number: r.n, weight_kg: r.weight.trim() !== '' && Number.isFinite(w) ? toKg(w, units) : null,
    reps: r.reps.trim() !== '' && Number.isInteger(Number(r.reps)) ? Number(r.reps) : null,
    rpe: r.rpe.trim() !== '' && Number.isFinite(rpe) ? rpe : null, is_warmup: r.warmup, drop_of: r.dropOf,
  }
}

/** Last time's working set to suggest for this row: the same position among working sets (drops left out), else the last one. */
function previousFor(c: Card, r: Row, lastTime: LastTime | undefined) {
  const i = c.rows.filter(isHead).findIndex((x) => x.n === r.n)
  const sets = (lastTime?.sets ?? []).filter((x) => x.drop_of == null)
  return sets[i] ?? sets.at(-1)
}

/** The set's weight in kg (from what was typed in the user's unit), for a drop's suggestion. */
function headWeightKg(r: Row, units: UnitSystem): number | null {
  const v = Number(r.weight)
  return r.weight.trim() !== '' && Number.isFinite(v) ? toKg(v, units) : null
}

// ---------- Exercise cards and supersets ----------

/** What the cards need from the logger. */
interface LoggerView {
  units: UnitSystem
  byId: Map<string, LibraryExercise>
  last: Record<string, LastTime> | undefined
  /** record kinds by "exerciseId:setNumber" */
  badges: Map<string, RecordKind[]>
  updateRow: (key: string, n: number, patch: Partial<Row>) => void
  save: (c: Card, r: Row, lastTime: LastTime | undefined) => Promise<void>
  untick: (c: Card, r: Row) => Promise<void>
  toggleWarmup: (c: Card, r: Row, lastTime: LastTime | undefined) => Promise<void>
  addSet: (c: Card) => void
  addWarmup: (c: Card) => void
  removeLast: (c: Card) => Promise<void>
  addDrop: (c: Card, head: Row) => void
  removeDrop: (c: Card, r: Row) => Promise<void>
  makeNormal: (c: Card, r: Row, lastTime: LastTime | undefined) => Promise<void>
  swap: (c: Card) => void
  remove: (c: Card) => void
}

/** Name, the coach's targets, cue, notes and last time for one exercise (with its A1/A2 tag in a superset). */
function CardHead({ c, view, tag, inSuperset }: { c: Card; view: LoggerView; tag?: string; inSuperset?: boolean }) {
  const e = view.byId.get(c.exercise_id)
  const lastTime = view.last?.[c.exercise_id]
  const anyDone = c.rows.some((r) => r.done)
  const swappedFrom = c.slot && c.slot.exercise_id !== c.exercise_id ? c.slot.name : null
  return (
    <>
      <div className="ex-card-head">
        {tag && <span className="ss-tag" aria-label={`Superset ${tag}`}>{tag}</span>}
        <div className="grow" style={{ minWidth: 0 }}>
          <h2 className="ex-name">{e?.name ?? c.slot?.name ?? 'Exercise'}</h2>
          {swappedFrom && <div className="xs muted">Swapped from {swappedFrom} for today</div>}
          {c.slot && e?.kind === 'cardio' ? (
            <div className="small plan-line">
              {cardioTargetText(c.slot, view.units)}
              {c.slot.zone && <span className="xs muted zone-hint"> ({ZONE_HINT[c.slot.zone]})</span>}
            </div>
          ) : c.slot && (
            <div className="small plan-line">
              {c.slot.sets} × {c.slot.reps}{c.slot.rpe != null && ` · RPE ${c.slot.rpe}`}
              {!inSuperset && c.slot.rest_seconds != null && ` · rest ${restLabel(c.slot.rest_seconds)}`}
            </div>
          )}
        </div>
        {!anyDone && (
          <button type="button" className="icon-btn" aria-label={`Swap ${e?.name ?? 'exercise'}`} title="Swap for today" onClick={() => view.swap(c)}>
            <ArrowLeftRight size={18} />
          </button>
        )}
        {!c.slot && !anyDone && (
          <button type="button" className="icon-btn" aria-label={`Remove ${e?.name ?? 'exercise'}`} onClick={() => view.remove(c)}>
            <Trash2 size={18} />
          </button>
        )}
      </div>
      {c.slot?.notes && <p className="small ex-coach-note"><b>Coach:</b> {c.slot.notes}</p>}
      {(e?.cue ?? c.slot?.cue) && <p className="xs muted ex-cue-line">{e?.cue ?? c.slot?.cue}</p>}
      <p className="xs last-time">
        {lastTime ? <>Last time ({monthDay(lastTime.date)}): {setsLine(lastTime.sets, view.units)}</> : 'First time logging this one.'}
      </p>
    </>
  )
}

function SetHead({ units }: { units: UnitSystem }) {
  return (
    <div className="set-row set-head" role="row">
      <span role="columnheader">Set</span>
      <span role="columnheader">{weightUnit(units)}</span>
      <span role="columnheader">Reps</span>
      <span role="columnheader">RPE</span>
      <span role="columnheader" className="sr-only">Done</span>
    </div>
  )
}

/** One set (warm-up, working set or drop), plus "Add drop" under a ticked working set. */
function SetRow({ c, r, view, label }: { c: Card; r: Row; view: LoggerView; label?: string }) {
  const { units } = view
  const e = view.byId.get(c.exercise_id)
  const lastTime = view.last?.[c.exercise_id]
  const bw = BODYWEIGHT.has(e?.equipment ?? '')
  const drop = r.dropOf != null
  const head = drop ? c.rows.find((x) => x.n === r.dropOf) : undefined
  const prev = r.warmup || drop ? undefined : previousFor(c, r, lastTime)
  const k = r.warmup ? c.rows.filter((x) => x.warmup).indexOf(r) + 1 : drop ? 0 : c.rows.filter(isHead).indexOf(r) + 1
  const name = `${label ? `${label} ` : ''}${r.warmup ? `warm-up ${k}` : drop ? 'drop' : `set ${k}`}`.replace(/^./, (x) => x.toUpperCase())
  const dropKg = head ? dropSuggestionKg(headWeightKg(head, units), units) : null
  const weightHint = r.warmup ? (bw ? 'BW' : '–') : drop ? (dropKg != null ? toDisplay(dropKg, units) : bw ? 'BW' : '–')
    : prev?.weight_kg != null ? toDisplay(prev.weight_kg, units) : bw ? 'BW' : '–'
  const field = (f: 'weight' | 'reps' | 'rpe', what: string, placeholder: string, step: string, mode: 'decimal' | 'numeric') => (
    <input className="input set-input" type="number" inputMode={mode} step={step} min="0" aria-label={`${name} ${what}`}
      placeholder={r.done ? '–' : placeholder} value={r[f]} disabled={r.saving}
      onChange={(ev) => view.updateRow(c.key, r.n, { ...({ [f]: ev.target.value } as Pick<Row, typeof f>), dirty: r.done, error: null })}
      onBlur={() => { if (r.done && r.dirty) void view.save(c, r, lastTime) }} />
  )
  const drops = c.rows.filter((x) => x.dropOf === (drop ? r.dropOf : r.n))
  const lastOfChain = isHead(r) ? drops.length === 0 : drops.at(-1) === r
  const chainHead = isHead(r) ? r : head
  return (
    <>
      <div className={`set-row${r.done ? ' done' : ''}${r.warmup ? ' warmup' : ''}${drop ? ' drop' : ''}`} role="row">
        <button type="button" className="set-n num" aria-pressed={r.warmup} disabled={r.saving}
          aria-label={drop ? `${name}: tap to make it a normal set` : `${name}: ${r.warmup ? 'warm-up, tap to make it a working set' : 'tap to mark as a warm-up'}`}
          title={drop ? 'Drop (tap to make it a normal set)' : r.warmup ? 'Warm-up (tap to make it a working set)' : 'Tap to mark as a warm-up'}
          onClick={() => void view.toggleWarmup(c, r, lastTime)}>{r.warmup ? 'W' : drop ? '↳' : k}</button>
        {field('weight', weightUnit(units), weightHint, String(LOAD_STEP[units]), 'decimal')}
        {field('reps', 'reps', r.warmup || drop ? '–' : c.slot?.reps ?? (prev?.reps != null ? String(prev.reps) : '–'), '1', 'numeric')}
        {field('rpe', 'RPE', !r.warmup && !drop && c.slot?.rpe != null ? String(c.slot.rpe) : '–', '0.5', 'decimal')}
        <button type="button" className="set-tick" aria-pressed={r.done} aria-label={r.done ? `Undo ${name.toLowerCase()}` : `${name} done`}
          disabled={r.saving} onClick={() => void (r.done ? view.untick(c, r) : view.save(c, r, lastTime))}>
          <Check size={20} />
        </button>
        {r.error && <div role="alert" className="set-error xs">{r.error}</div>}
        {r.done && <RecordBadges kinds={view.badges.get(`${c.exercise_id}:${r.n}`) ?? []} />}
      </div>
      {drop && !r.saving && (
        <div className="drop-actions xs">
          <button type="button" className="link" onClick={() => void view.removeDrop(c, r)}>Remove drop</button>
          <button type="button" className="link" onClick={() => void view.makeNormal(c, r, lastTime)}>Make it a normal set</button>
        </div>
      )}
      {lastOfChain && chainHead?.done && (
        <button type="button" className="add-drop xs" onClick={() => view.addDrop(c, chainHead)} aria-label={`Add a drop after ${name.toLowerCase()}`}>
          ↳ Add drop
        </button>
      )}
    </>
  )
}

function ExerciseCard({ c, view }: { c: Card; view: LoggerView }) {
  const e = view.byId.get(c.exercise_id)
  if (e?.kind === 'cardio') return <CardioCard c={c} view={view} />
  return (
    <section className="card ex-card">
      <CardHead c={c} view={view} />
      <div className="set-grid" role="table" aria-label={`${e?.name ?? 'Exercise'} sets`}>
        <SetHead units={view.units} />
        {c.rows.map((r) => <SetRow key={r.n} c={c} r={r} view={view} />)}
      </div>
      <div className="row set-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => view.addSet(c)}><Plus size={16} /> Add set</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => view.addWarmup(c)}><Plus size={16} /> Warm-up</button>
        {c.rows.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void view.removeLast(c)}><Minus size={16} /> Remove set</button>}
      </div>
    </section>
  )
}

/**
 * A cardio exercise: one row per bout or round (time, distance, RPE), with
 * level or incline and heart rate under "More details". No warm-ups or drops.
 */
function CardioCard({ c, view }: { c: Card; view: LoggerView }) {
  const e = view.byId.get(c.exercise_id)
  const { units } = view
  const lastTime = view.last?.[c.exercise_id]
  const [details, setDetails] = useState(() => c.rows.some((r) => r.level || r.hr))
  const rounds = c.rows.length
  return (
    <section className="card ex-card cardio-card">
      <CardHead c={c} view={view} />
      <div className="set-grid" role="table" aria-label={`${e?.name ?? 'Cardio'} rounds`}>
        <div className="set-row set-head" role="row">
          <span role="columnheader">#</span>
          <span role="columnheader">Time</span>
          <span role="columnheader">{distanceUnit(units)}</span>
          <span role="columnheader">RPE</span>
          <span role="columnheader" className="sr-only">Done</span>
        </div>
        {c.rows.map((r, i) => {
          const name = rounds > 1 ? `Round ${i + 1}` : 'Bout'
          const prev = previousFor(c, r, lastTime)
          const timeHint = c.slot?.minutes != null ? inputFromSeconds(Math.round(c.slot.minutes * 60)) : prev?.duration_s != null ? inputFromSeconds(prev.duration_s) : 'min'
          const distHint = c.slot?.distance_m != null ? inputFromMetres(c.slot.distance_m, units) : prev?.distance_m != null ? inputFromMetres(prev.distance_m, units) : '–'
          const field = (f: 'time' | 'dist' | 'rpe' | 'level' | 'hr', what: string, placeholder: string, mode: 'decimal' | 'numeric', extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
            <input className="input set-input" inputMode={mode} aria-label={`${name} ${what}`} placeholder={r.done ? '–' : placeholder} value={r[f]} disabled={r.saving}
              {...extra}
              onChange={(ev) => view.updateRow(c.key, r.n, { ...({ [f]: ev.target.value } as Pick<Row, typeof f>), dirty: r.done, error: null })}
              onBlur={() => { if (r.done && r.dirty) void view.save(c, r, lastTime) }} />
          )
          return (
            <div key={r.n} className={`set-row${r.done ? ' done' : ''}`} role="row">
              <span className="set-n num" aria-hidden="true">{i + 1}</span>
              {field('time', 'time, minutes or mm:ss', timeHint, 'decimal', { type: 'text', autoComplete: 'off' })}
              {field('dist', `distance in ${distanceUnit(units)}`, distHint, 'decimal', { type: 'number', step: '0.01', min: '0' })}
              {field('rpe', 'RPE', '–', 'decimal', { type: 'number', step: '0.5', min: '1', max: '10' })}
              <button type="button" className="set-tick" aria-pressed={r.done} aria-label={r.done ? `Undo ${name.toLowerCase()}` : `${name} done`}
                disabled={r.saving} onClick={() => void (r.done ? view.untick(c, r) : view.save(c, r, lastTime))}>
                <Check size={20} />
              </button>
              {details && (
                <div className="cardio-more">
                  <label className="xs muted">Level or incline{field('level', 'level or incline', '–', 'decimal', { type: 'number', step: '0.5', min: '0', max: '100' })}</label>
                  <label className="xs muted">Avg heart rate{field('hr', 'average heart rate, bpm', 'bpm', 'numeric', { type: 'number', step: '1', min: '30', max: '250' })}</label>
                </div>
              )}
              {r.error && <div role="alert" className="set-error xs">{r.error}</div>}
              {r.done && <RecordBadges kinds={view.badges.get(`${c.exercise_id}:${r.n}`) ?? []} />}
            </div>
          )
        })}
      </div>
      {c.rows.some((r) => r.done && r.dist.trim()) && (
        <p className="xs muted cardio-total">
          Total: {minutesText(cardioTotals(c.rows.filter((r) => r.done).map((r) => ({ duration_s: parseDuration(r.time) }))).seconds)}
          {' · '}{distanceText(c.rows.filter((r) => r.done).reduce((a, r) => a + (metresFromInput(r.dist, units) ?? 0), 0), units)}
        </p>
      )}
      <div className="row set-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => view.addSet(c)}><Plus size={16} /> Add round</button>
        {c.rows.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void view.removeLast(c)}><Minus size={16} /> Remove round</button>}
        <button type="button" className="btn btn-ghost btn-sm" aria-pressed={details} onClick={() => setDetails(!details)}>{details ? 'Fewer details' : 'More details'}</button>
      </div>
    </section>
  )
}

/**
 * A superset: its exercises in one frame (A1, A2…), warm-ups first, then the
 * working sets round by round (A1 set 1, A2 set 1, rest, A1 set 2…), each with
 * its drops. The rest is the last exercise's, taken after the round.
 */
function SupersetBlock({ label, cards, view }: { label: string; cards: Card[]; view: LoggerView }) {
  const rest = cards.at(-1)?.slot?.rest_seconds
  const tags = cards.map((_, i) => `${label}${i + 1}`)
  const rounds = roundOrder(cards.map((c) => c.rows.filter(isHead)))
  const names = cards.map((c) => view.byId.get(c.exercise_id)?.name ?? c.slot?.name ?? 'Exercise')
  return (
    <section className="card ex-card superset-card" aria-label={`Superset ${label}: ${names.join(' and ')}`}>
      <div className="ss-head">
        <b>Superset {label}</b>
        <span className="xs muted">{rest != null ? `rest ${restLabel(rest)} after ${cards.length === 2 ? 'both' : 'each round'}` : 'back to back'}</span>
      </div>
      {cards.map((c, i) => <div key={c.key} className="ss-member"><CardHead c={c} view={view} tag={tags[i]} inSuperset /></div>)}
      <div className="set-grid" role="table" aria-label={`Superset ${label} sets, in round order`}>
        <SetHead units={view.units} />
        {cards.flatMap((c, i) => c.rows.filter((r) => r.warmup).map((r) => (
          <div key={`${c.key}-w${r.n}`} className="ss-set"><span className="ss-row-tag xs">{tags[i]} · {names[i]}</span><SetRow c={c} r={r} view={view} label={tags[i]} /></div>
        )))}
        {rounds.map(({ round, member, set }) => {
          const c = cards[member]
          return (
            <div key={`${c.key}-${set.n}`} className="ss-set">
              {member === 0 && <div className="ss-round xs">Round {round}</div>}
              <span className="ss-row-tag xs">{tags[member]} · {names[member]}</span>
              <SetRow c={c} r={set} view={view} label={tags[member]} />
              {c.rows.filter((x) => x.dropOf === set.n).map((d) => <SetRow key={d.n} c={c} r={d} view={view} label={tags[member]} />)}
            </div>
          )
        })}
      </div>
      <div className="row set-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => cards.forEach(view.addSet)}><Plus size={16} /> Add round</button>
        {rounds.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { for (const c of cards) void view.removeLast(c) }}><Minus size={16} /> Remove round</button>}
      </div>
    </section>
  )
}

const restLabel = (s: number) => (s >= 60 ? `${Math.round((s / 60) * 10) / 10} min` : `${s} s`)

// ---------- Finished ----------

/** Workouts finished in this tab just now: their summary opens with the celebration (if it's on). */
const justFinished = new Set<string>()

/** "2 new personal records", each listed; a brief, calm moment right after Finish unless turned off in Settings. */
function RecordsCard({ log }: { log: WorkoutLog }) {
  const [celebrations] = useCelebrations()
  const [fresh] = useState(() => justFinished.delete(log.id))
  const shown = visibleRecords(log.records, log.units)
  if (!shown.length) return null
  return (
    <section className={`card records-card${fresh && celebrations ? ' celebrate' : ''}`} aria-live="polite">
      <div className="records-head">
        <span className="records-icon" aria-hidden="true"><Award size={20} /></span>
        <div>
          <h2 style={{ fontSize: 18 }}>{recordCount(shown.length)}</h2>
          <div className="small muted">New record. Nice work.</div>
        </div>
      </div>
      <RecordList records={shown} units={log.units} />
    </section>
  )
}

/** The planned supersets this workout had, by exercise name (swaps for today included). */
function supersetsOf(log: WorkoutLog, byId: Map<string, LibraryExercise>): string[][] {
  const groups = new Map<string, string[]>()
  for (const p of log.plan) {
    if (!p.superset) continue
    const done = log.sets.find((x) => x.template_exercise_id === p.template_exercise_id)
    const name = done ? byId.get(done.exercise_id)?.name ?? p.name : p.name
    groups.set(p.superset, [...(groups.get(p.superset) ?? []), name])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

function Summary({ log, library }: { log: WorkoutLog; library: LibraryExercise[] }) {
  const byId = new Map(library.map((e) => [e.id, e]))
  const sorted = [...log.sets].sort((a, b) => a.set_number - b.set_number)
  // Counts, volume and muscles are working sets only; warm-ups are listed, greyed.
  const s = summarize(
    { id: log.id, name: log.name, performed_on: log.performed_on, finished: true, duration_min: log.duration_min, notes: log.notes || null, effort: log.effort },
    sorted.filter((x) => !x.is_warmup).map((x) => ({
      ...x, name: byId.get(x.exercise_id)?.name ?? 'Exercise', primary: byId.get(x.exercise_id)?.primary ?? [], cardio: byId.get(x.exercise_id)?.kind === 'cardio',
    })),
  )
  const warmups = (exerciseName: string) => sorted.filter((x) => x.is_warmup && (byId.get(x.exercise_id)?.name ?? 'Exercise') === exerciseName)
  const warmupOnly = [...new Set(sorted.filter((x) => x.is_warmup).map((x) => byId.get(x.exercise_id)?.name ?? 'Exercise'))]
    .filter((n) => !s.exercises.some((e) => e.name === n))
  return (
    <div className="page workout-page">
      <Link to="/train" className="back-btn"><ChevronLeft size={18} /> Train</Link>
      <header className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h1>{log.name}</h1>
          <div className="sub">Finished · {weekday(log.performed_on)} {monthDay(log.performed_on)}</div>
        </div>
      </header>
      <RecordsCard log={log} />
      <section className="card summary-card">
        <div className="summary-tiles">
          <div className="tile"><span className="xs muted">Duration</span><b className="num">{s.duration_min != null ? `${s.duration_min} min` : '—'}</b></div>
          <div className="tile"><span className="xs muted">Sets</span><b className="num">{s.sets}</b></div>
          <div className="tile"><span className="xs muted">Volume</span><b className="num">{s.volume_kg > 0 ? volumeLabel(s.volume_kg, log.units) : '—'}</b></div>
          {(s.cardio_s ?? 0) > 0 && (
            <div className="tile"><span className="xs muted">Cardio</span><b className="num">{minutesText(s.cardio_s!)}{s.cardio_m ? ` · ${distanceText(s.cardio_m, log.units)}` : ''}</b></div>
          )}
          <div className="tile"><span className="xs muted">Muscles hit</span><b className="num">{s.muscles.length}</b></div>
          <div className="tile"><span className="xs muted">Effort</span><b className="num">{log.effort != null ? `${log.effort} / 10` : '—'}</b></div>
        </div>
        {s.muscles.length > 0 && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
            {s.muscles.map((m) => <span key={m} className="pill good">{MUSCLE_LABEL[m]}</span>)}
          </div>
        )}
        {supersetsOf(log, byId).map((names) => <p key={names.join('+')} className="small ss-note">{supersetLine(names)}</p>)}
        <ul className="list-rows summary-list">
          {[...s.exercises, ...warmupOnly.map((name) => ({ name, sets: [] }))].map((e) => (
            <li key={e.name}>
              <b>{e.name}</b>
              {warmups(e.name).length > 0 && <div className="xs muted warmup-line">Warm-up: {setsLine(warmups(e.name), log.units)}</div>}
              {e.sets.length > 0 && <div className="small muted">{setsLine(e.sets, log.units)}</div>}
            </li>
          ))}
        </ul>
        {s.notes && <p className="small" style={{ marginTop: 10 }}><b>Note:</b> {s.notes}</p>}
        <p className="xs muted" style={{ marginTop: 10 }}>Your coach can see this workout. The body map on Train now includes these sets.</p>
        <Link to="/train" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 16 }}>Back to Train</Link>
      </section>
    </div>
  )
}
