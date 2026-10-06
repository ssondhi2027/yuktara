import { int } from '@/lib/units'

/** "Protein 110/140 g" with a bar underneath. */
export function MacroBar({
  label, value, target, unit = 'g', color, layout = 'inline',
}: {
  label: string
  value: number
  target: number
  unit?: string
  color: string
  layout?: 'inline' | 'stacked'
}) {
  const pct = Math.min(100, (value / target) * 100)
  return (
    <div className={`macro macro-${layout}`}>
      {layout === 'inline' ? (
        <div className="between small">
          <span>{label}</span>
          <span className="muted">{int(value)}/{int(target)} {unit}</span>
        </div>
      ) : (
        <>
          <div className="muted small">{label}</div>
          <div className="macro-num"><b className="num">{int(value)}</b> <span className="muted">/ {int(target)} {unit}</span></div>
        </>
      )}
      <div className="bar" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemax={target}>
        <span style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}
