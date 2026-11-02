import type { DeathSaves } from '../types'

/** Three dots for successes and three for failures. Click a dot to fill it; click the last filled dot to clear it. */
export function DeathSavesBox({ value, onChange, className = '' }: {
  value: DeathSaves
  onChange: (next: DeathSaves) => void
  className?: string
}) {
  const row = (kind: 'successes' | 'failures', label: string) => (
    <div className={`ds-row ${kind}`}>
      <span>{label}</span>
      <div className="ds-dots" role="group" aria-label={label}>
        {[0, 1, 2].map((i) => {
          const on = value[kind] > i
          return (
            <button
              key={i}
              type="button"
              className={`dot ${on ? 'on' : ''}`}
              aria-pressed={on}
              aria-label={`${label}: ${i + 1}`}
              onClick={() => onChange({ ...value, [kind]: value[kind] === i + 1 ? i : i + 1 })}
            />
          )
        })}
      </div>
    </div>
  )

  return (
    <fieldset className={`ds ${className}`}>
      <legend>Death saves</legend>
      {row('successes', 'Successes')}
      {row('failures', 'Failures')}
    </fieldset>
  )
}
