import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { MealType, OnPlan } from '@/types/db'
import { Sheet } from '@/components/ui/Sheet'

export type MealSheetMode = 'photo' | 'search' | 'quick'

// Small built-in list for the demo. With Supabase this becomes a search over
// the coach's saved foods plus an external food database.
const FOODS = [
  { name: 'Chicken breast, grilled (150 g)', calories: 248, protein_g: 46, carbs_g: 0, fat_g: 5 },
  { name: 'Salmon fillet (150 g)', calories: 312, protein_g: 31, carbs_g: 0, fat_g: 20 },
  { name: 'Rice, cooked (200 g)', calories: 260, protein_g: 5, carbs_g: 57, fat_g: 1 },
  { name: 'Greek yogurt 2% (200 g)', calories: 146, protein_g: 20, carbs_g: 8, fat_g: 4 },
  { name: 'Oats (60 g)', calories: 228, protein_g: 8, carbs_g: 40, fat_g: 4 },
  { name: 'Whey protein, 1 scoop', calories: 120, protein_g: 24, carbs_g: 3, fat_g: 1 },
  { name: 'Banana, medium', calories: 105, protein_g: 1, carbs_g: 27, fat_g: 0 },
  { name: 'Eggs, 2 large', calories: 144, protein_g: 12, carbs_g: 1, fat_g: 10 },
  { name: 'Dal and roti', calories: 420, protein_g: 18, carbs_g: 62, fat_g: 11 },
  { name: 'Paneer tikka (150 g)', calories: 390, protein_g: 27, carbs_g: 9, fat_g: 27 },
]

const LABEL: Record<MealType, string> = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'a snack' }

export function MealSheet({
  date, mode, mealType, photo, onClose, onSaved,
}: {
  date: string
  mode: MealSheetMode
  mealType: MealType
  photo?: File
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<MealType>(mealType)
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')
  const [n, setN] = useState({ calories: '', protein_g: '', carbs_g: '', fat_g: '' })
  const [onPlan, setOnPlan] = useState<OnPlan>('yes')
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const matches = query.length > 1 ? FOODS.filter((f) => f.name.toLowerCase().includes(query.toLowerCase())) : []

  const save = useMutation({
    mutationFn: () => {
      const now = new Date()
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      return api.logMeal(date, {
        meal_type: type,
        eaten_at: `${date}T${time}:00`,
        title: title.trim() || 'Meal',
        calories: +n.calories || 0,
        protein_g: +n.protein_g || 0,
        carbs_g: +n.carbs_g || 0,
        fat_g: +n.fat_g || 0,
        on_plan: onPlan,
        // Demo keeps the local preview; with Supabase the compressed photo is
        // uploaded to the private meal-photos bucket first (lib/image.ts).
        photo_url: preview,
      })
    },
    onSuccess: onSaved,
  })

  return (
    <Sheet title={`Log ${LABEL[type]}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
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

        {mode === 'search' && (
          <div className="field">
            <label htmlFor="food-search">Search foods</label>
            <input id="food-search" className="input" placeholder="e.g. chicken, oats, dal" value={query} onChange={(e) => setQuery(e.target.value)} />
            {matches.length > 0 && (
              <ul className="search-results">
                {matches.map((f) => (
                  <li key={f.name}>
                    <button type="button" onClick={() => {
                      setTitle(f.name)
                      setN({ calories: String(f.calories), protein_g: String(f.protein_g), carbs_g: String(f.carbs_g), fat_g: String(f.fat_g) })
                      setQuery('')
                    }}>
                      <span>{f.name}</span>
                      <span className="muted small">{f.calories} kcal · P {f.protein_g}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="field">
          <label htmlFor="meal-title">What did you eat?</label>
          <input id="meal-title" className="input" placeholder="Chicken rice bowl" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>

        <div className="grid grid-4" style={{ gap: 8 }}>
          {([['calories', 'kcal'], ['protein_g', 'Protein g'], ['carbs_g', 'Carbs g'], ['fat_g', 'Fat g']] as const).map(([k, l]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{l}</label>
              <input id={k} className="input" inputMode="numeric" pattern="[0-9]*" value={n[k]} onChange={(e) => setN({ ...n, [k]: e.target.value })} />
            </div>
          ))}
        </div>

        <div className="field">
          <label>On plan?</label>
          <div className="rating">
            {(['yes', 'partly', 'no'] as const).map((v) => (
              <button key={v} type="button" className="rate-btn" aria-pressed={onPlan === v} onClick={() => setOnPlan(v)}>
                {v === 'yes' ? 'On plan' : v === 'partly' ? 'Partly' : 'Off plan'}
              </button>
            ))}
          </div>
        </div>

        {save.error && <div role="alert" className="auth-note err">{save.error.message}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save meal'}
        </button>
      </form>
    </Sheet>
  )
}
