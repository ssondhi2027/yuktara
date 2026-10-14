import type { Targets } from '@/lib/api'
import { calorieMismatch, macroCalories } from '@/lib/targets'

export { targetsProblem } from '@/lib/targets'

export const EMPTY_TARGETS: Targets = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, water_ml: 0, steps: 0, sleep_h: 0 }

const FIELDS: { key: keyof Targets; label: string; step: number; scale?: number; unit?: string }[] = [
  { key: 'calories', label: 'Calories', step: 50 },
  { key: 'protein_g', label: 'Protein (g)', step: 5 },
  { key: 'carbs_g', label: 'Carbs (g)', step: 5 },
  { key: 'fat_g', label: 'Fat (g)', step: 5 },
  { key: 'steps', label: 'Daily steps', step: 500 },
  { key: 'water_ml', label: 'Water (L)', step: 0.1, scale: 1000 },
  { key: 'sleep_h', label: 'Sleep (h)', step: 0.5 },
]

/** The coach's calorie, macro and habit targets for a client. */
export function TargetsForm({ value, onChange, idPrefix = 't' }: { value: Targets; onChange: (t: Targets) => void; idPrefix?: string }) {
  return (
    <div className="grid grid-2" style={{ gap: 12 }}>
      {FIELDS.map((f) => {
        const shown = f.scale ? value[f.key] / f.scale : value[f.key]
        return (
          <div key={f.key} className="field">
            <label htmlFor={`${idPrefix}-${f.key}`}>{f.label}</label>
            <input
              id={`${idPrefix}-${f.key}`}
              className="input"
              type="number"
              inputMode="decimal"
              min={0}
              step={f.step}
              value={shown || ''}
              onChange={(e) => {
                const n = e.target.value === '' ? 0 : Number(e.target.value)
                onChange({ ...value, [f.key]: f.scale ? Math.round(n * f.scale) : n })
              }}
            />
            {f.key === 'calories' && macroCalories(value) > 0 && (
              <span className={`xs ${calorieMismatch(value) ? 'bad' : 'muted'}`}>
                Macros add up to {macroCalories(value).toLocaleString('en-US')} kcal
              </span>
            )}
          </div>
        )
      })}
      {calorieMismatch(value) && <div role="note" className="auth-note err" style={{ gridColumn: '1 / -1' }}>{calorieMismatch(value)}</div>}
    </div>
  )
}
