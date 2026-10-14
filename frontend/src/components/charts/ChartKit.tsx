import { useEffect, useRef, useState } from 'react'

// Small SVG charts for the Progress page, in the same style as LineChart: a
// fixed-width viewBox stretched to the container (non-scaling strokes), HTML
// labels and tooltips so text stays crisp. Tap (touch) or hover (mouse) a
// point to see its value; labels thin out when the chart is narrow.

const W = 600

/** The element's width in CSS pixels, kept up to date as it resizes. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** Which of n labels to show at this width (about one per 52 px; the last always). */
export function visibleLabels(n: number, width: number, per = 52): boolean[] {
  const room = Math.max(2, Math.floor((width || 320) / per))
  const step = Math.max(1, Math.ceil(n / room))
  return Array.from({ length: n }, (_, i) => i === n - 1 || (i % step === 0 && n - 1 - i >= step / 2))
}

/** Pointer handling shared by the charts: index under the pointer, tooltip state. */
function usePointer(count: number, padX: number) {
  const [active, setActive] = useState<number | null>(null)
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const fx = ((e.clientX - r.left) / r.width) * W
    const i = Math.round(((fx - padX) / (W - padX * 2)) * Math.max(1, count - 1))
    setActive(Math.min(count - 1, Math.max(0, i)))
  }
  return {
    active,
    handlers: {
      onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => e.pointerType === 'mouse' && pick(e),
      onPointerDown: pick,
      onPointerLeave: (e: React.PointerEvent<HTMLDivElement>) => e.pointerType === 'mouse' && setActive(null),
    },
    clear: () => setActive(null),
  }
}

function Tip({ x, children }: { x: number; children: React.ReactNode }) {
  // Keep the tip inside the card near the edges.
  const pct = (x / W) * 100
  const shift = pct < 15 ? '0%' : pct > 85 ? '-100%' : '-50%'
  return <div className="chart-tip" role="status" style={{ left: `${pct}%`, transform: `translateX(${shift})` }}>{children}</div>
}

export interface BarItem { label: string; tip: string; value: number | null; target?: number | null; planned?: number | null; good?: boolean }

/**
 * Bars per day or week. `target` draws a short line across the bar (e.g. the
 * calorie target that day); `planned` draws an outline behind the bar (e.g.
 * workouts planned vs done).
 */
export function BarChart({ items, height = 160, label, color = 'var(--chart)' }: { items: BarItem[]; height?: number; label: string; color?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const padX = 10
  const padTop = 12
  const padBottom = 24
  const max = Math.max(1, ...items.flatMap((b) => [b.value ?? 0, b.target ?? 0, b.planned ?? 0])) * 1.08
  const slot = (W - padX * 2) / Math.max(1, items.length)
  const bw = Math.max(2, Math.min(42, slot * 0.62))
  const cx = (i: number) => padX + slot * (i + 0.5)
  const y = (v: number) => padTop + (1 - v / max) * (height - padTop - padBottom)
  const { active, handlers } = usePointer(items.length, padX + slot / 2)
  const show = visibleLabels(items.length, width, 44)
  const a = active != null ? items[active] : null

  return (
    <div className="kit-chart" ref={ref} style={{ height }} {...handlers}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={label}>
        {items.map((b, i) => (
          <g key={b.label + i}>
            {b.planned != null && b.planned > 0 && (
              <rect x={cx(i) - bw / 2} y={y(b.planned)} width={bw} height={height - padBottom - y(b.planned)} rx="3"
                fill="none" stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            )}
            {b.value != null && b.value > 0 && (
              <rect x={cx(i) - bw / 2} y={y(b.value)} width={bw} height={height - padBottom - y(b.value)} rx="3"
                fill={b.good === false ? 'var(--peach-ink)' : color} opacity={active == null || active === i ? 1 : 0.55} />
            )}
            {b.target != null && b.target > 0 && (
              <line x1={cx(i) - slot / 2 + 1} x2={cx(i) + slot / 2 - 1} y1={y(b.target)} y2={y(b.target)}
                stroke="var(--leaf)" strokeWidth="2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            )}
          </g>
        ))}
      </svg>
      <div className="kit-labels" style={{ paddingInline: `${(padX / W) * 100}%` }}>
        {items.map((b, i) => <span key={b.label + i}>{show[i] ? b.label : ''}</span>)}
      </div>
      {a && active != null && <Tip x={cx(active)}>{a.tip}</Tip>}
    </div>
  )
}

export interface Series { name: string; color: string; values: (number | null)[]; dashed?: boolean }

/** Several lines over the same labels (lifts over time, check-in scores, waist and hips). */
export function MultiLineChart({ labels, series, height = 170, label, format, min: minIn, max: maxIn, connectGaps = false }: {
  labels: string[]
  /** draw through missing values (a lift logged on different days) instead of breaking the line */
  connectGaps?: boolean
  series: Series[]
  height?: number
  label: string
  format: (v: number, s: Series, index: number) => string
  min?: number
  max?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const padX = 16
  const padTop = 14
  const padBottom = 24
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null)
  const lo = minIn ?? Math.min(...all)
  const hi = maxIn ?? Math.max(...all)
  const span = hi - lo || 1
  const min = minIn ?? lo - span * 0.12
  const max = maxIn ?? hi + span * 0.12
  const x = (i: number) => padX + (i * (W - padX * 2)) / Math.max(1, labels.length - 1)
  const y = (v: number) => padTop + ((max - v) / (max - min)) * (height - padTop - padBottom)
  const { active, handlers } = usePointer(labels.length, padX)
  const show = visibleLabels(labels.length, width)

  return (
    <div className="kit-chart" ref={ref} style={{ height }} {...handlers}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={label}>
        {active != null && <line x1={x(active)} x2={x(active)} y1={padTop} y2={height - padBottom} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        {series.map((s) => {
          // Gaps stay gaps: a new segment starts after a missing value.
          let d = ''
          let pen = false
          s.values.forEach((v, i) => {
            if (v == null) { if (!connectGaps) pen = false; return }
            d += `${pen ? 'L' : 'M'}${x(i)} ${y(v)} `
            pen = true
          })
          return <path key={s.name} d={d} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeDasharray={s.dashed ? '6 5' : undefined} vectorEffect="non-scaling-stroke" />
        })}
      </svg>
      {series.flatMap((s) => s.values.map((v, i) => v == null ? null : (
        <span key={`${s.name}-${i}`} className="kit-dot" style={{ left: `${(x(i) / W) * 100}%`, top: y(v), borderColor: s.color, background: active === i ? s.color : undefined }} />
      )))}
      <div className="kit-labels" style={{ paddingInline: `${(padX / W) * 100}%` }}>
        {labels.map((l, i) => <span key={l + i}>{show[i] ? l : ''}</span>)}
      </div>
      {active != null && (
        <Tip x={x(active)}>
          <b>{labels[active]}</b>
          {series.map((s) => s.values[active] != null && <span key={s.name}><i style={{ background: s.color }} /> {format(s.values[active]!, s, active)}</span>)}
        </Tip>
      )}
    </div>
  )
}

export function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="kit-legend xs muted">
      {items.map((i) => <span key={i.name}><i className={i.dashed ? 'dashed' : undefined} style={{ borderColor: i.color, background: i.dashed ? undefined : i.color }} /> {i.name}</span>)}
    </div>
  )
}
