/** Plan-followed blocks on the client Progress screen. */
export function PlanBars({ weeks, target }: { weeks: { label: string; pct: number | null; partial?: boolean }[]; target: number }) {
  return (
    <div className="plan-bars">
      {weeks.map((w) => {
        const cls = w.partial || w.pct == null ? 'partial' : w.pct >= target ? 'hit' : 'miss'
        return (
          <div key={w.label} className="plan-bar">
            <span className="num">{w.pct == null ? '—' : `${w.pct}%`}</span>
            <div className={`plan-block ${cls}`} style={{ height: Math.max(56, 56 + ((w.pct ?? 75) - 75) * 1.2) }} />
            <span className="muted small">{w.label}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Training vs food bars per week on the coach review. */
export function PairBars({ weeks, highlight }: { weeks: { label: string; training: number; food: number }[]; highlight?: string }) {
  return (
    <div className="pair-bars" role="img" aria-label="Plan followed by week, training and food">
      {weeks.map((w) => (
        <div key={w.label} className="pair">
          <div className="pair-cols">
            <div className="pair-col">
              <span className="xs">{w.training}</span>
              <i className="training" style={{ height: `${w.training * 0.7}px` }} />
            </div>
            <div className="pair-col">
              <span className="xs">{w.food}</span>
              <i className="food" style={{ height: `${w.food * 0.7}px` }} />
            </div>
          </div>
          <span className={`xs${w.label === highlight ? ' strong' : ' muted'}`}>{w.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Five-step score bar: Energy 4 / 5. */
export function ScaleBar({ value, max = 5, tone = 'ink' }: { value: number; max?: number; tone?: 'ink' | 'warn' }) {
  return (
    <div className="scale-bar" aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < value ? `on ${tone}` : undefined} />
      ))}
    </div>
  )
}

/** Six-week weight sparkline for the coach table. */
export function Sparkline({ values, tone = 'good', width = 72, height = 22 }: { values: number[]; tone?: 'good' | 'bad'; width?: number; height?: number }) {
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const d = values
    .map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1)) * width} ${2 + ((max - v) / span) * (height - 4)}`)
    .join(' ')
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={d} fill="none" stroke={tone === 'good' ? 'var(--green)' : 'var(--orange)'} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}
