export interface SegOption<T extends string> { value: T; label: React.ReactNode }

export function Segmented<T extends string>({
  options, value, onChange, variant, block, label,
}: {
  options: SegOption<T>[]
  value: T
  onChange: (v: T) => void
  variant?: 'light'
  block?: boolean
  label: string
}) {
  return (
    <div className={['seg', variant, block && 'block'].filter(Boolean).join(' ')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
