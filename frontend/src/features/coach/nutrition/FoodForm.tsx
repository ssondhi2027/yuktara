import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { api } from '@/lib/api'
import { customFoodProblem, type Basis, type Food } from '@/lib/meals'
import { Sheet } from '@/components/ui/Sheet'

const num = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')))

/** Problems with a food's named servings (as the database checks them), or null. */
export function servingsProblem(servings: { name: string; amount: number }[]): string | null {
  if (servings.length > 8) return 'Up to 8 servings.'
  for (const s of servings) {
    if (!s.name.trim() || s.name.trim().length > 40) return 'Name each serving (up to 40 characters).'
    if (!(s.amount > 0 && s.amount <= 2000)) return `Check the amount for "${s.name.trim()}" (above 0, up to 2,000).`
  }
  return null
}

/**
 * Add a food to the coach's own list: nutrition per 100 g (or ml) and named
 * servings ("1 scoop" = 30 g). The coach's clients see it when logging, and it
 * can go in their meal plans.
 */
export function FoodForm({ initialName = '', onSaved, onClose }: { initialName?: string; onSaved?: (f: Food) => void; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: initialName, basis: 'g' as Basis, kcal: '', protein_g: '', carbs_g: '', fat_g: '' })
  const [servings, setServings] = useState<{ name: string; amount: string }[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const food = (): Food => ({
    id: null, name: f.name.trim(), basis: f.basis, kcal: num(f.kcal), protein_g: num(f.protein_g) || 0, carbs_g: num(f.carbs_g) || 0, fat_g: num(f.fat_g) || 0,
    servings: servings.map((s) => ({ name: s.name.trim(), amount: num(s.amount) })),
  })
  const save = useMutation({
    mutationFn: () => api.saveFood({ ...food(), id: null }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ['foods'] })
      onSaved?.({ ...food(), id, custom: true })
      onClose()
    },
    onError: (e) => setProblem(e instanceof Error ? e.message : 'Could not save. Try again.'),
  })
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const x = food()
    const p = customFoodProblem(x) ?? servingsProblem(x.servings)
    setProblem(p)
    if (!p) save.mutate()
  }

  return (
    <Sheet title="Add to your food list" onClose={onClose}>
      <form className="stack" style={{ gap: 12 }} onSubmit={submit} noValidate>
        <p className="small muted">Your clients see your foods when they log meals, and you can use them in meal plans.</p>
        <div className="field">
          <label htmlFor="ff-name">Name</label>
          <input id="ff-name" className="input" maxLength={120} value={f.name} onChange={(e) => { setF({ ...f, name: e.target.value }); setProblem(null) }} />
        </div>
        <div className="seg" role="group" aria-label="Measured in">
          {(['g', 'ml'] as const).map((b) => (
            <button key={b} type="button" aria-pressed={f.basis === b} onClick={() => setF({ ...f, basis: b })}>{b === 'g' ? 'Per 100 g' : 'Per 100 ml'}</button>
          ))}
        </div>
        <div className="custom-grid">
          {([['kcal', 'kcal'], ['protein_g', 'Protein g'], ['carbs_g', 'Carbs g'], ['fat_g', 'Fat g']] as const).map(([k, l]) => (
            <label key={k} className="xs" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 600 }}>{l}
              <input className="input" type="text" inputMode="decimal" value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value }); setProblem(null) }} />
            </label>
          ))}
        </div>
        <fieldset className="custom-food">
          <legend>Servings (optional)</legend>
          {servings.map((s, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <input className="input grow" aria-label={`Serving ${i + 1} name`} placeholder="1 scoop" maxLength={40} value={s.name}
                onChange={(e) => setServings(servings.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
              <input className="input" style={{ width: 80 }} type="text" inputMode="decimal" aria-label={`Serving ${i + 1} amount in ${f.basis}`} placeholder={f.basis}
                value={s.amount} onChange={(e) => setServings(servings.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} />
              <span className="xs muted">{f.basis}</span>
              <button type="button" className="icon-btn" aria-label={`Remove serving ${i + 1}`} onClick={() => setServings(servings.filter((_, k) => k !== i))}><X size={16} /></button>
            </div>
          ))}
          {servings.length < 8 && <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setServings([...servings, { name: '', amount: '' }])}><Plus size={16} /> Add a serving</button>}
        </fieldset>
        {problem && <div role="alert" className="auth-note err">{problem}</div>}
        <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Add food'}</button>
      </form>
    </Sheet>
  )
}
