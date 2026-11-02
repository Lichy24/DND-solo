import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { ApiError, createClient } from '../api'
import { loadStoredUser } from '../auth'
import {
  ABILITIES, EXTENDED_FIELDS, FIELD_LABELS, REQUIRED, check, emptyForm, fileToAvatar, formFromCharacter,
  modifier, notifyCharactersChanged, profBonus, signed, toPayload, type CreatorForm, type FieldId,
} from '../creator'
import { ALIGNMENTS, APPEARANCE_FIELDS, SKILLS, proficientBonus } from '../rules'
import { Avatar } from './Avatar'
import { DeathSavesBox } from './DeathSavesBox'

const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

/** The character sheet window (route /characters/new). With ?edit=<id> it edits that character instead. */
export function CharacterCreator() {
  // the main window passes ?user=<id> (and ?edit=<id>); fall back to the saved login
  const [{ userId, editId }] = useState(() => {
    const q = new URLSearchParams(window.location.search)
    return { userId: q.get('user') ?? loadStoredUser()?.id ?? null, editId: q.get('edit') }
  })
  const editing = editId !== null

  const [form, setForm] = useState<CreatorForm>(emptyForm)
  const [avatar, setAvatar] = useState<string | null>(null)
  const [extended, setExtended] = useState(false)
  const [touched, setTouched] = useState<Set<FieldId>>(new Set())
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(editing ? 'loading' : 'ready')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedName, setSavedName] = useState<string | null>(null)

  useEffect(() => {
    document.title = `${editing ? 'Edit character' : 'New character'} · Solo Tabletop`
  }, [editing])

  // edit mode: load the character and fill the sheet
  useEffect(() => {
    if (!userId || !editId) return
    let cancelled = false
    createClient(userId)
      .character(editId)
      .then((c) => {
        if (cancelled) return
        setForm(formFromCharacter(c))
        setAvatar(c.avatarUrl ?? null)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load the character.')
        setStatus('failed')
      })
    return () => {
      cancelled = true
    }
  }, [userId, editId])

  const { errors, missing } = check(form, editing)
  const level = Number(form.level)
  const dex = Number(form.dex)
  // a problem inside the extended part keeps it open, so it can never hide a blocked Apply
  const extendedHasError = EXTENDED_FIELDS.some((id) => errors[id])
  const extendedOpen = extended || extendedHasError

  const bind = (id: FieldId) => ({
    id,
    value: form[id],
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [id]: e.target.value })),
    onBlur: () => setTouched((t) => new Set(t).add(id)),
    'aria-invalid': touched.has(id) && !!errors[id],
    'aria-describedby': touched.has(id) && errors[id] ? `${id}-err` : undefined,
  })
  const err = (id: FieldId) =>
    touched.has(id) && errors[id] ? (
      <small id={`${id}-err`} className="cs-err">
        {errors[id]}
      </small>
    ) : null

  // plain render helper (not a component) so inputs keep focus while typing
  const field = (id: FieldId, o: { type?: 'text' | 'number'; min?: number; max?: number; className?: string; list?: string } = {}) => (
    <label className={`f ${o.className ?? ''}`}>
      <span className={REQUIRED.has(id) ? 'req' : ''}>{FIELD_LABELS[id]}</span>
      <input
        type={o.type ?? 'text'}
        min={o.min}
        max={o.max}
        list={o.list}
        inputMode={o.type === 'number' ? 'numeric' : undefined}
        autoComplete="off"
        {...bind(id)}
      />
      {err(id)}
    </label>
  )

  async function pickPortrait(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setAvatar(await fileToAvatar(file))
      setError(null)
    } catch (err2) {
      setError(err2 instanceof Error ? err2.message : 'Could not read that image.')
    }
  }

  async function apply(e: FormEvent) {
    e.preventDefault()
    if (!userId || busy || missing.length > 0) return
    setBusy(true)
    setError(null)
    try {
      const client = createClient(userId)
      const payload = toPayload(form, avatar, editing)
      const saved = editId ? await client.updateCharacter(editId, payload) : await client.createCharacter(payload)
      notifyCharactersChanged(userId, editing ? 'updated' : 'created')
      setSavedName(saved.name)
      window.setTimeout(() => window.close(), 1200) // works because the main window opened this one
    } catch (err2) {
      setError(
        err2 instanceof ApiError && err2.status === 401
          ? 'You are logged out. Log in again in the main window, then reopen this sheet.'
          : err2 instanceof Error ? err2.message : 'Could not save the character.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (!userId) {
    return (
      <main className="creator">
        <div className="cs">
          <h1>Character sheet</h1>
          <p>You are not logged in. Log in in the main window, then open the character sheet again.</p>
          <button className="btn" onClick={() => window.close()}>
            Close
          </button>
        </div>
      </main>
    )
  }

  if (status !== 'ready') {
    return (
      <main className="creator">
        <div className="cs">
          {status === 'loading' ? (
            <p className="muted">Loading character…</p>
          ) : (
            <>
              <p className="login-error" role="alert">
                {error}
              </p>
              <button className="btn" onClick={() => window.close()}>
                Close
              </button>
            </>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="creator">
      <form className="cs" onSubmit={apply} noValidate>
        <p className="cs-kicker">{editing ? 'Edit character' : 'New character'}</p>
        <header className="cs-head">
          <div className="cs-portrait">
            <Avatar name={form.name || 'New character'} src={avatar ?? undefined} size={96} />
            <label className="btn small">
              Choose portrait
              <input type="file" accept="image/*" hidden onChange={pickPortrait} />
            </label>
            {avatar && (
              <button type="button" className="link" onClick={() => setAvatar(null)}>
                Remove
              </button>
            )}
          </div>
          <div className="cs-title">
            <label className="f cs-name">
              <span className="req">{FIELD_LABELS.name}</span>
              <input type="text" maxLength={50} autoFocus autoComplete="off" {...bind('name')} />
              {err('name')}
            </label>
            <div className="cs-basics">
              {field('className')}
              {field('level', { type: 'number', min: 1, max: 20 })}
              {field('race')}
              {field('background')}
              {field('alignment', { list: 'alignments' })}
              {field('experience', { type: 'number', min: 0, max: 9999999 })}
            </div>
            <datalist id="alignments">
              {ALIGNMENTS.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
        </header>

        <div className="cs-grid">
          <section className="cs-abilities" aria-label="Ability scores">
            {ABILITIES.map((a) => (
              <div className="ability-box" key={a.key}>
                <label htmlFor={a.key} className="req">
                  {a.label}
                </label>
                <input type="number" min={1} max={30} inputMode="numeric" {...bind(a.key)} />
                <span className="ability-mod" aria-label={`${a.label} modifier`}>
                  {errors[a.key] ? '–' : signed(modifier(Number(form[a.key])))}
                </span>
                {err(a.key)}
              </div>
            ))}
          </section>

          <section className="cs-combat" aria-label="Combat">
            {field('ac', { type: 'number', min: 0, max: 40 })}
            <div className="f">
              <span>Initiative</span>
              <output className="cs-calc">{errors.dex ? '–' : signed(modifier(dex))}</output>
            </div>
            {field('speed', { type: 'number', min: 0, max: 200 })}
            <div className="f">
              <span>Proficiency bonus</span>
              <output className="cs-calc">{errors.level ? '–' : signed(profBonus(level))}</output>
            </div>
            {field('hpMax', { type: 'number', min: 1, max: 999, className: editing ? '' : 'wide' })}
            {editing && field('hpCurrent', { type: 'number', min: 0, max: 999 })}
            <DeathSavesBox className="wide" value={form.deathSaves} onChange={(deathSaves) => setForm((f) => ({ ...f, deathSaves }))} />
            <fieldset className="cs-resource wide">
              <legend>Class resource (optional)</legend>
              <p className="muted">Spell slots, ki, rage, bardic inspiration…</p>
              <div className={`cs-resource-row ${editing ? 'three' : ''}`}>
                {field('resourceLabel')}
                {field('resourceMax', { type: 'number', min: 1, max: 99 })}
                {editing && field('resourceCurrent', { type: 'number', min: 0, max: 99 })}
              </div>
            </fieldset>
          </section>

          <section className="cs-lists" aria-label="Features and equipment">
            <label className="f">
              <span>Features &amp; Traits (one per line)</span>
              <textarea rows={8} {...bind('features')} />
              {err('features')}
            </label>
            <label className="f">
              <span>Equipment (one per line)</span>
              <textarea rows={8} {...bind('equipment')} />
              {err('equipment')}
            </label>
          </section>
        </div>

        <div className="cs-extend-bar">
          <button
            type="button"
            className="btn"
            aria-expanded={extendedOpen}
            aria-controls="cs-extended"
            disabled={extendedHasError}
            title={extendedHasError ? 'Fix the highlighted fields first' : undefined}
            onClick={() => setExtended((e) => !e)}
          >
            {extendedOpen ? 'Collapse sheet' : 'Extend sheet'}
          </button>
          <span className="muted">Saving throws, skills, other proficiencies &amp; languages, appearance</span>
        </div>

        {extendedOpen && (
          <div id="cs-extended" className="cs-ext">
            <div className="cs-ext-grid">
              <section>
                <h3>Saving throws</h3>
                <div className="check-list">
                  {ABILITIES.map((a) => {
                    const on = form.savingThrows.includes(a.key)
                    return (
                      <label key={a.key} className="check-row">
                        <input type="checkbox" checked={on} onChange={() => setForm((f) => ({ ...f, savingThrows: toggle(f.savingThrows, a.key) }))} />
                        <span className="bonus">{errors[a.key] || errors.level ? '–' : signed(proficientBonus(Number(form[a.key]), on, level))}</span>
                        <span>{a.label}</span>
                      </label>
                    )
                  })}
                </div>
                <label className="f ext-prof">
                  <span>{FIELD_LABELS.proficiencies} (one per line)</span>
                  <textarea rows={7} {...bind('proficiencies')} />
                  {err('proficiencies')}
                </label>
              </section>
              <section>
                <h3>Skills</h3>
                <div className="check-list">
                  {SKILLS.map((s) => {
                    const on = form.skills.includes(s.key)
                    return (
                      <label key={s.key} className="check-row">
                        <input type="checkbox" checked={on} onChange={() => setForm((f) => ({ ...f, skills: toggle(f.skills, s.key) }))} />
                        <span className="bonus">{errors[s.ability] || errors.level ? '–' : signed(proficientBonus(Number(form[s.ability]), on, level))}</span>
                        <span>
                          {s.label} <span className="muted">({s.ability.toUpperCase()})</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </section>
            </div>
            <section>
              <h3>Appearance</h3>
              <div className="cs-appearance">{APPEARANCE_FIELDS.map((a) => <span key={a.key}>{field(a.key)}</span>)}</div>
            </section>
            <label className="f">
              <span>{FIELD_LABELS.backstory}</span>
              <textarea rows={6} {...bind('backstory')} />
              {err('backstory')}
            </label>
          </div>
        )}

        <footer className="cs-foot">
          {missing.length > 0 && (
            <p id="cs-missing" className="muted">
              Still needed: {missing.join(', ')}
            </p>
          )}
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <div className="cs-actions">
            <button type="button" className="btn" onClick={() => window.close()}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy || missing.length > 0} aria-describedby="cs-missing">
              {busy ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </footer>

        {savedName && (
          <div className="cs-saved" role="status">
            <strong>{savedName}</strong>&nbsp;was {editing ? 'updated' : 'saved'}. This window will close; if it stays open, you can close it now.
          </div>
        )}
      </form>
    </main>
  )
}
