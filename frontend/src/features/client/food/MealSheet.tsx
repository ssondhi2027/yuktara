import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, type DayPlanMeal } from '@/lib/api'
import {
  customFoodProblem, itemFromLine, lineNutrition, lineProblem, mealTitle, planMatch, planMatchCalories, sumNutrition,
  type Basis, type Food, type FoodLine,
} from '@/lib/meals'
import type { MealType, OnPlan } from '@/types/db'
import { Sheet } from '@/components/ui/Sheet'
import { Segmented } from '@/components/ui/Segmented'
import { FoodPicker } from '@/components/food/FoodPicker'
import { FoodLineRow, TotalsRow, draftOf, lineOf, newDraft, type LineDraft } from '@/components/food/FoodLineRow'

/** Foods: add foods with amounts (the default). Quick add: totals only, when the foods aren't known. */
export type MealSheetMode = 'foods' | 'quick'

const LABEL: Record<MealType, string> = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'a snack' }
const RATING: { v: OnPlan; label: string }[] = [{ v: 'yes', label: 'On plan' }, { v: 'partly', label: 'Partly' }, { v: 'no', label: 'Off plan' }]
const num = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')))

/**
 * Log a meal. One flow: add foods (search, or one that isn't in the list), set
 * each amount in grams, ml or a named serving, and see calories and macros update.
 * The meal's totals are always the sum of its foods; the title comes from the
 * foods unless a name is given. Quick add is separate, for totals only.
 * "On plan?" is pre-set from the coach's plan for this meal when there is one.
 */
export function MealSheet({ date, mode: startMode, mealType, photo, planned, initialLines, onClose, onSaved }: {
  date: string
  mode: MealSheetMode
  mealType: MealType
  photo?: File
  /** the coach's plan for this meal, to pre-set "On plan?" */
  planned?: DayPlanMeal
  /** "Log as planned": the planned foods, editable before saving */
  initialLines?: FoodLine[]
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<MealType>(mealType)
  const [mode, setMode] = useState<MealSheetMode>(startMode)
  const [lines, setLines] = useState<LineDraft[]>(() => (initialLines ?? []).map(draftOf))
  const [name, setName] = useState('')
  const [quick, setQuick] = useState({ calories: '', protein_g: '', carbs_g: '', fat_g: '' })
  const [custom, setCustom] = useState<{ name: string; basis: Basis; kcal: string; protein_g: string; carbs_g: string; fat_g: string } | null>(null)
  const [rating, setRating] = useState<OnPlan | null>(null) // null = follow the plan
  const [problem, setProblem] = useState<string | null>(null)
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const foodLines = lines.map(lineOf)
  const totals = sumNutrition(foodLines.map(lineNutrition))
  const quickN = { calories: num(quick.calories), protein_g: num(quick.protein_g) || 0, carbs_g: num(quick.carbs_g) || 0, fat_g: num(quick.fat_g) || 0 }
  const suggested: OnPlan = !planned?.lines.length ? 'yes'
    : mode === 'foods' ? (foodLines.length ? planMatch(planned.lines, foodLines) : 'yes')
      : planMatchCalories(planned.nutrition.calories, Number.isFinite(quickN.calories) ? quickN.calories : 0)
  const onPlan = rating ?? suggested
  const change = () => setProblem(null)

  const save = useMutation({
    mutationFn: () => {
      const now = new Date()
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const base = { meal_type: type, eaten_at: `${date}T${time}:00`, on_plan: onPlan, photo_url: preview }
      if (mode === 'quick') {
        return api.logMeal(date, { ...base, title: name.trim() || 'Quick add', calories: Math.round(quickN.calories), protein_g: quickN.protein_g, carbs_g: quickN.carbs_g, fat_g: quickN.fat_g })
      }
      return api.logMeal(date, {
        ...base, title: name.trim() || mealTitle(foodLines.map((l) => l.food.name)), ...totals, items: foodLines.map(itemFromLine),
      })
    },
    onSuccess: onSaved,
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    let p: string | null = null
    if (mode === 'foods') {
      p = !foodLines.length ? 'Add at least one food, or use Quick add.' : foodLines.map(lineProblem).find(Boolean) ?? null
    } else {
      const bad = (x: number, max: number) => !(x >= 0 && x <= max)
      if (!(quickN.calories > 0)) p = 'Enter the calories.'
      else if (quickN.calories > 10000) p = 'Calories: up to 10,000.'
      else if (bad(quickN.protein_g, 1000) || bad(quickN.carbs_g, 1000) || bad(quickN.fat_g, 1000)) p = 'Protein, carbs and fat: 0 to 1,000 g.'
    }
    if (!p && name.trim().length > 120) p = 'The name can be up to 120 characters.'
    setProblem(p)
    if (!p) save.mutate()
  }

  const addCustom = () => {
    if (!custom) return
    const f: Food = {
      id: null, name: custom.name.trim(), basis: custom.basis, kcal: num(custom.kcal), protein_g: num(custom.protein_g) || 0,
      carbs_g: num(custom.carbs_g) || 0, fat_g: num(custom.fat_g) || 0, servings: [],
    }
    const p = customFoodProblem(f)
    if (p) return setProblem(p)
    setLines([...lines, { ...newDraft(f), amount: '100' }])
    setCustom(null)
    change()
  }

  return (
    <Sheet title={`Log ${LABEL[type]}`} onClose={onClose}>
      <form className="stack meal-sheet" onSubmit={submit} noValidate>
        {preview && <img src={preview} alt="Meal photo" className="meal-preview" />}

        <div className="field">
          <label htmlFor="meal-type">Meal</label>
          <select id="meal-type" className="input" value={type} onChange={(e) => setType(e.target.value as MealType)}>
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
            <option value="snack">Snack</option>
          </select>
        </div>

        <Segmented label="How to log" block value={mode} onChange={(m) => { setMode(m); change() }}
          options={[{ value: 'foods', label: 'Foods' }, { value: 'quick', label: 'Quick add' }]} />

        {mode === 'foods' ? (
          <>
            {lines.length > 0 && (
              <div className="fl-list" aria-label="Foods in this meal">
                {lines.map((d, i) => (
                  <FoodLineRow key={d.key} d={d} index={i}
                    onChange={(x) => { setLines(lines.map((y) => (y.key === d.key ? x : y))); change() }}
                    onRemove={() => { setLines(lines.filter((y) => y.key !== d.key)); change() }} />
                ))}
              </div>
            )}
            {custom ? (
              <fieldset className="custom-food">
                <legend>A food not in the list</legend>
                <div className="field">
                  <label htmlFor="cf-name">Name</label>
                  <input id="cf-name" className="input" maxLength={120} value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
                </div>
                <div className="field">
                  <span className="label-like">Nutrition per 100 {custom.basis} (from the label)</span>
                  <div className="custom-grid">
                    {([['kcal', 'kcal'], ['protein_g', 'Protein g'], ['carbs_g', 'Carbs g'], ['fat_g', 'Fat g']] as const).map(([k, l]) => (
                      <label key={k} className="xs">{l}
                        <input className="input" type="text" inputMode="decimal" value={custom[k]} onChange={(e) => setCustom({ ...custom, [k]: e.target.value })} />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="seg" role="group" aria-label="Measured in">
                  {(['g', 'ml'] as const).map((b) => (
                    <button key={b} type="button" aria-pressed={custom.basis === b} onClick={() => setCustom({ ...custom, basis: b })}>{b === 'g' ? 'Grams' : 'Millilitres'}</button>
                  ))}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={addCustom}>Add food</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCustom(null)}>Cancel</button>
                </div>
              </fieldset>
            ) : (
              <FoodPicker autoFocus={!initialLines?.length} onPick={(f) => { setLines([...lines, newDraft(f)]); change() }}
                onMissing={(q) => setCustom({ name: q, basis: 'g', kcal: '', protein_g: '', carbs_g: '', fat_g: '' })} />
            )}
            <TotalsRow n={totals} label="Meal total" />
            <div className="field">
              <label htmlFor="meal-name">Name (optional)</label>
              <input id="meal-name" className="input" maxLength={120} placeholder={foodLines.length ? mealTitle(foodLines.map((l) => l.food.name)) : 'e.g. Chicken rice bowl'}
                value={name} onChange={(e) => { setName(e.target.value); change() }} />
            </div>
          </>
        ) : (
          <>
            <p className="small muted">Only know the totals? Enter them here. To count each food, use Foods instead.</p>
            <div className="field">
              <label htmlFor="quick-name">What was it? (optional)</label>
              <input id="quick-name" className="input" maxLength={120} placeholder="Quick add" value={name} onChange={(e) => { setName(e.target.value); change() }} />
            </div>
            <div className="quick-grid">
              {([['calories', 'kcal'], ['protein_g', 'Protein g'], ['carbs_g', 'Carbs g'], ['fat_g', 'Fat g']] as const).map(([k, l]) => (
                <div className="field" key={k}>
                  <label htmlFor={`q-${k}`}>{l}</label>
                  <input id={`q-${k}`} className="input" type="text" inputMode={k === 'calories' ? 'numeric' : 'decimal'} value={quick[k]}
                    onChange={(e) => { setQuick({ ...quick, [k]: e.target.value }); change() }} />
                </div>
              ))}
            </div>
          </>
        )}

        <div className="field">
          <span className="label-like">On plan?{planned?.lines.length && rating == null ? <span className="xs muted"> (set from your plan; change it if you like)</span> : null}</span>
          <div className="rating" role="group" aria-label="On plan?">
            {RATING.map((r) => (
              <button key={r.v} type="button" className="rate-btn" aria-pressed={onPlan === r.v} onClick={() => setRating(r.v)}>{r.label}</button>
            ))}
          </div>
        </div>

        {problem && <div role="alert" className="auth-note err">{problem}</div>}
        {save.error && <div role="alert" className="auth-note err">{save.error.message}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save meal'}</button>
      </form>
    </Sheet>
  )
}
