import { useQuery } from '@tanstack/react-query'
import { BookOpen, Lightbulb } from 'lucide-react'
import { api } from '@/lib/api'
import { BAND_COLOR, MUSCLE_LABEL, setBand } from '@/lib/muscles'
import type { MuscleGroup } from '@/types/db'
import { Sheet } from '@/components/ui/Sheet'

const BAND_TEXT = { high: '10 or more sets', some: '1 to 9 sets', none: 'Not trained yet' } as const

/** Exercise list for one muscle group. Used in the sheet (phone, iPad) and the desktop side panel. */
export function MuscleDetail({ muscle, tapped }: { muscle: MuscleGroup; tapped?: string | null }) {
  const { data } = useQuery({ queryKey: ['muscle', muscle], queryFn: () => api.muscle(muscle) })
  if (!data) return <div className="skeleton" style={{ height: 240 }} />

  const primary = data.exercises.filter((e) => e.role === 'primary')
  const secondary = data.exercises.filter((e) => e.role === 'secondary')

  return (
    <div className="stack muscle-detail">
      {tapped && <p className="small muted">You tapped the {tapped}.</p>}
      <div className="row">
        <i className="muscle-dot lg" style={{ background: BAND_COLOR[setBand(data.hard_sets)] }} aria-hidden />
        <b className="num" style={{ fontSize: 30 }}>{data.hard_sets}</b>
        <div>
          <div>hard sets this week</div>
          <div className="small muted">{BAND_TEXT[setBand(data.hard_sets)]}</div>
        </div>
      </div>

      {data.note && (
        <div className={`muscle-note ${data.note.kind}`}>
          {data.note.kind === 'research' ? <BookOpen size={18} /> : <Lightbulb size={18} />}
          <div>
            <b className="eyebrow" style={{ color: 'inherit' }}>{data.note.kind === 'research' ? 'Research' : 'Coach tip'}</b>
            <p className="small">{data.note.text}</p>
            {data.note.source_url && <a className="xs link" href={data.note.source_url} target="_blank" rel="noreferrer">Source</a>}
          </div>
        </div>
      )}

      <ExerciseList title={`Exercises for ${MUSCLE_LABEL[muscle].toLowerCase()}`} items={primary} />
      {secondary.length > 0 && <ExerciseList title="Also works this muscle" items={secondary} />}
    </div>
  )
}

function ExerciseList({ title, items }: { title: string; items: Awaited<ReturnType<typeof api.muscle>>['exercises'] }) {
  return (
    <section>
      <h3 className="ex-title">{title} <span className="faint small">{items.length}</span></h3>
      <ul className="ex-list">
        {items.map((e) => (
          <li key={e.name} className="ex-item">
            <div className="between">
              <b>{e.name}</b>
              {e.sets_this_week > 0 && <span className="pill good xs">{e.sets_this_week} sets this week</span>}
            </div>
            <div className="xs muted ex-meta">
              <span>{cap(e.equipment)}</span>
              <span>{cap(e.level)}</span>
            </div>
            {e.cue && <p className="small ex-cue">{e.cue}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function MuscleSheet({ muscle, tapped, onClose }: { muscle: MuscleGroup; tapped?: string | null; onClose: () => void }) {
  return (
    <Sheet title={MUSCLE_LABEL[muscle]} onClose={onClose}>
      <MuscleDetail muscle={muscle} tapped={tapped} />
    </Sheet>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
