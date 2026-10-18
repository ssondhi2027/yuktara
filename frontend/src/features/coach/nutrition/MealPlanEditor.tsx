import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { api, COACH_REFRESH, type ClientDetail } from '@/lib/api'
import { addDays, monthDay, parseDate, shortDay, today } from '@/lib/dates'
import { DIET_LABEL } from '@/lib/labels'
import {
  avoidMatch, avoidTerms, dayNutrition, lineNutrition, lineProblem, mealsFor, planDays, PLAN_DAY_LABEL, setSplit, sumNutrition, vsTarget,
  type MealPlan, type PlanDay, type PlanMeal,
} from '@/lib/meals'
import { effectiveFromProblem } from '@/lib/targets'
import type { MealType } from '@/types/db'
import { Segmented } from '@/components/ui/Segmented'
import { FoodPicker } from '@/components/food/FoodPicker'
import { FoodLineRow, TotalsRow, draftOf, lineOf, newDraft, type LineDraft } from '@/components/food/FoodLineRow'
import { FoodForm } from './FoodForm'
import '@/components/food/food.css'

const TYPE_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' }
const ORDER: MealType[] = ['breakfast', 'snack', 'lunch', 'dinner']
const nextMonday = (iso: string) => addDays(iso, ((8 - parseDate(iso).getDay()) % 7) || 7)
const PLAN_KEYS = [['meal-plans'], ['meal-plan-templates'], ['plan-week']]

/** The editor's working copy: lines keep their typed amounts. */
interface EditMeal { day: PlanDay; meal_type: MealType; notes: string; lines: LineDraft[] }
interface Draft { name: string; split: boolean; meals: EditMeal[] }

const toDraft = (p: MealPlan | null, types: MealType[]): Draft => {
  const meals: EditMeal[] = (p?.meals ?? []).map((m) => ({ day: m.day, meal_type: m.meal_type, notes: m.notes, lines: m.lines.map(draftOf) }))
  const split = p?.split ?? false
  for (const day of planDays(split)) for (const t of types) if (!meals.some((m) => m.day === day && m.meal_type === t)) meals.push({ day, meal_type: t, notes: '', lines: [] })
  return { name: p?.name ?? 'Meal plan', split, meals }
}
const toPlan = (d: Draft, clientId: string | null, from: string | null): MealPlan => ({
  id: null, client_id: clientId, name: d.name.trim() || 'Meal plan', effective_from: from, split: d.split,
  meals: d.meals.filter((m) => planDays(d.split).includes(m.day)).map((m): PlanMeal => ({ day: m.day, meal_type: m.meal_type, notes: m.notes, lines: m.lines.map(lineOf) })),
})

/**
 * The client's meal plan on the Nutrition page: foods with amounts per meal
 * (from the food list), a note per meal, the day's totals against the client's
 * targets, their diet and foods to avoid (with a warning on a match). Saved from
 * today or a later date, like targets; also saved and reused as templates.
 */
export function MealPlanEditor({ c }: { c: ClientDetail }) {
  const qc = useQueryClient()
  const id = c.client.id
  const t = today()
  const types = useMemo(() => mealsFor(c.meals_per_day), [c.meals_per_day])
  const versions = useQuery({ queryKey: ['meal-plans', id], queryFn: () => api.mealPlans(id), ...COACH_REFRESH })
  const templates = useQuery({ queryKey: ['meal-plan-templates'], queryFn: api.mealPlanTemplates })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [day, setDay] = useState<PlanDay>('every')
  const [when, setWhen] = useState<'today' | 'monday' | 'date'>('today')
  const [date, setDate] = useState(nextMonday(t))
  const [templateName, setTemplateName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ meal: MealType; name: string } | null>(null)
  const from = when === 'today' ? t : when === 'monday' ? nextMonday(t) : date
  const terms = avoidTerms(c.foods_to_avoid)

  const current = versions.data?.find((v) => v.effective_from! <= t) ?? null
  const latest = versions.data?.[0] ?? null
  const d = draft ?? toDraft(latest, types)
  const shownDay = planDays(d.split).includes(day) ? day : planDays(d.split)[0]
  const edit = (f: (x: Draft) => Draft) => { setDraft(f(d)); setProblem(null); setSaved(null) }
  const editMeal = (type: MealType, f: (m: EditMeal) => EditMeal) =>
    edit((x) => ({ ...x, meals: x.meals.map((m) => (m.day === shownDay && m.meal_type === type ? f(m) : m)) }))

  const save = useMutation({
    mutationFn: (asTemplate: boolean) => api.saveMealPlan(asTemplate ? { ...toPlan(d, null, null), name: templateName.trim() || d.name } : toPlan(d, id, from)),
    onSuccess: (_, asTemplate) => {
      PLAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }))
      if (asTemplate) setSaved(`Saved as a template: "${templateName.trim() || d.name}".`)
      else {
        setSaved(from === t ? `Saved. ${c.client.first_name} sees the plan on their Food page now.` : `Saved. It starts ${shortDay(from)}.`)
        setDraft(null)
      }
    },
    onError: (e) => setProblem(e instanceof Error ? e.message : 'Could not save. Try again.'),
  })
  const remove = useMutation({
    mutationFn: (planId: string) => api.deleteMealPlan(planId),
    onSuccess: () => PLAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k })),
    onError: (e) => setProblem(e instanceof Error ? e.message : 'Could not delete. Try again.'),
  })

  const submit = (asTemplate: boolean) => {
    const plan = toPlan(d, id, from)
    const lines = plan.meals.flatMap((m) => m.lines)
    const p = !lines.length ? 'Add at least one food.'
      : lines.map(lineProblem).find(Boolean)
        ?? (plan.meals.some((m) => m.notes.length > 300) ? 'Meal notes can be up to 300 characters.' : null)
        ?? (asTemplate ? null : effectiveFromProblem(from, t))
    setProblem(p ?? null)
    setSaved(null)
    if (!p) save.mutate(asTemplate)
  }

  if (versions.isPending) return <section className="card"><div className="skeleton" style={{ height: 200 }} /></section>
  const tg = c.targets
  const dayTotal = dayNutrition(toPlan(d, id, from), shownDay)
  const dayMeals = ORDER.filter((x) => types.includes(x) || d.meals.some((m) => m.day === shownDay && m.meal_type === x && (m.lines.length || m.notes)))
  const pct = (v: number, target?: number | null) => {
    const r = vsTarget(v, target)
    return r.pct == null ? '' : ` of ${target!.toLocaleString('en-US')} (${r.pct}%)`
  }

  return (
    <section className="card stack meal-plan-editor" style={{ gap: 14 }} aria-label="Meal plan">
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h3>Meal plan</h3>
        <span className="small muted">
          {current ? `Current plan since ${monthDay(current.effective_from!)}` : 'No meal plan yet'}
          {latest && latest !== current ? ` · next from ${shortDay(latest.effective_from!)}` : ''}
        </span>
      </div>

      <div className="plan-facts small">
        <span><b>Diet:</b> {c.diet ? DIET_LABEL[c.diet] : 'Not set'}</span>
        <span><b>Avoids:</b> {c.foods_to_avoid || 'Nothing listed'}</span>
        <span><b>Meals:</b> {types.map((x) => TYPE_LABEL[x].toLowerCase()).join(', ')}</span>
      </div>

      <div className="row plan-tools" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="field" style={{ minWidth: 0, flex: '1 1 200px' }}>
          <span className="label-like">Start from</span>
          <select className="input" value="" onChange={(e) => {
            const v = e.target.value
            if (!v) return
            const src = v === 'current' ? latest : v === 'empty' ? null : templates.data?.find((x) => x.id === v) ?? null
            setDraft(toDraft(src, types))
            setProblem(null)
            setSaved(v === 'current' || v === 'empty' ? null : 'Template loaded. Adjust the amounts, then save.')
          }}>
            <option value="">Choose…</option>
            {latest && <option value="current">The latest plan</option>}
            {(templates.data ?? []).map((x) => <option key={x.id} value={x.id!}>Template: {x.name}</option>)}
            <option value="empty">An empty plan</option>
          </select>
        </label>
        <label className="checkbox" style={{ alignSelf: 'flex-end', minHeight: 44 }}>
          <input type="checkbox" checked={d.split} onChange={(e) => { edit((x) => ({ ...toDraft(setSplitDraft(x, e.target.checked), types), name: x.name })); setDay(e.target.checked ? 'training' : 'every') }} />
          Separate training and rest days
        </label>
      </div>

      {d.split && (
        <Segmented label="Day" block value={shownDay} onChange={setDay}
          options={planDays(true).map((x) => ({ value: x, label: PLAN_DAY_LABEL[x] }))} />
      )}

      {dayMeals.map((type) => {
        const m = d.meals.find((x) => x.day === shownDay && x.meal_type === type) ?? { day: shownDay, meal_type: type, notes: '', lines: [] }
        const n = sumNutrition(m.lines.map((l) => lineNutrition(lineOf(l))))
        return (
          <div key={type} className="plan-meal">
            <div className="between" style={{ gap: 8 }}>
              <b>{TYPE_LABEL[type]}</b>
              <span className="xs muted">{n.calories} kcal · P {n.protein_g} · C {n.carbs_g} · F {n.fat_g}</span>
            </div>
            {m.lines.length > 0 && (
              <div className="fl-list">
                {m.lines.map((l, i) => {
                  const hit = avoidMatch(l.food.name, terms)
                  return (
                    <FoodLineRow key={l.key} d={l} index={i}
                      warning={hit ? `${c.client.first_name} avoids "${hit}". Check this one.` : null}
                      onChange={(x) => editMeal(type, (mm) => ({ ...mm, lines: mm.lines.map((y) => (y.key === l.key ? x : y)) }))}
                      onRemove={() => editMeal(type, (mm) => ({ ...mm, lines: mm.lines.filter((y) => y.key !== l.key) }))} />
                  )
                })}
              </div>
            )}
            <FoodPicker placeholder={`Add to ${TYPE_LABEL[type].toLowerCase()}`} missingLabel="Add to your food list"
              onPick={(f) => editMeal(type, (mm) => ({ ...mm, lines: [...mm.lines, newDraft(f)] }))}
              onMissing={(name) => setAdding({ meal: type, name })} />
            <input className="input" maxLength={300} aria-label={`Note for ${TYPE_LABEL[type].toLowerCase()}`} placeholder='Note, e.g. "or swap rice for quinoa"'
              value={m.notes} onChange={(e) => editMeal(type, (mm) => ({ ...mm, notes: e.target.value }))} />
          </div>
        )
      })}

      <div className="stack" style={{ gap: 6 }}>
        <TotalsRow n={dayTotal} label={d.split ? `${PLAN_DAY_LABEL[shownDay].replace(/s$/, '')} total` : 'Day total'} />
        {tg ? (
          <p className="xs muted plan-vs">
            Against targets: {dayTotal.calories.toLocaleString('en-US')} kcal{pct(dayTotal.calories, tg.calories)} · protein {dayTotal.protein_g} g{pct(dayTotal.protein_g, tg.protein_g)} ·
            carbs {dayTotal.carbs_g} g{pct(dayTotal.carbs_g, tg.carbs_g)} · fat {dayTotal.fat_g} g{pct(dayTotal.fat_g, tg.fat_g)}
          </p>
        ) : <p className="xs muted">No targets yet. Set them above to compare the plan with them.</p>}
      </div>

      <fieldset className="when">
        <legend className="xs muted">Starts</legend>
        <label className="checkbox"><input type="radio" name="plan-when" checked={when === 'today'} onChange={() => setWhen('today')} /> Today</label>
        <label className="checkbox"><input type="radio" name="plan-when" checked={when === 'monday'} onChange={() => setWhen('monday')} /> Next Monday ({monthDay(nextMonday(t))})</label>
        <label className="checkbox">
          <input type="radio" name="plan-when" checked={when === 'date'} onChange={() => setWhen('date')} /> On
          <input type="date" className="input" style={{ width: 'auto', height: 36 }} min={t} value={date} aria-label="Plan start date" onChange={(e) => { setDate(e.target.value); setWhen('date') }} />
        </label>
      </fieldset>

      {problem && <div role="alert" className="auth-note err">{problem}</div>}
      {saved && <div role="status" className="auth-note ok" style={{ marginTop: 0 }}>{saved}</div>}
      <button type="button" className="btn btn-primary btn-lg btn-block" disabled={save.isPending} onClick={() => submit(false)}>
        {save.isPending ? 'Saving…' : from === t ? 'Save plan, starting today' : `Save plan, starting ${shortDay(from)}`}
      </button>

      <details className="plan-more">
        <summary className="small">Templates and history</summary>
        <div className="stack" style={{ gap: 12, marginTop: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input grow" maxLength={80} placeholder="Template name, e.g. Fat loss, 4 meals" aria-label="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            <button type="button" className="btn btn-ghost" disabled={save.isPending} onClick={() => submit(true)}>Save as template</button>
          </div>
          {(templates.data ?? []).length > 0 && (
            <ul className="list-rows">
              {templates.data!.map((x) => (
                <li key={x.id} className="between small" style={{ gap: 8 }}>
                  <span>{x.name} <span className="muted">· {dayNutrition(x, planDays(x.split)[0]).calories.toLocaleString('en-US')} kcal a day</span></span>
                  <button type="button" className="icon-btn" aria-label={`Delete template ${x.name}`} disabled={remove.isPending} onClick={() => remove.mutate(x.id!)}><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          )}
          <b className="small">Versions</b>
          {!versions.data?.length ? <p className="small muted">No plan saved for {c.client.first_name} yet.</p> : (
            <ul className="list-rows">
              {versions.data.map((v) => (
                <li key={v.id} className="between small" style={{ gap: 8 }}>
                  <span>
                    <b>{v.effective_from! > t ? `From ${shortDay(v.effective_from!)}` : `Since ${monthDay(v.effective_from!)}`}</b>
                    <span className="muted"> · {dayNutrition(v, planDays(v.split)[0]).calories.toLocaleString('en-US')} kcal a day{v.split ? ' (training days)' : ''}</span>
                  </span>
                  {v.effective_from! > t ? (
                    <button type="button" className="icon-btn" aria-label={`Delete the plan from ${shortDay(v.effective_from!)}`} disabled={remove.isPending} onClick={() => remove.mutate(v.id!)}><Trash2 size={16} /></button>
                  ) : v === current ? <span className="pill good">Current</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      {adding && (
        <FoodForm initialName={adding.name} onClose={() => setAdding(null)}
          onSaved={(f) => editMeal(adding.meal, (mm) => ({ ...mm, lines: [...mm.lines, newDraft(f)] }))} />
      )}
    </section>
  )
}

/** Turning the split on or off, on the editor's draft (via the plan shape, so lines are copied the same way). */
function setSplitDraft(x: Draft, split: boolean): MealPlan {
  return setSplit(toPlan(x, null, null), split)
}
