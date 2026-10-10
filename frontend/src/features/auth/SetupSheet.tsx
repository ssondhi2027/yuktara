import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { useAuth } from '@/app/auth'
import { completeSetup, type SetupAnswers } from '@/lib/auth'
import { CheckMark } from './AuthPage'
import { ResendLink } from './ResendLink'

const TITLES = ['About you', 'Your goal', 'Your training', 'Food and health']
const SUBS = [
  'Step 1 of 4 · About 2 minutes in total',
  'Step 2 of 4 · Sets your targets and check-in day',
  'Step 3 of 4 · So your coach can build the right plan',
  'Step 4 of 4 · Your coach uses this for your food plan',
]
// Shown Monday first; stored with Postgres numbering (0 = Sunday).
const DAYS = [
  { label: 'M', aria: 'Monday', v: 1 }, { label: 'T', aria: 'Tuesday', v: 2 }, { label: 'W', aria: 'Wednesday', v: 3 },
  { label: 'T', aria: 'Thursday', v: 4 }, { label: 'F', aria: 'Friday', v: 5 }, { label: 'S', aria: 'Saturday', v: 6 },
  { label: 'S', aria: 'Sunday', v: 0 },
]
const GOALS = [
  { v: 'fat_loss', label: 'Lose fat', hint: 'Drop weight, keep muscle' },
  { v: 'muscle_gain', label: 'Build muscle', hint: 'Gain size and strength' },
  { v: 'performance', label: 'Performance', hint: 'Sport or event prep' },
  { v: 'health', label: 'Health and habits', hint: 'Feel better day to day' },
] as const

type Draft = Omit<SetupAnswers, 'body_model' | 'goal' | 'experience'> & {
  body_model: SetupAnswers['body_model'] | null
  goal: SetupAnswers['goal'] | null
  experience: SetupAnswers['experience'] | null
}

const EMPTY: Draft = {
  date_of_birth: '', body_model: null, units: 'imperial', height: '', phone: '',
  goal: null, weight: '', goal_weight: '', check_in_day: 0,
  experience: null, training_days: 3, train_location: 'gym', injuries: '',
  diet: 'none', foods_to_avoid: '', meals_per_day: 3, cleared_to_exercise: false,
}

export function SetupSheet({ email, fullName, coachFirstName, justCreated, justConfirmed, needsConfirm, onSaving, onClose }: {
  email: string
  fullName: string
  coachFirstName: string | null
  justCreated: boolean
  /** Opened from the confirm-email link. */
  justConfirmed: boolean
  needsConfirm: boolean
  onSaving: () => void
  onClose: () => void
}) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [d, setD] = useState<Draft>(EMPTY)
  const [err, setErr] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<null | 'saved' | 'pending'>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }))
    setErr((e) => { const n = { ...e }; delete n[k]; delete n.save; return n })
  }
  const imperial = d.units === 'imperial'
  const firstName = fullName.trim().split(/\s+/)[0] || 'there'

  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [step])
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const validate = (s: number) => {
    const e: Record<string, string> = {}
    const n = (v: string) => Number(v)
    if (s === 1) {
      if (!d.body_model) e.body_model = 'Choose a body type.'
      if (d.height && !(n(d.height) > (imperial ? 39 : 100) && n(d.height) < (imperial ? 98 : 250))) e.height = 'Check your height.'
      if (d.date_of_birth && d.date_of_birth >= new Date().toISOString().slice(0, 10)) e.date_of_birth = 'Check your date of birth.'
    }
    if (s === 2) {
      if (!d.goal) e.goal = 'Choose your main goal.'
      const lo = imperial ? 66 : 30
      const hi = imperial ? 660 : 300
      if (!d.weight) e.weight = 'Enter your current weight.'
      else if (!(n(d.weight) > lo && n(d.weight) < hi)) e.weight = 'Check this weight.'
      if (d.goal_weight && !(n(d.goal_weight) > lo && n(d.goal_weight) < hi)) e.goal_weight = 'Check this weight.'
    }
    if (s === 4 && !d.cleared_to_exercise) e.cleared = 'Please confirm before you finish.'
    setErr(e)
    return Object.keys(e).length === 0
  }

  const next = async () => {
    if (!validate(step)) return
    if (step < 4) return setStep(step + 1)
    setSaving(true)
    onSaving()
    try {
      const result = await completeSetup(d as SetupAnswers, email)
      setDone(result)
    } catch (e) {
      setErr({ save: e instanceof Error ? e.message : 'Could not save. Try again.' })
    } finally {
      setSaving(false)
    }
  }

  const opt = <K extends keyof Draft>(k: K, v: Draft[K], label: React.ReactNode, extra?: { aria?: string; className?: string }) => (
    <button key={String(v)} type="button" aria-pressed={d[k] === v} aria-label={extra?.aria}
      className={`setup-opt ${extra?.className ?? ''}`} onClick={() => set(k, v)}>{label}</button>
  )

  return createPortal(
    <div className="setup-backdrop">
      <div className="setup-sheet" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        {done ? (
          <div className="setup-done">
            <div className="done-badge"><CheckMark size={44} color="#0F2A20" /></div>
            {done === 'saved' ? (
              <>
                <h2 id="setup-title">You’re all set, {firstName}</h2>
                <p>
                  {coachFirstName ?? 'Your coach'} will look over your answers and send your first training and food plan within a day.
                  {!coachFirstName && ' If you have an invite code, ask your coach to link your account.'}
                </p>
                <button className="auth-btn primary narrow" onClick={() => { onClose(); navigate('/') }}>Go to home</button>
              </>
            ) : (
              <>
                <h2 id="setup-title">Confirm your email</h2>
                <p>We sent a link to <b>{email}</b>. Open it, then log in. Your answers are saved on this device and go to your coach when you log in here.</p>
                <ResendLink email={email} className="narrow" />
                <button className="auth-btn primary narrow" onClick={onClose}>Back to log in</button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="setup-head">
              <span className="grabber" aria-hidden />
              {justCreated ? (
                <div role="status" className="setup-banner">
                  <span className="dot"><CheckMark size={14} color="#fff" /></span>
                  <span>Account created for {email}{needsConfirm && '. Check your inbox to confirm it.'}</span>
                </div>
              ) : (
                <div className={`setup-banner${justConfirmed ? '' : ' muted-banner'}`}>
                  <span>
                    {justConfirmed ? 'Email confirmed' : `Welcome back${fullName ? `, ${firstName}` : ''}`}. Finish setting up to see your plan.
                  </span>
                  <button type="button" className="auth-link" onClick={() => signOut()}>Log out</button>
                </div>
              )}
              <div>
                <h2 id="setup-title">{TITLES[step - 1]}</h2>
                <span className="setup-sub">{SUBS[step - 1]}</span>
              </div>
              <div className="setup-progress" aria-hidden>
                {[1, 2, 3, 4].map((n) => <i key={n} className={n <= step ? 'on' : undefined} />)}
              </div>
            </div>

            <div className="setup-body" ref={bodyRef}>
              {step === 1 && (
                <>
                  <label className="auth-label">Date of birth
                    <input className="auth-input" type="date" value={d.date_of_birth} max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => set('date_of_birth', e.target.value)} />
                  </label>
                  {err.date_of_birth && <span className="field-err">{err.date_of_birth}</span>}
                  <fieldset className="setup-field">
                    <legend>Body type for your 3D body map</legend>
                    <div className="opt-grid two">
                      {opt('body_model', 'female', 'Female')}
                      {opt('body_model', 'male', 'Male')}
                    </div>
                    {err.body_model && <span className="field-err">{err.body_model}</span>}
                  </fieldset>
                  <fieldset className="setup-field">
                    <legend>Units</legend>
                    <div className="opt-grid two">
                      {opt('units', 'imperial', 'lb and in')}
                      {opt('units', 'metric', 'kg and cm')}
                    </div>
                  </fieldset>
                  <div className="opt-grid two gap10">
                    <label className="auth-label">Height ({imperial ? 'in' : 'cm'})
                      <input className="auth-input" type="number" inputMode="decimal" value={d.height} onChange={(e) => set('height', e.target.value)} />
                      {err.height && <span className="field-err">{err.height}</span>}
                    </label>
                    <label className="auth-label">Phone (optional)
                      <input className="auth-input" type="tel" autoComplete="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} />
                    </label>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <fieldset className="setup-field">
                    <legend>Main goal</legend>
                    <div className="opt-grid two">
                      {GOALS.map((g) => opt('goal', g.v, <><b>{g.label}</b><span>{g.hint}</span></>, { className: 'goal' }))}
                    </div>
                    {err.goal && <span className="field-err">{err.goal}</span>}
                  </fieldset>
                  <div className="opt-grid two gap10">
                    <label className="auth-label">Current weight ({imperial ? 'lb' : 'kg'})
                      <input className="auth-input" type="number" inputMode="decimal" value={d.weight} onChange={(e) => set('weight', e.target.value)} />
                      {err.weight && <span className="field-err">{err.weight}</span>}
                    </label>
                    <label className="auth-label">Goal weight ({imperial ? 'lb' : 'kg'})
                      <input className="auth-input" type="number" inputMode="decimal" value={d.goal_weight} onChange={(e) => set('goal_weight', e.target.value)} />
                      {err.goal_weight && <span className="field-err">{err.goal_weight}</span>}
                    </label>
                  </div>
                  <fieldset className="setup-field">
                    <legend className="sr-only">Weekly check-in day</legend>
                    <div className="setup-split" aria-hidden><span>Weekly check-in day</span><span className="auth-hint">You can change it later</span></div>
                    <div className="opt-grid seven">
                      {DAYS.map((day) => opt('check_in_day', day.v, day.label, { aria: day.aria, className: 'day' }))}
                    </div>
                  </fieldset>
                </>
              )}

              {step === 3 && (
                <>
                  <fieldset className="setup-field">
                    <legend>Training experience</legend>
                    <div className="opt-grid three">
                      {opt('experience', 'beginner', 'New')}
                      {opt('experience', 'intermediate', '1–3 years')}
                      {opt('experience', 'advanced', '3+ years')}
                    </div>
                  </fieldset>
                  <fieldset className="setup-field">
                    <legend>Days you can train each week</legend>
                    <div className="opt-grid five">
                      {[2, 3, 4, 5, 6].map((n) => opt('training_days', n, String(n)))}
                    </div>
                  </fieldset>
                  <fieldset className="setup-field">
                    <legend>Where you train</legend>
                    <div className="opt-grid three">
                      {opt('train_location', 'gym', 'Gym')}
                      {opt('train_location', 'home', 'Home')}
                      {opt('train_location', 'both', 'Both')}
                    </div>
                  </fieldset>
                  <label className="auth-label">Injuries or movements to avoid
                    <textarea className="auth-input area" rows={3} value={d.injuries} onChange={(e) => set('injuries', e.target.value)} />
                  </label>
                </>
              )}

              {step === 4 && (
                <>
                  <fieldset className="setup-field">
                    <legend>How you eat</legend>
                    <div className="opt-grid three">
                      {opt('diet', 'none', 'Anything')}
                      {opt('diet', 'vegetarian', 'Vegetarian')}
                      {opt('diet', 'eggetarian', 'Eggetarian')}
                      {opt('diet', 'vegan', 'Vegan')}
                      {opt('diet', 'halal', 'Halal')}
                      {opt('diet', 'other', 'Other')}
                    </div>
                  </fieldset>
                  <label className="auth-label">Allergies or foods you avoid
                    <input className="auth-input" value={d.foods_to_avoid} onChange={(e) => set('foods_to_avoid', e.target.value)} />
                  </label>
                  <label className="auth-label">Meals you usually eat a day
                    <select className="auth-input" value={d.meals_per_day} onChange={(e) => set('meals_per_day', Number(e.target.value))}>
                      <option value={2}>2 meals</option>
                      <option value={3}>3 meals</option>
                      <option value={4}>3 meals and a snack</option>
                      <option value={5}>3 meals and 2 snacks</option>
                    </select>
                  </label>
                  <button type="button" role="checkbox" aria-checked={d.cleared_to_exercise} className="auth-check top"
                    onClick={() => set('cleared_to_exercise', !d.cleared_to_exercise)}>
                    <span className="box">{d.cleared_to_exercise && <CheckMark />}</span>
                    <span>I’m able to exercise safely, and I’ll tell my coach about any medical condition that affects training or diet.</span>
                  </button>
                  {err.cleared && <span className="field-err">{err.cleared}</span>}
                </>
              )}
              {err.save && <div role="alert" className="auth-note err">{err.save}</div>}
            </div>

            <div className="setup-foot">
              <button type="button" className="auth-btn outline" disabled={step === 1} onClick={() => setStep(step - 1)}>Back</button>
              <button type="button" className="auth-btn primary grow2" disabled={saving} onClick={next}>
                {saving ? 'Saving…' : step < 4 ? 'Continue' : 'Finish setup'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
