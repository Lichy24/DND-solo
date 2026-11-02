import { useEffect, useRef, useState } from 'react'
import type { Character, DeathSaves } from '../types'
import { ABILITIES, APPEARANCE_FIELDS, SKILLS, modifier, profBonus, proficientBonus, signed } from '../rules'
import { Avatar } from './Avatar'
import { DeathSavesBox } from './DeathSavesBox'
import { Meter } from './Meter'

const Dot = ({ on }: { on: boolean }) => (
  <>
    <span className={`pdot ${on ? 'on' : ''}`} aria-hidden="true" />
    {on && <span className="sr-only">proficient</span>}
  </>
)

export function CharacterSheet({ character: c, onClose, onEdit, onDelete, onDeathSaves }: {
  character: Character
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onDeathSaves: (saves: DeathSaves) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [extended, setExtended] = useState(false)

  // native <dialog>: focus trap + Esc handling for free
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  const prof = profBonus(c.level)
  const details = [c.background, c.alignment, `${c.experience.toLocaleString()} XP`].filter(Boolean).join(' · ')

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose() // click on the backdrop
      }}
    >
      <div className="sheet-body">
        <header className="sheet-head">
          <Avatar name={c.name} src={c.avatarUrl} size={72} />
          <div>
            <h2 id="sheet-title">{c.name}</h2>
            <p className="muted">
              {c.race} {c.className}, level {c.level}
            </p>
            <p className="muted">{details}</p>
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="stat-strip">
          <div><strong>{c.ac}</strong><span>Armor class</span></div>
          <div><strong>{signed(modifier(c.abilities.dex))}</strong><span>Initiative</span></div>
          <div><strong>{c.speed} ft</strong><span>Speed</span></div>
          <div><strong>{signed(prof)}</strong><span>Proficiency</span></div>
        </div>

        <div className="sheet-bars">
          <Meter kind="hp" label="HP" current={c.hp.current} max={c.hp.max} />
          {c.resource && <Meter kind="res" label={c.resource.label} current={c.resource.current} max={c.resource.max} />}
        </div>

        <DeathSavesBox value={c.deathSaves} onChange={onDeathSaves} />

        <ul className="abilities">
          {ABILITIES.map(({ key, label }) => (
            <li key={key}>
              <span>{label}</span>
              <strong>{signed(modifier(c.abilities[key]))}</strong>
              <span className="muted">{c.abilities[key]}</span>
            </li>
          ))}
        </ul>

        <div className="sheet-cols">
          <section>
            <h3>Features &amp; Traits</h3>
            <ul>{c.features.map((f) => <li key={f}>{f}</li>)}</ul>
          </section>
          <section>
            <h3>Equipment</h3>
            <ul>{c.equipment.map((e) => <li key={e}>{e}</li>)}</ul>
          </section>
        </div>

        {extended && (
          <div id="sheet-extended" className="sheet-ext">
            <div className="sheet-cols">
              <section>
                <h3>Saving throws</h3>
                <ul className="prof-list">
                  {ABILITIES.map(({ key, label }) => {
                    const on = c.savingThrows.includes(key)
                    return (
                      <li key={key}>
                        <Dot on={on} />
                        <span className="bonus">{signed(proficientBonus(c.abilities[key], on, c.level))}</span>
                        <span>{label}</span>
                      </li>
                    )
                  })}
                </ul>
                <h3>Other proficiencies &amp; Languages</h3>
                {c.otherProficiencies.length ? (
                  <ul>{c.otherProficiencies.map((p) => <li key={p}>{p}</li>)}</ul>
                ) : (
                  <p className="muted">None listed.</p>
                )}
              </section>
              <section>
                <h3>Skills</h3>
                <ul className="prof-list">
                  {SKILLS.map((s) => {
                    const on = c.skills.includes(s.key)
                    return (
                      <li key={s.key}>
                        <Dot on={on} />
                        <span className="bonus">{signed(proficientBonus(c.abilities[s.ability], on, c.level))}</span>
                        <span>
                          {s.label} <span className="muted">({s.ability.toUpperCase()})</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            </div>
            <section>
              <h3>Appearance</h3>
              <dl className="appearance">
                {APPEARANCE_FIELDS.map((a) => (
                  <div key={a.key}>
                    <dt>{a.label}</dt>
                    <dd>{c.appearance[a.key] || '—'}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3>Backstory</h3>
              <p className="backstory">{c.backstory || '—'}</p>
            </section>
          </div>
        )}

        <footer className="sheet-foot">
          <button className="btn push" onClick={() => setExtended((e) => !e)} aria-expanded={extended} aria-controls="sheet-extended">
            {extended ? 'Collapse sheet' : 'Extend sheet'}
          </button>
          <button className="btn" onClick={onEdit}>
            Edit character
          </button>
          <button className="btn danger-outline" onClick={onDelete}>
            Delete character
          </button>
        </footer>
      </div>
    </dialog>
  )
}
