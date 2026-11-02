const pct = (cur: number, max: number) => `${Math.max(0, Math.min(100, (cur / max) * 100))}%`

export function Meter({ kind, label, current, max }: { kind: 'hp' | 'res'; label: string; current: number; max: number }) {
  return (
    <div className={`bar ${kind}`} role="meter" aria-label={label} aria-valuenow={current} aria-valuemin={0} aria-valuemax={max}>
      <div style={{ width: pct(current, max) }} />
      <span>
        {label} {current}/{max}
      </span>
    </div>
  )
}
