import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, ClipboardList, Lock, X } from 'lucide-react'
import { api, type CheckinDraft } from '@/lib/api'
import { monthDay, weekRange, weekday } from '@/lib/dates'
import { bodyWeight, cmToIn, inputFromKg, int, inToCm, kgFromInput, unitLabel } from '@/lib/units'
import { useUnits } from '@/app/auth'
import type { PhotoPose } from '@/types/db'
import { PageError, PageLoading } from '@/components/ui/Loading'
import './checkin.css'

const STEPS = ['Body', 'Feel', 'Photos', 'Notes'] as const

const SCALES = [
  { key: 'energy', label: 'Energy', hint: '1 low · 5 high' },
  { key: 'sleep', label: 'Sleep quality', hint: '1 poor · 5 great' },
  { key: 'stress', label: 'Stress', hint: '1 calm · 5 very stressed' },
  { key: 'hunger', label: 'Hunger', hint: '1 rarely · 5 all the time' },
] as const

export function CheckinPage() {
  const { data, error, isPending } = useQuery({ queryKey: ['checkin'], queryFn: api.checkinDraft })
  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />
  if (!data) return <NotOpen />
  if (data.status !== 'due') return <Sent />
  return <Wizard initial={data} />
}

/** No check-in open: say when the next one opens. */
function NotOpen() {
  const { data } = useQuery({ queryKey: ['client-home'], queryFn: api.clientHome })
  const next = data?.check_in.next_date
  return (
    <div className="page checkin">
      <div className="card sent">
        <span className="sent-icon"><ClipboardList size={30} /></span>
        <h1>No check-in open</h1>
        <p className="muted">
          {next ? `Your next check-in opens ${weekday(next)}, ${monthDay(next)}. ` : ''}
          Until then, keep logging meals, steps, sleep and weight: they fill in most of it for you.
        </p>
        <Link to="/" className="btn btn-primary btn-lg">Back to Home</Link>
      </div>
    </div>
  )
}

function Wizard({ initial }: { initial: CheckinDraft }) {
  const [step, setStep] = useState(0)
  const [d, setD] = useState(initial)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const set = (patch: Partial<CheckinDraft>) => setD((x) => ({ ...x, ...patch }))

  const save = useMutation({ mutationFn: (draft: Partial<CheckinDraft>) => api.saveCheckin(draft) })
  const submit = useMutation({
    mutationFn: async () => {
      await api.saveCheckin(d)
      return api.submitCheckin(d)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checkin'] })
      qc.invalidateQueries({ queryKey: ['client-home'] })
      qc.invalidateQueries({ queryKey: ['progress'] })
    },
  })

  // Save the draft whenever the client moves between steps, so closing midway loses nothing.
  const go = (next: number) => {
    save.mutate(d)
    setStep(next)
    window.scrollTo({ top: 0 })
  }

  const feelDone = SCALES.every((s) => d[s.key] != null)
  const canContinue = step !== 1 || feelDone
  const last = step === STEPS.length - 1

  return (
    <div className="page checkin">
      <header className="checkin-head">
        <button className="icon-btn" aria-label="Close and save" onClick={() => { save.mutate(d); navigate('/') }}><X size={22} /></button>
        <div>
          <h1>Weekly check-in</h1>
          <div className="muted">Week {d.week} · {weekRange(d.week_start)}</div>
        </div>
      </header>

      <nav className="steps" aria-label="Check-in steps">
        {STEPS.map((s, i) => (
          <button key={s} type="button" className={`step ${i < step ? 'done' : i === step ? 'current' : ''}`}
            aria-current={i === step ? 'step' : undefined} onClick={() => i < step && go(i)} disabled={i > step}>
            {i + 1} {s}
          </button>
        ))}
      </nav>

      <div className="auto-box">
        <div className="eyebrow">Filled in from your logs</div>
        <p>
          Training {d.auto.workouts_planned ? `${d.auto.workouts_done} of ${d.auto.workouts_planned}` : d.auto.workouts_done} sessions ·
          Meals {d.auto.meals_on_plan} of {d.auto.meals_planned} on plan ·
          Steps {d.auto.steps_avg == null ? '—' : int(d.auto.steps_avg)} a day
        </p>
      </div>

      <section className="checkin-step">
        {step === 0 && <BodyStep d={d} set={set} />}
        {step === 1 && (
          <div className="stack" style={{ gap: 20 }}>
            {SCALES.map((s) => (
              <fieldset key={s.key} className="scale">
                <legend className="between"><b>{s.label}</b><span className="muted small">{s.hint}</span></legend>
                <div className="scale-row">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button key={v} type="button" className="scale-btn" aria-pressed={d[s.key] === v} onClick={() => set({ [s.key]: v })}>{v}</button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}
        {step === 2 && <PhotosStep d={d} set={set} />}
        {step === 3 && (
          <div className="stack" style={{ gap: 18 }}>
            <div className="field">
              <label htmlFor="wins">Wins this week</label>
              <textarea id="wins" className="textarea" placeholder="New best on squats, prepped lunches…" value={d.wins} onChange={(e) => set({ wins: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="hard">What was hard</label>
              <textarea id="hard" className="textarea" placeholder="Late nights, travel, cravings…" value={d.struggles} onChange={(e) => set({ struggles: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="q">Question for your coach <span className="faint">(optional)</span></label>
              <textarea id="q" className="textarea" style={{ minHeight: 90 }} value={d.question} onChange={(e) => set({ question: e.target.value })} />
            </div>
            <CoachQuestions d={d} set={set} />
          </div>
        )}
        {submit.error && <div role="alert" className="auth-note err" style={{ marginTop: 14 }}>{submit.error.message}</div>}
      </section>

      <footer className="checkin-foot">
        {step > 0 ? (
          <button className="btn btn-outline btn-lg btn-square" onClick={() => go(step - 1)}>Back</button>
        ) : (
          <Link to="/" className="btn btn-outline btn-lg btn-square" onClick={() => save.mutate(d)}>Later</Link>
        )}
        {last ? (
          <button className="btn btn-primary btn-lg btn-square grow" disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? 'Sending…' : 'Send check-in'}
          </button>
        ) : (
          <button className="btn btn-primary btn-lg btn-square grow" disabled={!canContinue} onClick={() => go(step + 1)}>
            Continue
          </button>
        )}
      </footer>
    </div>
  )
}

function BodyStep({ d, set }: { d: CheckinDraft; set: (p: Partial<CheckinDraft>) => void }) {
  // Waist and hips are typed in inches and saved in cm. Keep what was typed
  // as text so a half-typed "30." isn't rewritten mid-entry.
  const toIn = (cm: number | null) => (cm == null ? '' : String(+cmToIn(cm).toFixed(1)))
  const [waistIn, setWaistIn] = useState(() => toIn(d.waist_cm))
  const [hipsIn, setHipsIn] = useState(() => toIn(d.hips_cm))
  const fromIn = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? null : inToCm(Number(v)))
  // Weight is typed in the user's unit and saved in kg, the same way.
  const units = useUnits()
  const [weight, setWeight] = useState(() => (d.weight_kg == null ? '' : inputFromKg(d.weight_kg, units)))
  const toKgOrNull = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? null : kgFromInput(Number(v), units))
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="field">
        <label htmlFor="weight">Average weight this week ({unitLabel(units)})</label>
        <input id="weight" className="input big-input" inputMode="decimal" value={weight}
          onChange={(e) => { setWeight(e.target.value); set({ weight_kg: toKgOrNull(e.target.value) }) }} />
        <span className="small muted">
          {d.auto.avg_weight_kg != null
            ? `From your ${bodyWeight(d.auto.avg_weight_kg, units)} daily weigh-in average. Change it if a weigh-in was off.`
            : 'No weigh-ins logged this week. Enter your usual morning weight.'}
        </span>
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="waist">Waist (in)</label>
          <input id="waist" className="input big-input" inputMode="decimal" placeholder="At the navel" value={waistIn}
            onChange={(e) => { setWaistIn(e.target.value); set({ waist_cm: fromIn(e.target.value) }) }} />
        </div>
        <div className="field">
          <label htmlFor="hips">Hips (in)</label>
          <input id="hips" className="input big-input" inputMode="decimal" placeholder="Widest point" value={hipsIn}
            onChange={(e) => { setHipsIn(e.target.value); set({ hips_cm: fromIn(e.target.value) }) }} />
        </div>
      </div>
    </div>
  )
}

function PhotosStep({ d, set }: { d: CheckinDraft; set: (p: Partial<CheckinDraft>) => void }) {
  const poses: PhotoPose[] = ['front', 'side', 'back']
  return (
    <div className="stack">
      <div className="photo-grid">
        {poses.map((p) => (
          <label key={p} className={`photo-slot${d.photos[p] ? ' has' : ''}`}>
            {d.photos[p] ? <img src={d.photo_previews?.[p] ?? d.photos[p]} alt={`${p} photo`} /> : <Camera size={26} />}
            <span className="photo-label">{p[0].toUpperCase() + p.slice(1)}</span>
            <input type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  const url = URL.createObjectURL(f)
                  set({ photos: { ...d.photos, [p]: url }, photo_previews: { ...d.photo_previews, [p]: url } })
                }
              }} />
          </label>
        ))}
      </div>
      <p className="small muted row" style={{ gap: 8 }}><Lock size={14} /> Only you and your coach can see these. Same light, same spot each week.</p>
    </div>
  )
}

/** The coach's own check-in questions (checkin_questions), answered by type. */
function CoachQuestions({ d, set }: { d: CheckinDraft; set: (p: Partial<CheckinDraft>) => void }) {
  const qs = d.questions ?? []
  if (!qs.length) return null
  const answers = d.answers ?? {}
  const put = (id: string, v: { value_number?: number | null; value_text?: string | null }) =>
    set({ answers: { ...answers, [id]: { ...answers[id], ...v } } })
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="eyebrow">From your coach</div>
      {qs.map((q) => {
        const a = answers[q.id] ?? {}
        return (
          <div key={q.id} className="field">
            <label htmlFor={`q-${q.id}`}>{q.prompt}</label>
            {q.answer_type === 'text' && (
              <textarea id={`q-${q.id}`} className="textarea" style={{ minHeight: 80 }} value={a.value_text ?? ''}
                onChange={(e) => put(q.id, { value_text: e.target.value })} />
            )}
            {q.answer_type === 'number' && (
              <input id={`q-${q.id}`} className="input" type="number" inputMode="decimal" value={a.value_number ?? ''}
                onChange={(e) => put(q.id, { value_number: e.target.value === '' ? null : Number(e.target.value) })} />
            )}
            {q.answer_type === 'scale' && (
              <div className="scale-row" role="group" aria-label={q.prompt}>
                {[1, 2, 3, 4, 5].map((v) => (
                  <button key={v} type="button" className="scale-btn" aria-pressed={a.value_number === v} onClick={() => put(q.id, { value_number: v })}>{v}</button>
                ))}
              </div>
            )}
            {q.answer_type === 'yes_no' && (
              <div className="scale-row two" role="group" aria-label={q.prompt}>
                {[['Yes', 1], ['No', 0]].map(([label, v]) => (
                  <button key={label} type="button" className="scale-btn" aria-pressed={a.value_number === v} onClick={() => put(q.id, { value_number: v as number })}>{label}</button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Sent() {
  return (
    <div className="page checkin">
      <div className="card sent">
        <span className="sent-icon"><Check size={32} /></span>
        <h1>Check-in sent</h1>
        <p className="muted">Your coach usually replies within a day. You'll see their feedback on Home.</p>
        <Link to="/" className="btn btn-primary btn-lg">Back to Home</Link>
      </div>
    </div>
  )
}
