import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Search } from 'lucide-react'
import { api, COACH_REFRESH, type NutritionRow, type Targets } from '@/lib/api'
import { addDays, monthDay, parseDate, shortDay, today } from '@/lib/dates'
import { DIET_LABEL, GOAL_LABEL, MEALS_LABEL } from '@/lib/labels'
import { effectiveFromProblem, macroCalories } from '@/lib/targets'
import { bodyWeight, litres } from '@/lib/units'
import { useLayout } from '@/app/hooks'
import { useUnits } from '@/app/auth'
import { Avatar } from '@/components/ui/Avatar'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { EMPTY_TARGETS, TargetsForm, targetsProblem } from '@/features/coach/clients/TargetsForm'
import '@/features/coach/review/review.css'
import '@/features/coach/dashboard/dashboard.css'
import '@/features/coach/clients/clients.css'
import './nutrition.css'
import { MealPlanEditor } from './MealPlanEditor'

/** Keys for everything that shows targets (the client's own screens refetch on their side). */
const TARGET_KEYS = [['nutrition-rows'], ['target-history'], ['client-detail'], ['coach-clients'], ['coach-dashboard'], ['review']]

const nextMonday = (iso: string) => addDays(iso, ((8 - parseDate(iso).getDay()) % 7) || 7)
const summary = (t: Targets) => `${t.calories.toLocaleString('en-US')} kcal · P ${t.protein_g} g · C ${t.carbs_g} g · F ${t.fat_g} g`

/**
 * /coach/nutrition and /coach/nutrition/:clientId
 *  tablet and desktop — clients on the left, the targets editor on the right
 *  phone  — list, then the editor
 */
export function NutritionPage() {
  const { clientId } = useParams()
  const layout = useLayout()
  const detail = clientId ? <TargetsEditor id={clientId} key={clientId} /> : null
  if (layout === 'phone') {
    return detail ? (
      <div className="page">
        <Link to="/coach/nutrition" className="back-link"><ChevronLeft size={18} /> Nutrition plans</Link>
        {detail}
      </div>
    ) : <div className="page"><TargetsList /></div>
  }
  return (
    <div className="split clients-split">
      <aside className="split-list"><TargetsList selected={clientId} /></aside>
      <div className="split-detail">
        {detail ?? <div className="builder-pick"><b>Pick a client</b><p className="small muted">Set calories, macros, water, steps and sleep, and a meal plan, from today or a later date.</p></div>}
      </div>
    </div>
  )
}

function TargetsList({ selected }: { selected?: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ['nutrition-rows'], queryFn: api.nutritionRows, ...COACH_REFRESH })
  const [q, setQ] = useState('')
  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = data
    .filter((r) => r.status !== 'archived' && words.every((w) => r.client.full_name.toLowerCase().includes(w)))
    .sort((a, b) => Number(!!a.current) - Number(!!b.current) || a.client.full_name.localeCompare(b.client.full_name))
  const missing = data.filter((r) => r.status !== 'archived' && !r.current).length
  return (
    <div className="stack client-list">
      <header>
        <h1>Nutrition plans</h1>
        <div className="muted small">{missing ? `${missing} without targets` : 'Every client has targets'}</div>
      </header>
      <label className="search-field">
        <Search size={16} />
        <input className="input" type="search" placeholder="Search by name" aria-label="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <ul className="list-plain" style={{ gap: 6 }}>
        {list.map((r) => <Row key={r.client.id} r={r} selected={r.client.id === selected} />)}
      </ul>
      {data.length === 0 && <p className="small muted">No clients yet.</p>}
    </div>
  )
}

function Row({ r, selected }: { r: NutritionRow; selected: boolean }) {
  return (
    <li>
      <Link to={`/coach/nutrition/${r.client.id}`} className={`program-row link-row${selected ? ' selected' : ''}`} aria-current={selected ? 'page' : undefined}>
        <Avatar person={r.client} />
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="truncate" style={{ display: 'block' }}>{r.client.full_name}</b>
          <div className="xs muted truncate">
            {r.current ? <>{summary(r.current.targets)} · since {monthDay(r.current.effective_from)}</> : <span className="bad">No targets yet</span>}
          </div>
          {r.next && <div className="xs good truncate">Next: {r.next.targets.calories.toLocaleString('en-US')} kcal from {shortDay(r.next.effective_from)}</div>}
        </div>
      </Link>
    </li>
  )
}

function TargetsEditor({ id }: { id: string }) {
  const qc = useQueryClient()
  const units = useUnits()
  const t = today()
  const client = useQuery({ queryKey: ['client-detail', id], queryFn: () => api.clientDetail(id), ...COACH_REFRESH })
  const versions = useQuery({ queryKey: ['target-history', id], queryFn: () => api.targetHistory(id), ...COACH_REFRESH })
  const [draft, setDraft] = useState<Targets | null>(null)
  const [when, setWhen] = useState<'today' | 'monday' | 'date'>('today')
  const [date, setDate] = useState(nextMonday(t))
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const from = when === 'today' ? t : when === 'monday' ? nextMonday(t) : date

  const save = useMutation({
    mutationFn: (x: Targets) => api.setTargets(id, x, from),
    onSuccess: () => {
      TARGET_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }))
      setSaved(from === t ? `Saved. ${client.data?.client.first_name ?? 'The client'} sees the new targets now.` : `Saved. They start ${shortDay(from)}.`)
    },
    onError: (e) => setProblem(e instanceof Error ? e.message : 'Could not save. Try again.'),
  })

  if (client.isPending || versions.isPending) return <PageLoading />
  if (client.error) return <PageError error={client.error} />
  if (versions.error) return <PageError error={versions.error} />
  const c = client.data
  const value = draft ?? c.targets ?? EMPTY_TARGETS

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const p = targetsProblem(value) ?? effectiveFromProblem(from, t)
    setProblem(p)
    setSaved(null)
    if (!p) save.mutate(value)
  }

  const facts: [string, string | null][] = [
    ['Goal', c.goal ? GOAL_LABEL[c.goal] : null],
    ['Weight', c.start_weight_kg != null ? `${bodyWeight(c.start_weight_kg, units)}${c.goal_weight_kg != null ? ` → goal ${bodyWeight(c.goal_weight_kg, units)}` : ''}` : null],
    ['Diet', c.diet ? DIET_LABEL[c.diet] : null],
    ['Avoids', c.foods_to_avoid],
    ['Meals', c.meals_per_day ? MEALS_LABEL[c.meals_per_day] ?? `${c.meals_per_day} a day` : null],
  ]

  return (
    <div className="stack nutrition-editor" style={{ gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 28 }}>{c.client.full_name}</h1>
        <div className="small muted">
          {c.targets ? `Current targets since ${monthDay(c.targets_from ?? t)}` : 'No targets yet: the client sees "waiting for your coach".'}
          {' · '}<Link className="link" to={`/coach/clients/${id}`}>Client profile</Link>
        </div>
      </header>

      <div className="nutrition-cols">
        <form className="card stack" style={{ gap: 14 }} onSubmit={submit} noValidate>
          <h3>{c.targets ? 'Change targets' : 'Set targets'}</h3>
          <TargetsForm value={value} onChange={(x) => { setDraft(x); setSaved(null); setProblem(null) }} idPrefix={`n-${id}`} />
          <fieldset className="when">
            <legend className="xs muted">Starts</legend>
            <label className="checkbox"><input type="radio" name="when" checked={when === 'today'} onChange={() => setWhen('today')} /> Today</label>
            <label className="checkbox"><input type="radio" name="when" checked={when === 'monday'} onChange={() => setWhen('monday')} /> Next Monday ({monthDay(nextMonday(t))})</label>
            <label className="checkbox">
              <input type="radio" name="when" checked={when === 'date'} onChange={() => setWhen('date')} /> On
              <input type="date" className="input" style={{ width: 'auto', height: 36 }} min={t} value={date} aria-label="Start date"
                onChange={(e) => { setDate(e.target.value); setWhen('date') }} />
            </label>
          </fieldset>
          {problem && <div role="alert" className="auth-note err">{problem}</div>}
          {saved && <div role="status" className="auth-note ok" style={{ marginTop: 0 }}>{saved}</div>}
          <button className="btn btn-primary btn-lg btn-block" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : from === t ? 'Save, starting today' : `Save, starting ${shortDay(from)}`}
          </button>
        </form>

        <aside className="stack" style={{ gap: 16 }}>
          <section className="card stack" style={{ gap: 8 }}>
            <h3>About {c.client.first_name}</h3>
            <dl className="answers-list">
              {facts.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
            {macroCalories(value) > 0 && <p className="xs muted">Macros: {Math.round((value.protein_g * 4 / Math.max(1, macroCalories(value))) * 100)}% protein, {Math.round((value.carbs_g * 4 / Math.max(1, macroCalories(value))) * 100)}% carbs, {Math.round((value.fat_g * 9 / Math.max(1, macroCalories(value))) * 100)}% fat</p>}
          </section>

          <section className="card stack" style={{ gap: 8 }}>
            <h3>History</h3>
            {versions.data.length === 0 ? <p className="small muted">No targets set yet.</p> : (
              <ul className="list-rows">
                {versions.data.map((v) => (
                  <li key={v.effective_from} className="small">
                    <div className="between" style={{ gap: 8 }}>
                      <b>{v.effective_from > t ? `From ${shortDay(v.effective_from)}` : `Since ${monthDay(v.effective_from)}`}</b>
                      {v.effective_from > t ? <span className="pill gold">Upcoming</span> : v.effective_from === c.targets_from ? <span className="pill good">Current</span> : null}
                    </div>
                    <div className="muted">{summary(v.targets)}</div>
                    <div className="xs muted">
                      {[v.targets.water_ml ? `${litres(v.targets.water_ml)} water` : null, v.targets.steps ? `${v.targets.steps.toLocaleString('en-US')} steps` : null, v.targets.sleep_h ? `${v.targets.sleep_h} h sleep` : null].filter(Boolean).join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <MealPlanEditor c={c} key={`plan-${id}`} />
    </div>
  )
}
