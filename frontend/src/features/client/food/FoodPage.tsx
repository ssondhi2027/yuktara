import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, ChevronLeft, ChevronRight, Image as ImageIcon, Plus, Search } from 'lucide-react'
import { api, type FoodDay, type Meal } from '@/lib/api'
import { addDays, clockTime, monthDay, today } from '@/lib/dates'
import { int } from '@/lib/units'
import type { MealType, OnPlan } from '@/types/db'
import { MacroBar } from '@/components/ui/MacroBar'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { MealSheet, type MealSheetMode } from './MealSheet'
import './food.css'

const RATING: { v: OnPlan; label: string }[] = [
  { v: 'yes', label: 'On plan' },
  { v: 'partly', label: 'Partly' },
  { v: 'no', label: 'Off plan' },
]

export function FoodPage() {
  const TODAY = today()
  const [date, setDate] = useState(TODAY)
  const { data, error, isPending } = useQuery({ queryKey: ['food', date], queryFn: () => api.foodDay(date) })
  const qc = useQueryClient()
  const rate = useMutation({
    mutationFn: (r: OnPlan) => api.rateDay(date, r),
    onMutate: (r) => qc.setQueryData<FoodDay>(['food', date], (d) => d && { ...d, day_rating: r }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['food', date] })
      qc.invalidateQueries({ queryKey: ['client-home'] })
    },
  })
  const [sheet, setSheet] = useState<{ mode: MealSheetMode; mealType: MealType; photo?: File } | null>(null)

  const isToday = date === TODAY
  const label = isToday ? `Today, ${monthDay(date)}` : date === addDays(TODAY, -1) ? `Yesterday, ${monthDay(date)}` : monthDay(date)

  return (
    <div className="page food">
      <header className="page-head" style={{ alignItems: 'center' }}>
        <h1>Food</h1>
        <div className="date-nav">
          <button className="icon-btn plain" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={22} /></button>
          <b>{label}</b>
          <button className="icon-btn plain" aria-label="Next day" disabled={isToday} onClick={() => setDate(addDays(date, 1))}><ChevronRight size={22} /></button>
        </div>
      </header>

      {isPending ? <PageLoading /> : error ? <PageError error={error} /> : (
        <div className="food-layout">
          <Summary day={data} rating={data.day_rating} onRate={(r) => rate.mutate(r)} isToday={isToday} />
          <MealList day={data} onAdd={(mode, mealType, photo) => setSheet({ mode, mealType, photo })} />
        </div>
      )}

      {sheet && data && (
        <MealSheet
          date={date}
          mode={sheet.mode}
          mealType={sheet.mealType}
          photo={sheet.photo}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null)
            qc.invalidateQueries({ queryKey: ['food', date] })
            qc.invalidateQueries({ queryKey: ['client-home'] })
            qc.invalidateQueries({ queryKey: ['progress'] })
          }}
        />
      )}
    </div>
  )
}

function Summary({ day, rating, onRate, isToday }: { day: FoodDay; rating: OnPlan | null; onRate: (r: OnPlan) => void; isToday: boolean }) {
  const t = day.targets
  const sum = (k: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g') => day.meals.reduce((a, m) => a + m[k], 0)
  const kcal = sum('calories')
  if (!t) {
    // No targets yet: show what was eaten, never "0 / 0".
    return (
      <section className="card food-summary">
        <div className="kcal-big"><b className="num">{int(kcal)}</b> <span className="muted">kcal</span></div>
        <div className="grid grid-3" style={{ gap: 14 }}>
          {(['protein_g', 'carbs_g', 'fat_g'] as const).map((k) => (
            <div key={k}><div className="muted small">{{ protein_g: 'Protein', carbs_g: 'Carbs', fat_g: 'Fat' }[k]}</div><b className="num">{int(sum(k))} g</b></div>
          ))}
        </div>
        <p className="small muted">Waiting for your coach to set your calorie and macro targets.</p>
        <hr />
        <b>{isToday ? 'Today so far, on plan?' : 'This day, on plan?'}</b>
        <div className="rating" role="group" aria-label="How did today go">
          {RATING.map((r) => (
            <button key={r.v} type="button" className="rate-btn" aria-pressed={rating === r.v} onClick={() => onRate(r.v)}>{r.label}</button>
          ))}
        </div>
      </section>
    )
  }
  const left = t.calories - kcal
  return (
    <section className="card food-summary">
      <div className="between" style={{ alignItems: 'baseline' }}>
        <div className="kcal-big"><b className="num">{int(kcal)}</b> <span className="muted">of {int(t.calories)} kcal</span></div>
        <b className={left >= 0 ? 'good' : 'bad'}>{left >= 0 ? `${int(left)} left` : `${int(-left)} over`}</b>
      </div>
      <div className="bar thick"><span style={{ width: `${Math.min(100, (kcal / t.calories) * 100)}%`, background: 'var(--primary)' }} /></div>
      <div className="grid grid-3" style={{ gap: 14, marginTop: 4 }}>
        <MacroBar layout="stacked" label="Protein" value={sum('protein_g')} target={t.protein_g} color="var(--macro-p)" />
        <MacroBar layout="stacked" label="Carbs" value={sum('carbs_g')} target={t.carbs_g} color="var(--macro-c)" />
        <MacroBar layout="stacked" label="Fat" value={sum('fat_g')} target={t.fat_g} color="var(--macro-f)" />
      </div>
      <hr />
      <b>{isToday ? 'Today so far, on plan?' : 'This day, on plan?'}</b>
      <div className="rating" role="group" aria-label="How did today go">
        {RATING.map((r) => (
          <button key={r.v} type="button" className="rate-btn" aria-pressed={rating === r.v} onClick={() => onRate(r.v)}>{r.label}</button>
        ))}
      </div>
    </section>
  )
}

const TYPE_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
const TONE: Record<MealType, string> = { breakfast: 'peach', snack: 'mint', lunch: 'sage', dinner: 'sand' }

function MealList({ day, onAdd }: { day: FoodDay; onAdd: (mode: MealSheetMode, type: MealType, photo?: File) => void }) {
  const onPlan = day.meals.filter((m) => m.on_plan === 'yes').length
  const missing = day.planned.filter((p) => !day.meals.some((m) => m.meal_type === p))
  return (
    <section className="stack">
      <div className="between">
        <h3>Meals</h3>
        <span className="muted">{onPlan} of {day.meals.length} on plan</span>
      </div>
      {day.meals.length === 0 && <p className="muted small">Nothing logged for this day.</p>}
      {day.meals.map((m) => <MealCard key={m.id} meal={m} />)}
      {missing.map((type) => (
        <div key={type} className="missing-meal">
          <div className="between">
            <b>{TYPE_LABEL[type]}</b>
            <span className="muted">Not logged yet</span>
          </div>
          <div className="grid grid-3" style={{ gap: 8 }}>
            <label className="btn btn-primary btn-square">
              <Camera size={18} /> Photo
              <input type="file" accept="image/*" capture="environment" hidden
                onChange={(e) => e.target.files?.[0] && onAdd('photo', type, e.target.files[0])} />
            </label>
            <button className="btn btn-ghost btn-square" onClick={() => onAdd('search', type)}><Search size={18} /> Search</button>
            <button className="btn btn-ghost btn-square" onClick={() => onAdd('quick', type)}><Plus size={18} /> Quick add</button>
          </div>
        </div>
      ))}
      {missing.length === 0 && (
        <button className="btn btn-ghost btn-square" onClick={() => onAdd('quick', 'snack')}><Plus size={18} /> Add a snack</button>
      )}
    </section>
  )
}

function MealCard({ meal: m }: { meal: Meal }) {
  const pill = m.on_plan === 'yes' ? { cls: 'good', text: 'On plan' } : m.on_plan === 'partly' ? { cls: '', text: 'Partly' } : { cls: 'warn', text: 'Off plan' }
  return (
    <article className="meal-card">
      <div className={`meal-thumb ${TONE[m.meal_type]}`}>
        {m.photo_url ? <img src={m.photo_url} alt="" /> : <ImageIcon size={24} />}
      </div>
      <div className="grow">
        <div className="small muted">{TYPE_LABEL[m.meal_type]} · {clockTime(m.eaten_at)}</div>
        <div className="meal-title truncate">{m.title}</div>
        <div className="small muted">{m.calories} kcal · P {m.protein_g} · C {m.carbs_g} · F {m.fat_g}</div>
      </div>
      <span className={`pill ${pill.cls}`}>{pill.text}</span>
    </article>
  )
}
