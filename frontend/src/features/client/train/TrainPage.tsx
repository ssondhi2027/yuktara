import { Suspense, lazy, useCallback, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, LocateFixed, Maximize, RotateCw } from 'lucide-react'
import type { Vector3 } from 'three'
import { api, type TrainWeek } from '@/lib/api'
import { shortDay } from '@/lib/dates'
import { BAND_COLOR, MUSCLE_LABEL, setBand } from '@/lib/muscles'
import { MUSCLE_GROUPS, type MuscleGroup } from '@/types/db'
import { useIsDark, useLayout } from '@/app/hooks'
import { Segmented } from '@/components/ui/Segmented'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { BodyMapProgress, type ColorMode, type HoverInfo } from './BodyMap'
import { MuscleDetail, MuscleSheet } from './MuscleSheet'
import './train.css'

const BodyMap = lazy(() => import('./BodyMap'))

export default function TrainPage() {
  const { data, error, isPending } = useQuery({ queryKey: ['train'], queryFn: api.trainWeek })
  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />
  return <Train data={data} />
}

function Train({ data }: { data: TrainWeek }) {
  const layout = useLayout()
  const dark = useIsDark()
  const [view, setView] = useState<'front' | 'back'>('front')
  const [colorMode, setColorMode] = useState<ColorMode>('sets')
  const [selected, setSelected] = useState<MuscleGroup | null>(null)
  const [tapped, setTapped] = useState<string | null>(null)
  const [focus, setFocus] = useState<Vector3 | null>(null)
  const [centers, setCenters] = useState<Partial<Record<MuscleGroup, Vector3>>>({})
  const [resetKey, setResetKey] = useState(0)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const total = Object.values(data.sets).reduce((a, b) => a + b, 0)
  const trained = MUSCLE_GROUPS.filter((m) => data.sets[m] > 0).length
  const untrained = MUSCLE_GROUPS.filter((m) => data.sets[m] === 0)
  const desktop = layout === 'desktop'
  const phone = layout === 'phone'

  /** From the body (with the exact muscle tapped) or from the list. */
  const open = useCallback((m: MuscleGroup, muscleName: string | null = null) => {
    setSelected(m)
    setTapped(muscleName)
    setHover(null)
    if (!desktop) setSheetOpen(true)
  }, [desktop])

  const closeDetail = () => {
    setSelected(null)
    setTapped(null)
    setSheetOpen(false)
  }

  const mapCard = (
    <section className="card map-card">
      <div className="map-top">
        {colorMode === 'sets' ? (
          <div className="map-legend">
            <div className="eyebrow">Sets this week</div>
            <Legend band="high" label="10 or more" />
            <Legend band="some" label="1 to 9" />
            <Legend band="none" label="None yet" />
          </div>
        ) : (
          <div className="map-legend"><div className="eyebrow">Anatomy</div></div>
        )}
        <Segmented label="Colour" variant="light" value={colorMode} onChange={setColorMode}
          options={[{ value: 'sets', label: 'Sets' }, { value: 'anatomy', label: 'Anatomy' }]} />
      </div>

      <div className="map-canvas">
        <Suspense fallback={<div className="placeholder">Loading body map…</div>}>
          <BodyMap sets={data.sets} selected={selected} onSelect={open} onHover={setHover} onReady={setCenters}
            view={view} resetKey={resetKey} focus={focus} zoom={!phone} dark={dark} colorMode={colorMode} />
        </Suspense>
        <BodyMapProgress />
        {hover && (
          <div className="map-tip" style={{ left: hover.x, top: hover.y }}>
            <b>{hover.side ? `${hover.side} ` : ''}{hover.name.charAt(0).toLowerCase() + hover.name.slice(1)}</b>
            <span>{hover.group ? `${MUSCLE_LABEL[hover.group]} · ${data.sets[hover.group]} sets this week` : 'Not tracked in your training'}</span>
          </div>
        )}
      </div>

      <div className="map-controls">
        <Segmented label="Side" value={view} onChange={(v) => { setFocus(null); setView(v) }}
          options={[{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]} />
        <span className="map-hint xs muted">{desktop ? 'Drag to turn · scroll to zoom · click a muscle' : 'Drag to turn · tap a muscle'}</span>
        <div className="row" style={{ gap: 8 }}>
          <button className="icon-btn" aria-label="Reset view" onClick={() => { setFocus(null); closeDetail(); setResetKey((k) => k + 1) }}>
            <RotateCw size={20} />
          </button>
          <button className="icon-btn" aria-label={selected ? `Zoom to ${MUSCLE_LABEL[selected]}` : 'Zoom to the torso'}
            onClick={() => setFocus(centers[selected ?? 'abs']?.clone() ?? null)}>
            {desktop ? <Maximize size={18} /> : <LocateFixed size={20} />}
          </button>
        </div>
      </div>
    </section>
  )

  const credit = (
    <p className="xs faint model-credit">
      3D anatomy adapted from <a href="https://www.z-anatomy.com" target="_blank" rel="noreferrer">Z-Anatomy</a> and
      {' '}<a href="https://lifesciencedb.jp/bp3d/" target="_blank" rel="noreferrer">BodyParts3D</a> (DBCLS),
      {' '}<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
    </p>
  )

  const w = data.workout
  const todayBar = w ? (
    <section className="today-bar">
      <div className="grow">
        <div className="small" style={{ opacity: 0.8 }}>Today · {w.name}{!phone && w.duration_min ? ` · ${w.duration_min} min` : ''}</div>
        <b className="num today-sets">{w.sets_done} of {w.sets_total} sets done</b>
      </div>
      <Link to="/" className="btn btn-gold btn-lg">{phone ? 'Continue' : 'Continue workout'}</Link>
    </section>
  ) : (
    <section className="today-bar">
      <div className="grow">
        <div className="small" style={{ opacity: 0.8 }}>Today</div>
        <b className="today-sets">{data.has_program ? 'Rest day' : 'Your coach is setting up your plan'}</b>
      </div>
    </section>
  )

  return (
    <div className="page train">
      <header className="page-head">
        <div>
          {!phone && <div className="page-date">{shortDay(data.today)} · Week {data.week}{data.weeks ? ` of ${data.weeks}` : ''}</div>}
          <h1>{desktop ? 'Training' : 'Train'}</h1>
          {phone && <div className="sub">Week {data.week} · tap a muscle for exercises</div>}
        </div>
      </header>

      {desktop ? (
        <div className="train-desktop">
          <div className="stack" style={{ gap: 8 }}>{mapCard}{credit}</div>
          <section className="card muscles-panel">
            {selected ? (
              <>
                <div className="card-head">
                  <button className="back-btn" onClick={closeDetail}><ChevronLeft size={18} /> All muscles</button>
                </div>
                <h2 style={{ marginBottom: 10 }}>{MUSCLE_LABEL[selected]}</h2>
                <div className="panel-scroll"><MuscleDetail muscle={selected} tapped={tapped} /></div>
              </>
            ) : (
              <>
                <div className="card-head">
                  <h2>Muscles this week</h2>
                  <span className="small muted">{total} hard sets across {trained} of {MUSCLE_GROUPS.length} muscles</span>
                </div>
                <p className="small muted" style={{ marginTop: -6, marginBottom: 14 }}>Click a muscle on the body or in this list to see its exercises.</p>
                <div className="muscle-list">
                  {MUSCLE_GROUPS.map((m) => (
                    <button key={m} className="muscle-row" onClick={() => open(m)}>
                      <Dot sets={data.sets[m]} />
                      <span className="grow">{MUSCLE_LABEL[m]}</span>
                      <span className="small muted">{data.sets[m]} sets</span>
                      <ChevronRight size={16} className="faint" />
                    </button>
                  ))}
                </div>
                {untrained.length > 0 && (
                  <div className="untrained">
                    <b className="small">Not trained yet this week</b>
                    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                      {untrained.map((m) => <button key={m} className="untrained-chip" onClick={() => open(m)}>{MUSCLE_LABEL[m]}</button>)}
                    </div>
                  </div>
                )}
              </>
            )}
            {todayBar}
          </section>
        </div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="stack" style={{ gap: 6 }}>{mapCard}{credit}</div>
          <div className="between">
            <h3>Browse by muscle</h3>
            <span className="small muted">{phone ? 'Sets this week' : `Numbers are sets this week · ${total} in total`}</span>
          </div>
          <div className={phone ? 'muscle-chips' : 'muscle-grid'}>
            {MUSCLE_GROUPS.map((m) => (
              <button key={m} className={`muscle-chip${selected === m ? ' active' : ''}`} onClick={() => open(m)}>
                <Dot sets={data.sets[m]} />
                <span className="grow">{MUSCLE_LABEL[m]}</span>
                <span className="count-badge">{data.sets[m]}</span>
              </button>
            ))}
          </div>
          {todayBar}
        </div>
      )}

      {sheetOpen && selected && <MuscleSheet muscle={selected} tapped={tapped} onClose={closeDetail} />}
    </div>
  )
}

function Legend({ band, label }: { band: 'high' | 'some' | 'none'; label: string }) {
  return (
    <div className="legend-row small">
      <i style={{ background: BAND_COLOR[band] }} />
      {label}
    </div>
  )
}

function Dot({ sets }: { sets: number }) {
  return <i className="muscle-dot" style={{ background: BAND_COLOR[setBand(sets)] }} aria-hidden />
}
