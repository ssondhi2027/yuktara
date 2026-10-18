import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { api } from '@/lib/api'
import type { Food } from '@/lib/meals'
import './food.css'

/** The food list (shared + the coach's own), cached for the session. */
export const useFoods = () => useQuery({ queryKey: ['foods'], queryFn: api.foods, staleTime: 10 * 60_000 })

/**
 * Search the food list and pick one. Results show calories per 100 g (or ml)
 * and the first serving. `onMissing` adds a "not in the list" action.
 */
export function FoodPicker({ onPick, onMissing, missingLabel = 'Add a food not in the list', autoFocus, placeholder = 'Search foods, e.g. oats, dal, chicken' }: {
  onPick: (f: Food) => void
  onMissing?: (name: string) => void
  missingLabel?: string
  autoFocus?: boolean
  placeholder?: string
}) {
  const foods = useFoods()
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    return (foods.data ?? []).filter((f) => words.every((w) => f.name.toLowerCase().includes(w))).slice(0, 8)
  }, [foods.data, q])

  return (
    <div className="food-picker">
      <label className="food-search">
        <Search size={16} aria-hidden />
        <input className="input" type="search" enterKeyHint="search" autoFocus={autoFocus} placeholder={placeholder} aria-label="Search foods"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {foods.error && <p className="xs bad">The food list didn't load. You can still add a food by hand.</p>}
      {matches.length > 0 && (
        <ul className="food-results">
          {matches.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => { onPick(f); setQ('') }}>
                <span className="grow">
                  {f.name}{f.custom && <span className="pill awaiting xs food-own">Coach's</span>}
                </span>
                <span className="xs muted">{Math.round(f.kcal)} kcal / 100 {f.basis}{f.servings[0] ? ` · ${f.servings[0].name}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length > 1 && matches.length === 0 && foods.data && <p className="xs muted">No foods match "{q.trim()}".</p>}
      {onMissing && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { onMissing(q.trim()); setQ('') }}>
          <Plus size={16} /> {missingLabel}
        </button>
      )}
    </div>
  )
}
