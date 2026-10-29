// The landing page's 3D body: the Train tab's body map with an example week,
// turning slowly. Loaded on its own (React.lazy) after the page is up, so the
// landing page's first paint and the pre-rendered HTML never wait for three.js
// or the models.

import { useCallback, useState } from 'react'
import type { MuscleGroup } from '@/types/db'
import { MUSCLE_LABEL } from '@/lib/muscles'
import BodyMap, { type HoverInfo } from '@/features/client/train/BodyMap'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { SAMPLE_SETS } from './heroSample'

export default function HeroBodyCanvas({ dark, still, touch }: { dark: boolean; still: boolean; touch: boolean }) {
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [picked, setPicked] = useState<{ group: MuscleGroup; name: string } | null>(null)
  // The placeholder stays until the model has loaded (the download is ~6 MB).
  const [ready, setReady] = useState(false)
  const onReady = useCallback(() => setReady(true), [])
  const label = (group: MuscleGroup | null) => (group ? `${MUSCLE_LABEL[group]} · ${SAMPLE_SETS[group]} sets this week` : 'Not tracked in training')
  return (
    <>
      <BodyMap sets={SAMPLE_SETS} selected={picked?.group ?? null} view="front" resetKey={0} focus={null} zoom={false} dark={dark} colorMode="sets"
        onSelect={(group, name) => setPicked((p) => (p?.group === group ? null : { group, name }))} onHover={setHover} onReady={onReady}
        autoRotate={!still && !hover} rotate={!touch} />
      {!ready && (
        <div className="hero-placeholder" aria-hidden="true">
          <BrandLogo size={72} />
          <span className="xs muted">Loading the 3D body…</span>
        </div>
      )}
      {hover && !touch && (
        <div className="hero-tip" style={{ left: hover.x, top: hover.y }}>
          <b>{hover.side ? `${hover.side} ` : ''}{hover.name.charAt(0).toLowerCase() + hover.name.slice(1)}</b>
          <span>{label(hover.group)}</span>
        </div>
      )}
      {picked && (
        <div className="hero-picked" role="status">
          <b>{picked.name.charAt(0).toUpperCase() + picked.name.slice(1)}</b> · {label(picked.group)}
        </div>
      )}
    </>
  )
}
