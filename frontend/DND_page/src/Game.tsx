import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, createClient } from './api'
import { MAX_PARTY, type Character, type DeathSaves, type Message, type ModelOption, type Roll, type Session, type Tab, type User } from './types'
import { NavBox } from './components/NavBox'
import { ContextPanel } from './components/ContextPanel'
import { ChatHistory, Composer } from './components/Chat'
import { DiceTray } from './components/DiceTray'
import { RollStage, type StageHandle } from './components/RollStage'
import { CharacterSheet } from './components/CharacterSheet'
import { NameDialog } from './components/NameDialog'
import { ConfirmDeleteDialog } from './components/ConfirmDeleteDialog'
import { CHANNEL, openCreator } from './creator'

type DialogState =
  | { kind: 'new-session' }
  | { kind: 'rename-session'; id: string; name: string }
  | { kind: 'delete-session'; id: string; name: string }
  | { kind: 'delete-character'; id: string; name: string }
  | null

const newMessage = (role: Message['role'], text: string): Message => ({
  id: crypto.randomUUID(),
  role,
  text,
  at: Date.now(),
})

export function Game({ user, onLogout }: { user: User; onLogout: () => void }) {
  const client = useMemo(() => createClient(user.id), [user.id])

  const [tab, setTab] = useState<Tab>('chats')
  const [browsing, setBrowsing] = useState(true) // true = session list, false = party
  const [sessions, setSessions] = useState<Session[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [model, setModel] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [pending, setPending] = useState(false)
  const [diceOpen, setDiceOpen] = useState(true)
  const [results, setResults] = useState<Record<string, number>>({})
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const stage = useRef<StageHandle>(null)

  const active = sessions.find((s) => s.id === activeId) ?? null
  const sheetChar = characters.find((c) => c.id === sheetId) ?? null
  const historyLoading = !!active && !(active.id in messages)

  // a 401 means the server no longer knows this user: send them back to the login page
  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 401) return onLogout()
    setNotice(err instanceof Error ? err.message : 'Something went wrong.')
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([client.sessions(), client.characters(), client.models()])
      .then(([s, c, m]) => {
        if (cancelled) return
        setSessions(s)
        setCharacters(c)
        setModels(m)
        setModel(m[0]?.id ?? '')
      })
      .catch((err: unknown) => {
        if (!cancelled) fail(err)
      })
    return () => {
      cancelled = true
    }
  }, [client])

  // the character sheet window tells us when it saved a character
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (e: MessageEvent) => {
      if (e.data?.type !== 'characters-changed' || e.data.userId !== user.id) return
      client.characters().then(setCharacters).catch(fail)
      if (e.data.kind === 'created') setTab('characters')
    }
    return () => channel.close()
  }, [client, user.id])

  const push = (sid: string, msg: Message) =>
    setMessages((m) => ({ ...m, [sid]: [...(m[sid] ?? []), msg] }))

  function selectSession(id: string) {
    setActiveId(id)
    setBrowsing(false)
    if (id in messages) return
    client
      .messages(id)
      .then((list) => setMessages((m) => ({ ...m, [id]: list })))
      .catch((err: unknown) => {
        setMessages((m) => ({ ...m, [id]: [] })) // stop the "loading" state
        fail(err)
      })
  }

  // Runs a server call that was started from a pop-up: a 401 logs out, any other error is
  // thrown back so the pop-up can show it.
  async function guarded(run: () => Promise<void>) {
    try {
      await run()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onLogout()
      throw err
    }
  }

  const createSession = (name: string) =>
    guarded(async () => {
      const s = await client.createSession(name)
      setSessions((all) => [s, ...all])
      setMessages((m) => ({ ...m, [s.id]: [] }))
      setActiveId(s.id)
      setBrowsing(false)
      setDialog(null)
    })

  const renameSession = (id: string, name: string) =>
    guarded(async () => {
      const s = await client.renameSession(id, name)
      setSessions((all) => all.map((x) => (x.id === id ? s : x)))
      setDialog(null)
    })

  const deleteSession = (id: string) =>
    guarded(async () => {
      await client.deleteSession(id)
      setSessions((all) => all.filter((x) => x.id !== id))
      setMessages((m) => {
        const next = { ...m }
        delete next[id]
        return next
      })
      if (activeId === id) {
        setActiveId(null)
        setBrowsing(true)
      }
      setDialog(null)
    })

  const deleteCharacter = (id: string) =>
    guarded(async () => {
      await client.deleteCharacter(id)
      setCharacters((all) => all.filter((c) => c.id !== id))
      setSessions((all) => all.map((s) => ({ ...s, characterIds: s.characterIds.filter((cid) => cid !== id) })))
      setSheetId(null)
      setDialog(null)
    })

  // dots on the sheet: show the change at once, save it, and undo it if the server says no
  async function saveDeathSaves(id: string, saves: DeathSaves) {
    const before = characters.find((c) => c.id === id)?.deathSaves
    const setSaves = (s: DeathSaves) => setCharacters((all) => all.map((c) => (c.id === id ? { ...c, deathSaves: s } : c)))
    setSaves(saves)
    try {
      await client.saveDeathSaves(id, saves)
    } catch (err) {
      if (before) setSaves(before)
      fail(err)
    }
  }

  function openSheetWindow(editId?: string) {
    if (!openCreator(user.id, editId)) setNotice('Your browser blocked the character sheet window. Allow pop-ups for this site and try again.')
  }

  // update the party right away, then save; undo if the server says no
  async function changeParty(sid: string, change: (ids: string[]) => string[]) {
    const before = sessions.find((s) => s.id === sid)
    if (!before) return
    const next = change(before.characterIds)
    if (next.length === before.characterIds.length && next.every((id, i) => id === before.characterIds[i])) return
    const setIds = (ids: string[]) =>
      setSessions((all) => all.map((s) => (s.id === sid ? { ...s, characterIds: ids } : s)))
    setIds(next)
    try {
      const saved = await client.saveParty(sid, next)
      setSessions((all) => all.map((s) => (s.id === sid ? saved : s)))
    } catch (err) {
      setIds(before.characterIds)
      fail(err)
    }
  }

  async function send(prompt: string) {
    if (!active) return
    const sid = active.id
    const mine = newMessage('user', prompt)
    push(sid, mine)
    setPending(true)
    try {
      const { reply, createdCharacterId } = await client.chat({ sessionId: sid, promptId: mine.id, model, prompt })
      push(sid, newMessage('dm', reply))
      // the DM just built a character from the chat: reload the list so it appears in the Characters tab
      if (createdCharacterId) client.characters().then(setCharacters).catch(fail)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onLogout()
      push(sid, newMessage('system', `The DM could not answer. ${err instanceof Error ? err.message : ''}`))
    } finally {
      setPending(false)
    }
  }

  // called when a die thrown on the centre stage lands
  function onResult({ die, value }: Roll) {
    setResults((r) => ({ ...r, [die]: value }))
    if (!active) return
    const text = `Rolled ${die}: ${value}`
    push(active.id, newMessage('system', text))
    client.saveMessage(active.id, 'system', text).catch(fail)
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Solo Tabletop</span>
        <span className="who">
          Playing as <strong>{user.name}</strong>
        </span>
        <button className="btn" onClick={onLogout}>
          Log out
        </button>
      </header>

      {notice && (
        <div className="load-error" role="alert">
          {notice}{' '}
          <button className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <aside className="left">
        <NavBox tab={tab} onChange={setTab} sessionCount={sessions.length} characterCount={characters.length} />
        <ContextPanel
          tab={tab}
          browsing={browsing}
          sessions={sessions}
          activeSession={active}
          characters={characters}
          onSelectSession={selectSession}
          onBrowse={() => setBrowsing(true)}
          onNewSession={() => setDialog({ kind: 'new-session' })}
          onRenameSession={(id) => {
            const s = sessions.find((x) => x.id === id)
            if (s) setDialog({ kind: 'rename-session', id, name: s.title })
          }}
          onDeleteSession={(id) => {
            const s = sessions.find((x) => x.id === id)
            if (s) setDialog({ kind: 'delete-session', id, name: s.title })
          }}
          onAddCharacter={(cid) =>
            active && changeParty(active.id, (ids) => (ids.includes(cid) || ids.length >= MAX_PARTY ? ids : [...ids, cid]))
          }
          onRemoveCharacter={(cid) => active && changeParty(active.id, (ids) => ids.filter((i) => i !== cid))}
          onCreateCharacter={() => openSheetWindow()}
          onOpenSheet={setSheetId}
        />
      </aside>

      <main className="center">
        <ChatHistory
          session={active}
          messages={active ? (messages[active.id] ?? []) : []}
          pending={pending}
          loading={historyLoading}
        />
        <Composer
          models={models}
          model={model}
          onModelChange={setModel}
          disabled={!active || pending || !model || historyLoading}
          onSend={send}
        />
      </main>

      <aside className={`right ${diceOpen ? 'open' : ''}`}>
        <button
          className="dice-toggle"
          onClick={() => setDiceOpen((o) => !o)}
          aria-expanded={diceOpen}
          aria-controls="dice-tray"
        >
          {diceOpen ? 'Close dice' : 'Dice'}
        </button>
        <div className="tray-slot">
          <DiceTray id="dice-tray" open={diceOpen} results={results} onRoll={(key) => stage.current?.roll(key)} />
        </div>
      </aside>

      <RollStage ref={stage} onResult={onResult} />
      {sheetChar && (
        <CharacterSheet
          character={sheetChar}
          onClose={() => setSheetId(null)}
          onEdit={() => {
            setSheetId(null)
            openSheetWindow(sheetChar.id)
          }}
          onDelete={() => setDialog({ kind: 'delete-character', id: sheetChar.id, name: sheetChar.name })}
          onDeathSaves={(saves) => saveDeathSaves(sheetChar.id, saves)}
        />
      )}

      {dialog?.kind === 'new-session' && (
        <NameDialog
          title="Name your adventure"
          label="Session name"
          placeholder="The Sunken Chapel"
          submitLabel="Create session"
          busyLabel="Creating…"
          onSubmit={createSession}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename-session' && (
        <NameDialog
          title="Rename session"
          label="Session name"
          initialName={dialog.name}
          submitLabel="Rename"
          busyLabel="Renaming…"
          onSubmit={(name) => renameSession(dialog.id, name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete-session' && (
        <ConfirmDeleteDialog
          title="Delete session?"
          detail={`“${dialog.name}” and its whole history will be permanently deleted.`}
          onConfirm={() => deleteSession(dialog.id)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete-character' && (
        <ConfirmDeleteDialog
          title="Delete character?"
          detail={`“${dialog.name}” will be permanently deleted and removed from every party.`}
          onConfirm={() => deleteCharacter(dialog.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
