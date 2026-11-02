import { useEffect, useState, type FormEvent } from 'react'
import { usersApi } from '../api'
import type { User } from '../types'

export function LoginPage({ onLogin }: { onLogin: (user: User, remember: boolean) => void }) {
  const [users, setUsers] = useState<User[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    usersApi
      .list()
      .then((list) => {
        if (cancelled) return
        setUsers(list)
        setLoadError(null)
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const typed = name.trim()
  const sameName = users?.find((u) => u.name.toLowerCase() === typed.toLowerCase())
  const willCreate = typed !== '' && !sameName
  const canSubmit = !busy && users !== null && (selectedId !== null || typed !== '')

  function pickUser(id: string) {
    setSelectedId(id)
    setName('')
    setFormError(null)
  }

  function typeName(value: string) {
    setName(value)
    if (value) setSelectedId(null)
    setFormError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setFormError(null)
    try {
      // an existing player is reused (a typed name that already exists will not create a duplicate)
      const existing = selectedId ? users?.find((u) => u.id === selectedId) : sameName
      const user = existing ?? (await usersApi.create(typed)) // new name: the server creates it and returns the id
      onLogin(user, remember)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not log in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <header>
          <h1>Solo Tabletop</h1>
          <p className="muted">Who is playing?</p>
        </header>

        <section aria-label="Existing players">
          {loadError ? (
            <div className="login-error" role="alert">
              <p>{loadError}</p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setUsers(null)
                  setLoadError(null)
                  setAttempt((a) => a + 1)
                }}
              >
                Try again
              </button>
            </div>
          ) : users === null ? (
            <p className="muted">Loading players…</p>
          ) : users.length === 0 ? (
            <p className="muted">No players yet. Type a name below to create the first one.</p>
          ) : (
            <ul className="user-list">
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className={`user-btn ${u.id === selectedId ? 'is-active' : ''}`}
                    aria-pressed={u.id === selectedId}
                    onClick={() => pickUser(u.id)}
                  >
                    <span className="user-initial" aria-hidden="true">
                      {u.name.charAt(0).toUpperCase()}
                    </span>
                    {u.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <label className="field">
          <span>Or create a new player</span>
          <input
            type="text"
            value={name}
            onChange={(e) => typeName(e.target.value)}
            placeholder="Your name"
            maxLength={40}
            autoComplete="off"
          />
        </label>

        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me logged in
        </label>

        {formError && (
          <p className="login-error" role="alert">
            {formError}
          </p>
        )}

        <button className="btn primary" type="submit" disabled={!canSubmit}>
          {busy ? 'One moment…' : willCreate ? 'Create player and continue' : 'Continue'}
        </button>
      </form>
    </main>
  )
}
