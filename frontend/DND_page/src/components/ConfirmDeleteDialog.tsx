import { useEffect, useRef, useState, type FormEvent } from 'react'

const WORD = 'DELETE'

/** "Are you sure?" pop-up: OK stays disabled until the word DELETE has been typed. */
export function ConfirmDeleteDialog({ title, detail, onConfirm, onClose }: {
  title: string
  detail: string
  onConfirm: () => Promise<void> // resolves on success (the parent then closes this dialog)
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  const confirmed = text.trim() === WORD

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!confirmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.')
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="confirm-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <form className="modal-body" onSubmit={submit}>
        <h2 id="confirm-title" className="danger-title">
          {title}
        </h2>
        <p>{detail}</p>
        <p className="muted">This cannot be undone.</p>
        <label className="field">
          <span>
            Type <strong>{WORD}</strong> to confirm
          </span>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            spellCheck={false}
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
          <button type="submit" className="btn danger" disabled={!confirmed || busy}>
            {busy ? 'Deleting…' : 'OK'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
