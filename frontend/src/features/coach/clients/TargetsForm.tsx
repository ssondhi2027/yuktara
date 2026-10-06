import type { Targets } from '@/lib/api'

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

/** Problems with a set of targets, or null if it can be saved. */
export function targetsProblem(t: Targets): string | null {
  if (!(t.calories >= 800 && t.calories <= 8000)) return 'Calories should be between 800 and 8,000.'
  if (t.protein_g < 0 || t.protein_g > 500 || t.carbs_g < 0 || t.carbs_g > 1000 || t.fat_g < 0 || t.fat_g > 400) return 'Check the macro grams.'
  if (t.steps < 0 || t.steps > 100_000) return 'Steps should be between 0 and 100,000.'
  if (t.sleep_h && (t.sleep_h < 3 || t.sleep_h > 14)) return 'Sleep should be between 3 and 14 hours.'
  return null
}

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
          </div>
        )
      })}
    </div>
  )
}
