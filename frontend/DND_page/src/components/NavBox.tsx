import type { Tab } from '../types'

interface Props {
  tab: Tab
  onChange: (t: Tab) => void
  sessionCount: number
  characterCount: number
}

export function NavBox({ tab, onChange, sessionCount, characterCount }: Props) {
  const items: { id: Tab; label: string; count: number }[] = [
    { id: 'chats', label: 'Chat history', count: sessionCount },
    { id: 'characters', label: 'Characters', count: characterCount },
  ]
  return (
    <nav className="navbox" role="tablist" aria-label="Sidebar sections">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={tab === it.id}
          className={`navtile ${tab === it.id ? 'is-active' : ''}`}
          onClick={() => onChange(it.id)}
        >
          <span className="navtile-count">{it.count}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  )
}
