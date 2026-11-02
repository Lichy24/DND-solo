import { useState } from 'react'
import { MAX_PARTY, type Character, type Session, type Tab } from '../types'
import { Avatar } from './Avatar'
import { Meter } from './Meter'
import { PencilIcon, TrashIcon } from './Icons'

interface Props {
  tab: Tab
  browsing: boolean
  sessions: Session[]
  activeSession: Session | null
  characters: Character[]
  onSelectSession: (id: string) => void
  onBrowse: () => void
  onNewSession: () => void
  onRenameSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onAddCharacter: (id: string) => void
  onRemoveCharacter: (id: string) => void
  onCreateCharacter: () => void
  onOpenSheet: (id: string) => void
}

function CharacterCard({ c, onSheet, onRemove }: { c: Character; onSheet: () => void; onRemove?: () => void }) {
  return (
    <li className="char">
      <Avatar name={c.name} src={c.avatarUrl} />
      <div className="char-body">
        <div className="char-head">
          <div className="char-name">
            <strong>{c.name}</strong>
            <span className="muted">
              {' '}
              {c.className} {c.level}
            </span>
          </div>
          <div className="char-actions">
            <button className="round-btn" onClick={onSheet} aria-label={`Open ${c.name}'s character sheet`} title="Character sheet">
              ?
            </button>
            {onRemove && (
              <button className="icon-btn danger" onClick={onRemove} aria-label={`Remove ${c.name} from party`}>
                ×
              </button>
            )}
          </div>
        </div>
        <Meter kind="hp" label="HP" current={c.hp.current} max={c.hp.max} />
        {c.resource && <Meter kind="res" label={c.resource.label} current={c.resource.current} max={c.resource.max} />}
      </div>
    </li>
  )
}

function SessionList({ sessions, activeId, onSelect, onNew, onRename, onDelete }: {
  sessions: Session[]
  activeId: string | undefined
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <>
      <header className="panel-head">
        <h2>Open sessions</h2>
      </header>
      <ul className="list">
        {sessions.map((s) => (
          <li key={s.id} className="session-row">
            <button className={`row ${s.id === activeId ? 'is-active' : ''}`} onClick={() => onSelect(s.id)}>
              <strong>{s.title}</strong>
              <span className="muted">
                {s.characterIds.length}/{MAX_PARTY} heroes · {new Date(s.updatedAt).toLocaleDateString()}
              </span>
            </button>
            <div className="row-actions">
              <button className="icon-btn" onClick={() => onRename(s.id)} aria-label={`Rename ${s.title}`} title="Rename">
                <PencilIcon />
              </button>
              <button className="icon-btn danger" onClick={() => onDelete(s.id)} aria-label={`Delete ${s.title}`} title="Delete">
                <TrashIcon />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <footer className="panel-foot">
        <button className="btn primary" onClick={onNew}>
          Start new session
        </button>
      </footer>
    </>
  )
}

function Party({ session, characters, onBack, onAdd, onRemove, onCreate, onSheet }: {
  session: Session
  characters: Character[]
  onBack: () => void
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  onCreate: () => void
  onSheet: (id: string) => void
}) {
  const [pick, setPick] = useState('')
  const party = session.characterIds
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is Character => !!c)
  const available = characters.filter((c) => !session.characterIds.includes(c.id))
  const full = party.length >= MAX_PARTY

  return (
    <>
      <header className="panel-head">
        <button className="link" onClick={onBack}>
          ‹ Sessions
        </button>
        <h2>
          Party {party.length}/{MAX_PARTY}
        </h2>
      </header>
      <ul className="list">
        {party.map((c) => (
          <CharacterCard key={c.id} c={c} onSheet={() => onSheet(c.id)} onRemove={() => onRemove(c.id)} />
        ))}
        {Array.from({ length: MAX_PARTY - party.length }, (_, i) => (
          <li key={`empty-${i}`} className="char empty">
            Empty slot
          </li>
        ))}
      </ul>
      <footer className="panel-foot">
        <div className="add-row">
          <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={full || !available.length} aria-label="Existing character">
            <option value="">{available.length ? 'Choose a character' : 'No other characters'}</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.className} {c.level}
              </option>
            ))}
          </select>
          <button
            className="btn"
            disabled={!pick || full}
            onClick={() => {
              onAdd(pick)
              setPick('')
            }}
          >
            Add
          </button>
        </div>
        <button className="btn primary" onClick={onCreate}>
          Create new character
        </button>
      </footer>
    </>
  )
}

export function ContextPanel(p: Props) {
  return (
    <section className="context" aria-live="polite">
      {p.tab === 'characters' ? (
        <>
          <header className="panel-head">
            <h2>Your characters</h2>
          </header>
          <ul className="list">
            {p.characters.map((c) => (
              <CharacterCard key={c.id} c={c} onSheet={() => p.onOpenSheet(c.id)} />
            ))}
          </ul>
          <footer className="panel-foot">
            <button className="btn primary" onClick={p.onCreateCharacter}>
              Create new character
            </button>
          </footer>
        </>
      ) : p.browsing || !p.activeSession ? (
        <SessionList
          sessions={p.sessions}
          activeId={p.activeSession?.id}
          onSelect={p.onSelectSession}
          onNew={p.onNewSession}
          onRename={p.onRenameSession}
          onDelete={p.onDeleteSession}
        />
      ) : (
        <Party
          session={p.activeSession}
          characters={p.characters}
          onBack={p.onBrowse}
          onAdd={p.onAddCharacter}
          onRemove={p.onRemoveCharacter}
          onCreate={p.onCreateCharacter}
          onSheet={p.onOpenSheet}
        />
      )}
    </section>
  )
}
