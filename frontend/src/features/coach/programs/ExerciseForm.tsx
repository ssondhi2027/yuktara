import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { api, type LibraryExercise } from '@/lib/api'
import { EQUIPMENT, emptyExercise, exerciseProblems, type ExerciseDraft } from '@/lib/exercises'
import { LEVEL_LABEL } from '@/lib/labels'
import { MUSCLE_LABEL } from '@/lib/muscles'
import { MUSCLE_GROUPS, type ExerciseLevel, type MuscleGroup } from '@/types/db'
import { Sheet } from '@/components/ui/Sheet'

export const draftOf = (e: LibraryExercise): ExerciseDraft => ({
  id: e.id, name: e.name, level: e.level, equipment: e.equipment, cue: e.cue ?? '', primary: [...e.primary], secondary: [...e.secondary],
})

/**
 * Create or edit one of the coach's own exercises. It's added to the library
 * for the coach and their clients (body map, workout logger, swaps). Opened from
 * Programs → Exercises, and from the builder's exercise picker.
 */
export function ExerciseForm({ initial, onSaved, onDeleted, onClose }: {
  initial?: ExerciseDraft
  onSaved?: (e: LibraryExercise) => void
  onDeleted?: () => void
  onClose: () => void
}) {
  const qc = useQueryClient()
  const library = useQuery({ queryKey: ['exercise-library'], queryFn: api.exerciseLibrary, staleTime: Infinity })
  const [d, setD] = useState<ExerciseDraft>(() => initial ?? emptyExercise())
  const [errors, setErrors] = useState<ReturnType<typeof exerciseProblems> & { save?: string }>({})
  const set = <K extends keyof ExerciseDraft>(k: K, v: ExerciseDraft[K]) => { setD({ ...d, [k]: v }); setErrors({}) }

  const save = useMutation({
    mutationFn: () => api.saveExercise(d),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ['exercise-library'] })
      onSaved?.({ id, name: d.name.trim(), level: d.level, equipment: d.equipment.trim(), cue: d.cue.trim() || null, primary: d.primary, secondary: d.secondary, custom: true })
      onClose()
    },
    onError: (e) => setErrors({ save: e instanceof Error ? e.message : 'Could not save. Try again.' }),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteExercise(d.id!),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['exercise-library'] })
      onDeleted?.()
      onClose()
    },
    onError: (e) => setErrors({ save: e instanceof Error ? e.message : 'Could not delete. Try again.' }),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const others = (library.data ?? []).filter((x) => x.id !== d.id)
    const found = exerciseProblems(d, new Set(others.filter((x) => !x.custom).map((x) => x.name.toLowerCase())), new Set(others.filter((x) => x.custom).map((x) => x.name.toLowerCase())))
    setErrors(found)
    if (!Object.keys(found).length) save.mutate()
  }

  const toggle = (role: 'primary' | 'secondary', m: MuscleGroup) => {
    const other = role === 'primary' ? 'secondary' : 'primary'
    const on = d[role].includes(m)
    setD({ ...d, [role]: on ? d[role].filter((x) => x !== m) : [...d[role], m], [other]: d[other].filter((x) => x !== m) })
    setErrors({})
  }
  const muscles = (role: 'primary' | 'secondary', label: string) => (
    <fieldset className="field ex-muscles">
      <legend>{label}</legend>
      <div className="picker-muscles" role="group" aria-label={label}>
        {MUSCLE_GROUPS.map((m) => (
          <button key={m} type="button" className="chip-btn" aria-pressed={d[role].includes(m)} onClick={() => toggle(role, m)}>{MUSCLE_LABEL[m]}</button>
        ))}
      </div>
      {errors[role] && <span role="alert" className="xs bad">{errors[role]}</span>}
    </fieldset>
  )
  const busy = save.isPending || remove.isPending

  return (
    <Sheet title={d.id ? 'Edit exercise' : 'New exercise'} onClose={onClose}>
      <form className="stack exercise-form" style={{ gap: 12 }} noValidate onSubmit={submit}>
        <p className="small muted">Your own exercises show up in your programs, and in your clients' workout logger and body map.</p>
        <div className="field">
          <label htmlFor="ex-name">Name</label>
          <input id="ex-name" className="input" maxLength={80} value={d.name} onChange={(e) => set('name', e.target.value)} />
          {errors.name && <span role="alert" className="xs bad">{errors.name}</span>}
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="ex-level">Level</label>
            <select id="ex-level" className="input" value={d.level} onChange={(e) => set('level', e.target.value as ExerciseLevel)}>
              {(Object.keys(LEVEL_LABEL) as ExerciseLevel[]).map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ex-equipment">Equipment</label>
            <input id="ex-equipment" className="input" list="ex-equipment-list" maxLength={40} placeholder="e.g. dumbbells" value={d.equipment} onChange={(e) => set('equipment', e.target.value)} />
            <datalist id="ex-equipment-list">{EQUIPMENT.map((x) => <option key={x} value={x} />)}</datalist>
            {errors.equipment && <span role="alert" className="xs bad">{errors.equipment}</span>}
          </div>
        </div>
        {muscles('primary', 'Main muscles')}
        {muscles('secondary', 'Also works (optional)')}
        <div className="field">
          <label htmlFor="ex-cue">Coaching cue (optional)</label>
          <textarea id="ex-cue" className="textarea" rows={2} maxLength={300} placeholder="One line clients see while logging" value={d.cue} onChange={(e) => set('cue', e.target.value)} />
          {errors.cue && <span role="alert" className="xs bad">{errors.cue}</span>}
        </div>
        {errors.save && <div role="alert" className="auth-note err">{errors.save}</div>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={busy}>{save.isPending ? 'Saving…' : d.id ? 'Save changes' : 'Add exercise'}</button>
          {d.id && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => remove.mutate()}>
              <Trash2 size={16} /> {remove.isPending ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}
