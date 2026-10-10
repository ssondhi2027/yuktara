import type { WeekPoint } from '@/lib/api'

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
}

/**
 * Weekly-average weight chart used on Home, Progress and the coach review.
 * Drawn in a fixed 600-wide viewBox and stretched horizontally, so strokes
 * use non-scaling-stroke and dots are HTML-free circles sized per height.
 */
export function LineChart({ points, goal, projection, area = true, height = 180, showLabels = true, highlight, goalLabel, valueLabel, unit = 'kg' }: Props) {
  const W = 600
  const H = height
  const padX = 18
  const padTop = 22
  const padBottom = showLabels ? 30 : 10
  const real = points
    .map((p, i) => ({ kg: p.kg, i }))
    .filter((p): p is { kg: number; i: number } => p.kg != null)
  const values = [...real.map((p) => p.kg), ...(goal != null ? [goal] : []), ...(projection != null ? [projection] : [])]
  const max = Math.max(...values) + 0.5
  const min = Math.min(...values) - 0.5
  const x = (i: number) => padX + (i * (W - padX * 2)) / Math.max(1, points.length - 1)
  const y = (v: number) => padTop + ((max - v) / (max - min)) * (H - padTop - padBottom)

  const line = real.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)} ${y(p.kg)}`).join(' ')
  const last = real[real.length - 1]
  const areaPath = last ? `${line} L${x(last.i)} ${H - padBottom} L${x(real[0].i)} ${H - padBottom} Z` : ''

  return (
    <div className="line-chart" style={{ height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img"
        aria-label={last ? `Weekly average weight, latest ${last.kg} ${unit}${goal != null ? `, goal ${goal} ${unit}` : ''}` : 'No weigh-ins yet'}>
        {area && last && <path d={areaPath} fill="var(--chart-fill)" />}
        {goal != null && (
          <line x1={padX} x2={W - padX} y1={y(goal)} y2={y(goal)} stroke="var(--leaf)" strokeWidth="1.5" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
        )}
        {projection != null && last && (
          <line x1={x(last.i)} y1={y(last.kg)} x2={x(points.length - 1)} y2={y(projection)} stroke="var(--chart)" strokeWidth="2" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
        )}
        <path d={line} fill="none" stroke="var(--chart)" strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Dots and labels are HTML so they stay round and crisp when the SVG stretches. */}
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
          {points.map((p) => (
            <span key={p.label} className={p.label === highlight ? 'strong' : undefined}>{p.label}</span>
          ))}
        </div>
      )}
    </div>
  )
}
