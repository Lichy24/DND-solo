import { useEffect, useRef, useState, type FormEvent } from 'react'

/** Centred pop-up that asks for a name (new session, rename session) before anything is sent to the server. */
export function NameDialog({ title, label, placeholder, initialName = '', submitLabel, busyLabel, onSubmit, onClose }: {
  title: string
  label: string
  placeholder?: string
  initialName?: string
  submitLabel: string
  busyLabel: string
  onSubmit: (name: string) => Promise<void> // resolves on success (the parent then closes this dialog)
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  const trimmed = name.trim()
  const unchanged = trimmed === initialName.trim()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!trimmed || unchanged || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="name-dialog-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose() // click on the backdrop
      }}
    >
      <form className="modal-body" onSubmit={submit}>
        <h2 id="name-dialog-title">{title}</h2>
        <label className="field">
          <span>{label}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder={placeholder}
            maxLength={80}
            autoComplete="off"
            autoFocus
          />
        </label>
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!trimmed || unchanged || busy}>
            {busy ? busyLabel : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
