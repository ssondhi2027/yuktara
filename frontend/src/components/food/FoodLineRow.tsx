import { X } from 'lucide-react'
import { lineNutrition, unitsFor, type Food, type FoodLine } from '@/lib/meals'
import './food.css'

/** A food line while editing: the amount stays text so "1." or an empty box can be typed. */
export interface LineDraft { key: string; food: Food; amount: string; unit: string }

let seq = 0
export const draftOf = (l: FoodLine): LineDraft => ({ key: `l${++seq}`, food: l.food, amount: Number.isFinite(l.quantity) ? String(l.quantity) : '', unit: l.unit })
/** A new line: the food's first serving (1 ×) if it has one, else 100 g or ml. */
export const newDraft = (food: Food): LineDraft => ({ key: `l${++seq}`, food, amount: food.servings.length ? '1' : '100', unit: food.servings[0]?.name ?? food.basis })
/** "1,5" (comma decimals) reads as 1.5; anything else that isn't a number is NaN. */
export const lineOf = (d: LineDraft): FoodLine => ({ food: d.food, quantity: d.amount.trim() === '' ? NaN : Number(d.amount.replace(',', '.')), unit: d.unit })

const unitLabel = (food: Food, u: string) => {
  if (u === food.basis) return food.basis === 'g' ? 'grams' : 'ml'
  const s = food.servings.find((x) => x.name === u)
  return s ? `${u} (${s.amount} ${food.basis})` : u
}

/**
 * One food: name, amount, unit (g or ml, or one of its servings) and the
 * calories and macros for that amount, updating as you type.
 */
export function FoodLineRow({ d, onChange, onRemove, warning, index }: {
  d: LineDraft
  onChange: (d: LineDraft) => void
  onRemove: () => void
  warning?: string | null
  index: number
}) {
  const n = lineNutrition(lineOf(d))
  return (
    <div className="fl-row">
      <div className="fl-name">
        {d.food.name}
        {d.food.id == null && <span className="xs muted"> · added by hand</span>}
      </div>
      <button type="button" className="icon-btn fl-remove" aria-label={`Remove ${d.food.name}`} onClick={onRemove}><X size={16} /></button>
      <div className="fl-controls">
        <input className="input fl-amount" type="text" inputMode="decimal" enterKeyHint="done" aria-label={`Amount of ${d.food.name}`}
          value={d.amount} onChange={(e) => onChange({ ...d, amount: e.target.value })} />
        <select className="input fl-unit" aria-label={`Unit for ${d.food.name} (food ${index + 1})`} value={d.unit} onChange={(e) => onChange({ ...d, unit: e.target.value })}>
          {unitsFor(d.food).map((u) => <option key={u} value={u}>{unitLabel(d.food, u)}</option>)}
        </select>
        <span className="fl-nutrition xs" aria-live="polite">
          {n ? <><b>{n.calories} kcal</b> · P {n.protein_g} · C {n.carbs_g} · F {n.fat_g}</> : <span className="muted">Enter an amount</span>}
        </span>
      </div>
      {warning && <div className="fl-warning xs" role="note">{warning}</div>}
    </div>
  )
}

/** Totals row: read-only, always the sum of the foods. */
export function TotalsRow({ n, label = 'Total' }: { n: { calories: number; protein_g: number; carbs_g: number; fat_g: number }; label?: string }) {
  return (
    <div className="fl-totals" aria-label={`${label}: ${n.calories} kcal`}>
      <span className="xs muted">{label}</span>
      <b>{n.calories} kcal</b>
      <span className="small">P {n.protein_g} g</span>
      <span className="small">C {n.carbs_g} g</span>
      <span className="small">F {n.fat_g} g</span>
    </div>
  )
}
