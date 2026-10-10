import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type DailyPatch, type Habits } from '@/lib/api'
import { Sheet } from '@/components/ui/Sheet'
import { useUnits } from '@/app/auth'
import { inputFromKg, kgFromInput, unitLabel } from '@/lib/units'

/** Log today's steps, water, sleep and morning weight (daily_logs). */
export function HabitSheet({ date, habits, onClose }: { date: string; habits: Habits; onClose: () => void }) {
  const qc = useQueryClient()
  const units = useUnits()
  const str = (x: number | null, f: (n: number) => number = (n) => n) => (x == null ? '' : String(f(x)))
  const [f, setF] = useState({
    steps: str(habits.steps_today),
    water: str(habits.water_ml_today, (ml) => ml / 1000),
    sleep: str(habits.sleep_last_night),
    weight: habits.weight_today == null ? '' : inputFromKg(habits.weight_today, units),
  })
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (patch: DailyPatch) => api.logDaily(date, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-home'] })
      qc.invalidateQueries({ queryKey: ['progress'] })
      qc.invalidateQueries({ queryKey: ['checkin'] })
      onClose()
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save. Try again.'),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const n = (v: string) => (v.trim() === '' ? null : Number(v))
    const steps = n(f.steps), water = n(f.water), sleep = n(f.sleep), weight = n(f.weight)
    if (steps != null && !(steps >= 0 && steps <= 100_000)) return setError('Steps should be between 0 and 100,000.')
    if (water != null && !(water >= 0 && water <= 10)) return setError('Water should be between 0 and 10 litres.')
    if (sleep != null && !(sleep >= 0 && sleep <= 16)) return setError('Sleep should be between 0 and 16 hours.')
    const kg = weight == null ? null : kgFromInput(weight, units)
    if (kg != null && !(kg >= 25 && kg <= 400)) return setError('Check your weight.')
    save.mutate({
      steps: steps == null ? null : Math.round(steps),
      water_ml: water == null ? null : Math.round(water * 1000),
      sleep_hours: sleep == null ? null : Math.round(sleep * 10) / 10,
      weight_kg: kg,
    })
  }

  const field = (key: keyof typeof f, label: string, hint: string, step: string) => (
    <div className="field">
      <label htmlFor={`h-${key}`}>{label}</label>
      <input id={`h-${key}`} className="input" type="number" inputMode="decimal" step={step} min="0" value={f[key]}
        onChange={(e) => { setF({ ...f, [key]: e.target.value }); setError(null) }} />
      <span className="xs muted">{hint}</span>
    </div>
  )

  return (
    <Sheet title="Log today" onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="grid grid-2" style={{ gap: 12 }}>
          {field('steps', 'Steps', 'From your phone or watch', '1')}
          {field('water', 'Water (L)', 'e.g. 1.5', '0.1')}
          {field('sleep', 'Sleep last night (h)', 'e.g. 7.5', '0.25')}
          {field('weight', `Morning weight (${unitLabel(units)})`, 'Before breakfast', '0.1')}
        </div>
        {error && <div role="alert" className="auth-note err">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
      </form>
    </Sheet>
  )
}
