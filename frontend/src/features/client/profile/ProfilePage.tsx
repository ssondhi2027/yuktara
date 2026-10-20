import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { api, type MyProfile } from '@/lib/api'
import { setUnits } from '@/lib/auth'
import { monthDay } from '@/lib/dates'
import { DIET_LABEL, EXPERIENCE_LABEL, GOAL_LABEL, LOCATION_LABEL, MEALS_LABEL, WEEKDAY_LABEL } from '@/lib/labels'
import { heightProblem, nameProblem, phoneProblem, textProblem, weightProblem } from '@/lib/profile'
import { CM_PER_IN, inputFromKg, kgFromInput, litres, unitLabel } from '@/lib/units'
import type { DietType, TrainLocation, UnitSystem } from '@/types/db'
import { useAuth } from '@/app/auth'
import { PageError, PageLoading } from '@/components/ui/Loading'
import './profile.css'
import { AvatarUpload } from '@/components/ui/AvatarUpload'
import { GuestCard, GuestDeleteSheet } from '@/components/guest/Guest'

/** /settings: the client's own answers (editable), what the coach controls (read-only), units and log out. */
export function ProfilePage() {
  const { data, error, isPending } = useQuery({ queryKey: ['my-profile'], queryFn: api.myProfile })
  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />
  // Keyed by unit: switching kg/lb reloads the form in the new unit.
  return <Profile key={data.units} p={data} />
}

interface Form {
  full_name: string; height: string; goal_weight: string; diet: DietType | ''; foods_to_avoid: string
  meals_per_day: string; training_days: string; train_location: TrainLocation | ''; injuries: string; phone: string
}

function Profile({ p }: { p: MyProfile }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { user, refresh, signOut } = useAuth()
  const u = p.units
  const [f, setF] = useState<Form>({
    full_name: p.full_name,
    height: p.height_cm == null ? '' : String(u === 'imperial' ? Math.round((p.height_cm / CM_PER_IN) * 10) / 10 : p.height_cm),
    goal_weight: p.goal_weight_kg == null ? '' : inputFromKg(p.goal_weight_kg, u),
    diet: p.diet ?? '', foods_to_avoid: p.foods_to_avoid ?? '', meals_per_day: p.meals_per_day ? String(p.meals_per_day) : '',
    training_days: p.training_days ? String(p.training_days) : '', train_location: p.train_location ?? '', injuries: p.injuries ?? '',
    phone: p.phone ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [confirmGuest, setConfirmGuest] = useState(false)
  const set = (k: keyof Form, v: string) => { setF({ ...f, [k]: v }); setSaved(false); setErrors({ ...errors, [k]: '' }) }

  const save = useMutation({
    mutationFn: () => api.saveMyProfile({
      full_name: f.full_name,
      height_cm: f.height.trim() === '' ? null : Math.round((u === 'imperial' ? Number(f.height) * CM_PER_IN : Number(f.height)) * 10) / 10,
      goal_weight_kg: f.goal_weight.trim() === '' ? null : kgFromInput(Number(f.goal_weight), u),
      diet: f.diet || null,
      foods_to_avoid: f.foods_to_avoid,
      meals_per_day: f.meals_per_day ? Number(f.meals_per_day) : null,
      training_days: f.training_days ? Number(f.training_days) : null,
      train_location: f.train_location || null,
      injuries: f.injuries,
      phone: f.phone,
    }),
    onSuccess: async () => {
      setSaved(true)
      qc.invalidateQueries({ queryKey: ['my-profile'] })
      qc.invalidateQueries({ queryKey: ['client-home'] })
      await refresh() // the name in the menus
    },
    onError: (e) => setErrors({ save: e instanceof Error ? e.message : 'Could not save. Try again.' }),
  })
  const units = useMutation({ mutationFn: (x: UnitSystem) => setUnits(x) })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const found: Record<string, string> = {}
    const add = (k: string, m: string | null) => { if (m) found[k] = m }
    add('full_name', nameProblem(f.full_name))
    add('height', heightProblem(f.height, u))
    add('goal_weight', weightProblem(f.goal_weight, u))
    add('foods_to_avoid', textProblem(f.foods_to_avoid))
    add('injuries', textProblem(f.injuries))
    add('phone', phoneProblem(f.phone))
    setErrors(found)
    if (!Object.keys(found).length) save.mutate()
  }

  const field = (k: keyof Form, label: string, input: React.ReactNode, hint?: string) => (
    <div className="field">
      <label htmlFor={`p-${k}`}>{label}</label>
      {input}
      {errors[k] ? <span role="alert" className="xs bad">{errors[k]}</span> : hint && <span className="xs muted">{hint}</span>}
    </div>
  )
  const text = (k: keyof Form, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`p-${k}`} className="input" value={f[k]} onChange={(e) => set(k, e.target.value)} {...extra} />
  )

  const coachRows: [string, string][] = [
    ['Coach', p.coach?.full_name ?? 'Not linked yet'],
    ['Check-in day', p.coach ? `${WEEKDAY_LABEL[p.check_in_day]}s` : '—'],
    ['Goal', p.goal ? GOAL_LABEL[p.goal] : '—'],
    ['Experience', p.experience ? EXPERIENCE_LABEL[p.experience] : '—'],
    ['Started', monthDay(p.start_date)],
    ['Program', p.program ? `${p.program.name} · week ${Math.min(p.program.week, p.program.weeks)} of ${p.program.weeks}` : 'Not assigned yet'],
    ['Targets', p.targets ? `${p.targets.targets.calories.toLocaleString('en-US')} kcal · ${p.targets.targets.protein_g} g protein${p.targets.targets.water_ml ? ` · ${litres(p.targets.targets.water_ml)} water` : ''}` : 'Waiting for your coach'],
  ]

  return (
    <div className="page profile-page">
      <header className="page-head"><div><h1>Profile and settings</h1><div className="sub">{p.email}</div></div></header>
      <div className="profile-cols">
        <form className="card stack" style={{ gap: 14 }} noValidate onSubmit={submit}>
          <h2>About you</h2>
          {user && <AvatarUpload person={user} />}
          <p className="small muted">Your coach uses these answers to build your plan.</p>
          <div className="grid grid-2" style={{ gap: 12 }}>
            {field('full_name', 'Name', text('full_name', { maxLength: 80, autoComplete: 'name' }))}
            {field('phone', 'Phone (optional)', text('phone', { type: 'tel', maxLength: 32, autoComplete: 'tel' }), 'Only your coach sees it.')}
            {field('height', `Height (${u === 'imperial' ? 'in' : 'cm'})`, text('height', { type: 'number', inputMode: 'decimal', step: '0.1' }))}
            {field('goal_weight', `Goal weight (${unitLabel(u)})`, text('goal_weight', { type: 'number', inputMode: 'decimal', step: '0.1' }))}
            {field('training_days', 'Training days a week', (
              <select id="p-training_days" className="input" value={f.training_days} onChange={(e) => set('training_days', e.target.value)}>
                <option value="">Not set</option>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            ))}
            {field('train_location', 'Where you train', (
              <select id="p-train_location" className="input" value={f.train_location} onChange={(e) => set('train_location', e.target.value)}>
                <option value="">Not set</option>
                {(Object.keys(LOCATION_LABEL) as TrainLocation[]).map((l) => <option key={l} value={l}>{LOCATION_LABEL[l]}</option>)}
              </select>
            ))}
            {field('diet', 'Diet', (
              <select id="p-diet" className="input" value={f.diet} onChange={(e) => set('diet', e.target.value)}>
                <option value="">Not set</option>
                {(Object.keys(DIET_LABEL) as DietType[]).map((d) => <option key={d} value={d}>{DIET_LABEL[d]}</option>)}
              </select>
            ))}
            {field('meals_per_day', 'Meals a day', (
              <select id="p-meals_per_day" className="input" value={f.meals_per_day} onChange={(e) => set('meals_per_day', e.target.value)}>
                <option value="">Not set</option>
                {Object.entries(MEALS_LABEL).map(([n, l]) => <option key={n} value={n}>{l}</option>)}
              </select>
            ))}
          </div>
          {field('foods_to_avoid', 'Foods to avoid', text('foods_to_avoid', { maxLength: 2000, placeholder: 'Allergies, dislikes' }))}
          {field('injuries', 'Injuries or limits', (
            <textarea id="p-injuries" className="textarea" rows={3} maxLength={2000} value={f.injuries} onChange={(e) => set('injuries', e.target.value)} />
          ), 'Your coach sees this when building your program.')}
          {errors.save && <div role="alert" className="auth-note err">{errors.save}</div>}
          {saved && <div role="status" className="auth-note ok" style={{ marginTop: 0 }}>{user?.guest ? 'Saved on this device.' : 'Saved. Your coach sees the changes.'}</div>}
          <button className="btn btn-primary btn-lg" style={{ alignSelf: 'flex-start' }} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
        </form>

        <aside className="stack" style={{ gap: 16 }}>
          {user?.guest ? (
            <GuestCard text="A coach sets your program, targets and meal plan, and reviews your weekly check-ins. Guests log on their own." />
          ) : (
            <section className="card stack" style={{ gap: 10 }}>
              <h2>Set by your coach</h2>
              <dl className="profile-list">{coachRows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
              <p className="xs muted">Ask your coach in Messages to change any of these.</p>
            </section>
          )}
          <section className="card stack" style={{ gap: 10 }}>
            <h2>Settings</h2>
            <div className="between">
              <span>Weights</span>
              <div className="seg" role="group" aria-label="Weight units">
                {(['imperial', 'metric'] as UnitSystem[]).map((x) => (
                  <button key={x} type="button" aria-pressed={u === x} disabled={units.isPending} onClick={() => u !== x && units.mutate(x)}>{x === 'imperial' ? 'lb' : 'kg'}</button>
                ))}
              </div>
            </div>
            <button type="button" className="btn btn-ghost" onClick={async () => {
              if (user?.guest) return setConfirmGuest(true)
              await signOut()
              navigate('/login', { replace: true })
            }}>
              <LogOut size={16} /> {user?.guest ? 'Sign out and delete my data' : 'Log out'}
            </button>
            {confirmGuest && <GuestDeleteSheet onClose={() => setConfirmGuest(false)} />}
          </section>
        </aside>
      </div>
    </div>
  )
}
