import { useState } from 'react'
import type { WeekPoint } from '@/lib/api'
import { useWidth, visibleLabels } from './ChartKit'

interface Props {
  points: WeekPoint[]
  goal?: number
  /** Dashed "at current pace" line from the last real point to this value at the last label. */
  projection?: number
  area?: boolean
  height?: number
  showLabels?: boolean
  highlight?: string
  goalLabel?: string
  valueLabel?: string
  /** unit of the values, for screen readers (points are already in it) */
  unit?: string
  /** faint daily weigh-ins; `at` is a fractional point index (2.5 = mid-way through the third week) */
  daily?: { at: number; kg: number }[]
  /** tooltip text per point (tap or hover); null = nothing to show */
  tips?: (string | null)[]
  /**
   * A forecast: a dashed line through `value` with a shaded range from `lo` to
   * `hi` (e.g. an 80% band). `at` is a point index; start it at the last real
   * point with lo = hi = value so the band fans out from there.
   */
  band?: { at: number; value: number; lo: number; hi: number }[]
}

/**
 * Weekly-average weight chart used on Home, Progress and the coach review.
 * Drawn in a fixed 600-wide viewBox and stretched horizontally, so strokes
 * use non-scaling-stroke and dots are HTML-free circles sized per height.
 */
export function LineChart({ points, goal, projection, area = true, height = 180, showLabels = true, highlight, goalLabel, valueLabel, unit = 'kg', daily, tips, band }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const W = 600
  const H = height
  const padX = 18
  const padTop = 22
  const padBottom = showLabels ? 30 : 10
  const real = points
    .map((p, i) => ({ kg: p.kg, i }))
    .filter((p): p is { kg: number; i: number } => p.kg != null)
  const values = [...real.map((p) => p.kg), ...(goal != null ? [goal] : []), ...(projection != null ? [projection] : []), ...(daily ?? []).map((d) => d.kg), ...(band ?? []).flatMap((b) => [b.lo, b.hi])]
  const max = Math.max(...values) + 0.5
  const min = Math.min(...values) - 0.5
  const x = (i: number) => padX + (i * (W - padX * 2)) / Math.max(1, points.length - 1)
  const y = (v: number) => padTop + ((max - v) / (max - min)) * (H - padTop - padBottom)

  const line = real.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)} ${y(p.kg)}`).join(' ')
  const last = real[real.length - 1]
  const shown = visibleLabels(points.length, width, 40)
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((((e.clientX - r.left) / r.width) * W - padX) / (W - padX * 2)) * Math.max(1, points.length - 1))
    setActive(Math.min(points.length - 1, Math.max(0, i)))
  }
  const areaPath = last ? `${line} L${x(last.i)} ${H - padBottom} L${x(real[0].i)} ${H - padBottom} Z` : ''
  const bandArea = band && band.length > 1
    ? `${band.map((b, k) => `${k ? 'L' : 'M'}${x(b.at)} ${y(b.hi)}`).join(' ')} ${[...band].reverse().map((b) => `L${x(b.at)} ${y(b.lo)}`).join(' ')} Z`
    : ''
  const bandLine = band && band.length > 1 ? band.map((b, k) => `${k ? 'L' : 'M'}${x(b.at)} ${y(b.value)}`).join(' ') : ''

  return (
    <div className="line-chart" ref={ref} style={{ height: H }}
      {...(tips ? {
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => pick(e),
        onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => e.pointerType === 'mouse' && pick(e),
        onPointerLeave: (e: React.PointerEvent<HTMLDivElement>) => e.pointerType === 'mouse' && setActive(null),
      } : {})}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img"
        aria-label={last ? `Weekly average weight, latest ${last.kg} ${unit}${goal != null ? `, goal ${goal} ${unit}` : ''}` : 'No weigh-ins yet'}>
        {area && last && <path d={areaPath} fill="var(--chart-fill)" />}
        {goal != null && (
          <line x1={padX} x2={W - padX} y1={y(goal)} y2={y(goal)} stroke="var(--leaf)" strokeWidth="1.5" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
        )}
        {projection != null && last && (
          <line x1={x(last.i)} y1={y(last.kg)} x2={x(points.length - 1)} y2={y(projection)} stroke="var(--chart)" strokeWidth="2" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
        )}
        {bandArea && <path d={bandArea} fill="var(--chart)" opacity={0.14} />}
        {bandLine && <path d={bandLine} fill="none" stroke="var(--chart)" strokeWidth="2" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />}
        <path d={line} fill="none" stroke="var(--chart)" strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Dots and labels are HTML so they stay round and crisp when the SVG stretches. */}
      {daily?.map((d, k) => <span key={`d${k}`} className="chart-daily" style={{ left: `${(x(d.at) / W) * 100}%`, top: y(d.kg) }} />)}
      {real.map((p) => (
        <span key={p.i} className={`chart-dot${p === last ? ' last' : ''}`} style={{ left: `${(x(p.i) / W) * 100}%`, top: y(p.kg) }} />
      ))}
      {goal != null && goalLabel && (
        <span className="chart-goal" style={{ top: y(goal) - 20 }}>{goalLabel}</span>
      )}
      {valueLabel && last && (
        <span className="chart-value" style={{ left: `${(x(last.i) / W) * 100}%`, top: y(last.kg) - 30 }}>{valueLabel}</span>
      )}
      {showLabels && (
        <div className="chart-labels" style={{ paddingInline: `${(padX / W) * 100}%` }}>
          {points.map((p, i) => (
            <span key={p.label} className={p.label === highlight ? 'strong' : undefined}>{shown[i] ? p.label : ''}</span>
          ))}
        </div>
      )}
      {tips && active != null && tips[active] && (
        <div className="chart-tip" role="status" style={{ left: `${(x(active) / W) * 100}%`, transform: `translateX(${active === 0 ? '0%' : active === points.length - 1 ? '-100%' : '-50%'})` }}>{tips[active]}</div>
      )}
    </div>
  )
}
