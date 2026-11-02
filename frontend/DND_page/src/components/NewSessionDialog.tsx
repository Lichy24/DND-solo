import { useEffect, useRef, useState, type FormEvent } from 'react'

/** Centred pop-up that asks for the session name before anything is sent to the server. */
export function NewSessionDialog({ onCreate, onClose }: {
  onCreate: (name: string) => Promise<void> // resolves on success (the parent then closes this dialog)
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  const trimmed = name.trim()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the session.')
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="ns-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose() // click on the backdrop
      }}
    >
      <form className="modal-body" onSubmit={submit}>
        <h2 id="ns-title">Name your adventure</h2>
        <label className="field">
          <span>Session name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The Sunken Chapel"
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
          <button type="submit" className="btn primary" disabled={!trimmed || busy}>
            {busy ? 'Creating…' : 'Create session'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
