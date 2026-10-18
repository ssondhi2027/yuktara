import { useMemo, useState } from 'react'
import type { LibraryExercise } from '@/lib/api'
import { LEVEL_LABEL } from '@/lib/labels'
import { MUSCLE_LABEL } from '@/lib/muscles'
import { MUSCLE_GROUPS, type MuscleGroup } from '@/types/db'
import { Sheet } from '@/components/ui/Sheet'

/**
 * Pick an exercise from the library: search by name, filter by primary muscle.
 * With `swapFor`, only alternatives that work one of its primary muscles are offered.
 */
export function ExercisePicker({ library, exclude, swapFor, onPick, onClose, onCreate }: {
  library: LibraryExercise[]
  exclude: Set<string>
  swapFor?: LibraryExercise
  onPick: (e: LibraryExercise) => void
  onClose: () => void
  /** coach only: offers "Create an exercise" for one that isn't in the library */
  onCreate?: (name: string) => void
}) {
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<MuscleGroup | null>(swapFor?.primary[0] ?? null)
  const muscles = swapFor ? swapFor.primary : MUSCLE_GROUPS

  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return library.filter((e) =>
      !exclude.has(e.id)
      && (!swapFor || e.primary.some((m) => swapFor.primary.includes(m)))
      && (!muscle || e.primary.includes(muscle))
      && words.every((w) => e.name.toLowerCase().includes(w)))
  }, [library, exclude, swapFor, muscle, q])

  return (
    <Sheet title={swapFor ? `Swap ${swapFor.name}` : 'Add an exercise'} onClose={onClose}>
      {swapFor && <p className="small muted">For this workout only. Your coach's plan stays the same.</p>}
      <input className="input" type="search" placeholder="Search exercises" aria-label="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker-muscles" role="group" aria-label="Filter by muscle">
        {!swapFor && <button type="button" className="chip-btn" aria-pressed={muscle === null} onClick={() => setMuscle(null)}>All</button>}
        {muscles.map((m) => (
          <button key={m} type="button" className="chip-btn" aria-pressed={muscle === m} onClick={() => setMuscle(muscle === m && !swapFor ? null : m)}>
            {MUSCLE_LABEL[m]}
          </button>
        ))}
      </div>
      <ul className="picker-list">
        {list.map((e) => (
          <li key={e.id}>
            <button type="button" className="picker-item" onClick={() => onPick(e)}>
              <b>{e.name}{e.custom && <span className="pill awaiting xs custom-tag">Coach's own</span>}</b>
              <span className="xs muted">
                {e.primary.map((m) => MUSCLE_LABEL[m]).join(', ')}{e.equipment ? ` · ${e.equipment}` : ''} · {LEVEL_LABEL[e.level]}
              </span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="small muted" style={{ padding: '12px 4px' }}>No exercises match. Try another name or muscle.</li>}
      </ul>
      {onCreate && (
        <button type="button" className="btn btn-ghost btn-block" onClick={() => onCreate(q.trim())}>
          Not in the list? Create an exercise{q.trim() ? ` called "${q.trim()}"` : ''}
        </button>
      )}
    </Sheet>
  )
}
