import type { DaySummary } from '@/lib/api'
import { weekday } from '@/lib/dates'

const R = 78
const W = 26

function arc(a0: number, a1: number, r: number, cx = 100) {
  const p = (a: number) => [cx + r * Math.cos(a), cx + r * Math.sin(a)]
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  return `M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}`
}

/** Seven-segment week ring on the client Home: gold = logged, green = today. */
export function DayRing({ days, size = 180 }: { days: DaySummary[]; size?: number }) {
  const logged = days.filter((d) => d.logged).length
  const step = (2 * Math.PI) / 7
  const gap = 0.035
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={`${logged} of 7 days logged`} className="day-ring">
      {days.map((d, i) => {
        const a0 = -Math.PI / 2 + i * step + gap
        const a1 = -Math.PI / 2 + (i + 1) * step - gap
        const mid = (a0 + a1) / 2
        const color = d.is_today ? '#8CC27A' : d.logged ? '#DDAC4F' : 'rgb(255 255 255 / 0.14)'
        return (
          <g key={d.date}>
            <path d={arc(a0, a1, R)} stroke={color} strokeWidth={W} fill="none" />
            <text x={100 + R * Math.cos(mid)} y={100 + R * Math.sin(mid)} dy="0.35em" textAnchor="middle" className="day-ring-label">
              {weekday(d.date)[0]}
            </text>
          </g>
        )
      })}
      <text x="100" y="104" textAnchor="middle" className="day-ring-num">{logged}/7</text>
      <text x="100" y="128" textAnchor="middle" className="day-ring-sub">days logged</text>
    </svg>
  )
}

/** Small segmented ring for the coach table's "Days logged" column. */
export function MiniRing({ value, total = 7, size = 22 }: { value: number; total?: number; size?: number }) {
  const step = (2 * Math.PI) / total
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <path
          key={i}
          d={arc(-Math.PI / 2 + i * step + 0.18, -Math.PI / 2 + (i + 1) * step - 0.18, 9, 12)}
          fill="none"
          strokeWidth="4"
          stroke={i < value ? 'var(--leaf)' : 'var(--chip)'}
        />
      ))}
    </svg>
  )
}
