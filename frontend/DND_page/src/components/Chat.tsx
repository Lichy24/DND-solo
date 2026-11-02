import { useEffect, useRef, useState } from 'react'
import type { Message, ModelOption, Session } from '../types'

export function ChatHistory({ session, messages, pending, loading = false }: {
  session: Session | null
  messages: Message[]
  pending: boolean
  loading?: boolean
}) {
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, pending])

  return (
    <section className="history" aria-label="Adventure log" aria-live="polite">
      {!session ? (
        <p className="empty-state">Open a session on the left, or start a new one, to begin your adventure.</p>
      ) : (
        <>
          <h1 className="session-title">{session.title}</h1>
          {loading ? (
            <p className="empty-state">Loading the adventure so far…</p>
          ) : (
            messages.length === 0 && <p className="empty-state">The table is quiet. Tell the DM what your party does first.</p>
          )}
          {messages.map((m) => (
            <article key={m.id} className={`msg ${m.role}`}>
              {m.role !== 'system' && <span className="who">{m.role === 'dm' ? 'Dungeon Master' : 'You'}</span>}
              <p>{m.text}</p>
            </article>
          ))}
          {pending && <p className="msg system">The DM is thinking…</p>}
        </>
      )}
      <div ref={end} />
    </section>
  )
}

export function Composer({ models, model, onModelChange, disabled, onSend }: {
  models: ModelOption[]
  model: string
  onModelChange: (id: string) => void
  disabled: boolean
  onSend: (text: string) => void
}) {
  const [text, setText] = useState('')

  function submit() {
    const t = text.trim()
    if (!t || disabled) return
    onSend(t)
    setText('')
  }

  return (
    <div className="composer">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={disabled ? 'Open a session to start playing' : 'What do you do?'}
        rows={3}
        aria-label="Message to the Dungeon Master"
      />
      <div className="composer-bar">
        <select value={model} onChange={(e) => onModelChange(e.target.value)} aria-label="AI model">
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="muted hint">Enter to send, Shift+Enter for a new line</span>
        <button className="btn primary" onClick={submit} disabled={disabled || !text.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}
