import { ABILITIES, APPEARANCE_FIELDS, modifier, profBonus, signed } from './rules'
import type { AbilityKey, Appearance, Character, DeathSaves, NewCharacter, SkillKey } from './types'

export { ABILITIES, modifier, profBonus, signed }

export const CREATOR_PATH = '/characters/new'
export const CHANNEL = 'solo-tabletop' // BroadcastChannel shared by the main window and the creator window

/** Opens the character sheet in its own window (pass editId to edit an existing character).
 *  Returns null if the browser blocked the pop-up. */
export function openCreator(userId: string, editId?: string): Window | null {
  const params = new URLSearchParams({ user: userId })
  if (editId) params.set('edit', editId)
  const w = window.open(`${CREATOR_PATH}?${params}`, `solo-tabletop-creator-${editId ?? 'new'}`, 'popup=yes,width=1040,height=900')
  w?.focus()
  return w
}

/** Tells the main window to reload its character list. */
export function notifyCharactersChanged(userId: string, kind: 'created' | 'updated') {
  const ch = new BroadcastChannel(CHANNEL)
  ch.postMessage({ type: 'characters-changed', userId, kind })
  window.setTimeout(() => ch.close(), 500)
}

/* ------------------------------------------------------------------ form */
type AppearanceKey = keyof Appearance
export type FieldId =
  | 'name' | 'race' | 'className' | 'level' | 'background' | 'alignment' | 'experience'
  | AbilityKey
  | 'ac' | 'speed' | 'hpMax' | 'hpCurrent' | 'resourceLabel' | 'resourceMax' | 'resourceCurrent'
  | 'features' | 'equipment'
  | 'proficiencies' // other proficiencies & languages
  | 'backstory'
  | AppearanceKey

type TextForm = Record<FieldId, string>
/** Text boxes are kept as strings (so "empty" can be told apart from 0); the ticks and dots are real values. */
export interface CreatorForm extends TextForm {
  savingThrows: AbilityKey[]
  skills: SkillKey[]
  deathSaves: DeathSaves
}

export const FIELD_LABELS: Record<FieldId, string> = {
  name: 'Character name', race: 'Race', className: 'Class', level: 'Level',
  background: 'Background', alignment: 'Alignment', experience: 'Experience points',
  str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
  ac: 'Armor class', speed: 'Speed', hpMax: 'Max hit points', hpCurrent: 'Current hit points',
  resourceLabel: 'Resource name', resourceMax: 'Resource maximum', resourceCurrent: 'Current resource',
  features: 'Features & Traits', equipment: 'Equipment',
  proficiencies: 'Other proficiencies & Languages', backstory: 'Backstory',
  age: 'Age', height: 'Height', weight: 'Weight', eyes: 'Eyes', skin: 'Skin', hair: 'Hair',
}

// the order the fields appear on the sheet (used to list what is still missing)
const FIELD_ORDER: FieldId[] = [
  'name', 'className', 'level', 'race', 'background', 'alignment', 'experience',
  'str', 'dex', 'con', 'int', 'wis', 'cha',
  'ac', 'speed', 'hpMax', 'hpCurrent', 'resourceLabel', 'resourceMax', 'resourceCurrent',
  'features', 'equipment',
  'proficiencies', 'age', 'height', 'weight', 'eyes', 'skin', 'hair', 'backstory',
]

/** Fields that live in the extended part of the sheet. */
export const EXTENDED_FIELDS: FieldId[] = ['proficiencies', 'backstory', ...APPEARANCE_FIELDS.map((a) => a.key)]

/** Required fields get a * on the sheet (current HP is only shown, and only required, when editing).
 *  Everything else (background, alignment, experience, resource, lists, extended sheet) is optional. */
export const REQUIRED: ReadonlySet<FieldId> = new Set<FieldId>([
  'name', 'race', 'className', 'level', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'ac', 'speed', 'hpMax', 'hpCurrent',
])

export const emptyForm = (): CreatorForm => ({
  name: '', race: '', className: '', level: '1', background: '', alignment: '', experience: '0',
  str: '', dex: '', con: '', int: '', wis: '', cha: '',
  ac: '', speed: '30', hpMax: '', hpCurrent: '', resourceLabel: '', resourceMax: '', resourceCurrent: '',
  features: '', equipment: '', proficiencies: '', backstory: '',
  age: '', height: '', weight: '', eyes: '', skin: '', hair: '',
  savingThrows: [], skills: [], deathSaves: { successes: 0, failures: 0 },
})

/** Fills the sheet with an existing character (edit mode). */
export function formFromCharacter(c: Character): CreatorForm {
  const s = (n: number) => String(n)
  return {
    name: c.name, race: c.race, className: c.className, level: s(c.level),
    background: c.background, alignment: c.alignment, experience: s(c.experience),
    str: s(c.abilities.str), dex: s(c.abilities.dex), con: s(c.abilities.con),
    int: s(c.abilities.int), wis: s(c.abilities.wis), cha: s(c.abilities.cha),
    ac: s(c.ac), speed: s(c.speed), hpMax: s(c.hp.max), hpCurrent: s(c.hp.current),
    resourceLabel: c.resource?.label ?? '', resourceMax: c.resource ? s(c.resource.max) : '',
    resourceCurrent: c.resource ? s(c.resource.current) : '',
    features: c.features.join('\n'), equipment: c.equipment.join('\n'),
    proficiencies: c.otherProficiencies.join('\n'), backstory: c.backstory,
    age: c.appearance.age, height: c.appearance.height, weight: c.appearance.weight,
    eyes: c.appearance.eyes, skin: c.appearance.skin, hair: c.appearance.hair,
    savingThrows: [...c.savingThrows], skills: [...c.skills], deathSaves: { ...c.deathSaves },
  }
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
const squash = (s: string) => s.trim().replace(/\s+/g, ' ')

function intError(value: string, lo: number, hi: number, what: string): string | null {
  const t = value.trim()
  if (!t) return 'Required'
  if (!/^-?\d+$/.test(t)) return 'Whole numbers only'
  const n = Number(t)
  return n < lo || n > hi ? `${what} must be ${lo} to ${hi}` : null
}

const LIST_LIMITS = { features: 50, equipment: 100, proficiencies: 100 } as const

/** The empty-field checker: Apply stays disabled until `missing` is empty. */
export function check(f: CreatorForm, editing = false): { errors: Partial<Record<FieldId, string>>; missing: string[] } {
  const errors: Partial<Record<FieldId, string>> = {}
  const put = (id: FieldId, msg: string | null) => {
    if (msg) errors[id] = msg
  }
  const text = (id: FieldId, max: number) => {
    const t = squash(f[id])
    put(id, !t ? 'Required' : t.length > max ? `At most ${max} characters` : null)
  }
  const optionalText = (id: FieldId, max: number) => {
    if (squash(f[id]).length > max) errors[id] = `At most ${max} characters`
  }

  text('name', 50)
  text('race', 40)
  text('className', 40)
  put('level', intError(f.level, 1, 20, 'Level'))
  optionalText('background', 60)
  optionalText('alignment', 30)
  if (f.experience.trim()) put('experience', intError(f.experience, 0, 9_999_999, 'Experience'))
  for (const a of ABILITIES) put(a.key, intError(f[a.key], 1, 30, 'Score'))
  put('ac', intError(f.ac, 0, 40, 'Armor class'))
  put('speed', intError(f.speed, 0, 200, 'Speed'))
  put('hpMax', intError(f.hpMax, 1, 999, 'Hit points'))

  // the class resource is optional, but if you start it, it needs both a name and a maximum
  const hasResource = f.resourceLabel.trim() !== '' || f.resourceMax.trim() !== ''
  if (hasResource) {
    text('resourceLabel', 40)
    put('resourceMax', intError(f.resourceMax, 1, 99, 'Maximum'))
  }
  if (editing) {
    const hpMax = Number(f.hpMax.trim())
    put('hpCurrent', intError(f.hpCurrent, 0, !errors.hpMax && hpMax >= 1 ? hpMax : 999, 'Current HP'))
    // left blank = full
    if (hasResource && !errors.resourceMax && f.resourceCurrent.trim()) {
      put('resourceCurrent', intError(f.resourceCurrent, 0, Number(f.resourceMax.trim()), 'Current'))
    }
  }

  for (const id of ['features', 'equipment', 'proficiencies'] as const) {
    const l = lines(f[id])
    if (l.length > LIST_LIMITS[id]) errors[id] = 'Too many lines'
    else if (l.some((x) => x.length > 200)) errors[id] = 'Keep each line under 200 characters'
  }
  for (const a of APPEARANCE_FIELDS) optionalText(a.key, 30)
  if (f.backstory.trim().length > 4000) errors.backstory = 'At most 4000 characters'

  return { errors, missing: FIELD_ORDER.filter((id) => errors[id]).map((id) => FIELD_LABELS[id]) }
}

/** Only call once check() has no errors. */
export function toPayload(f: CreatorForm, avatar: string | null, editing = false): NewCharacter {
  const n = (id: FieldId) => Number(f[id].trim())
  const hp = n('hpMax')
  const resourceMax = n('resourceMax')
  return {
    name: squash(f.name),
    race: squash(f.race),
    className: squash(f.className),
    level: n('level'),
    background: squash(f.background),
    alignment: squash(f.alignment),
    experience: f.experience.trim() ? n('experience') : 0,
    ac: n('ac'),
    speed: n('speed'),
    abilities: { str: n('str'), dex: n('dex'), con: n('con'), int: n('int'), wis: n('wis'), cha: n('cha') },
    features: lines(f.features),
    equipment: lines(f.equipment),
    avatarUrl: avatar ?? undefined,
    // a new character starts at full health and full resources; when editing, keep what the player typed
    hp: { current: editing ? n('hpCurrent') : hp, max: hp },
    resource: f.resourceLabel.trim()
      ? { label: squash(f.resourceLabel), current: editing && f.resourceCurrent.trim() ? n('resourceCurrent') : resourceMax, max: resourceMax }
      : null,
    appearance: {
      age: squash(f.age), height: squash(f.height), weight: squash(f.weight),
      eyes: squash(f.eyes), skin: squash(f.skin), hair: squash(f.hair),
    },
    savingThrows: f.savingThrows,
    skills: f.skills,
    otherProficiencies: lines(f.proficiencies),
    deathSaves: f.deathSaves,
    backstory: f.backstory.trim(),
  }
}

/** Crops the picked image to a square and shrinks it to 256px, so it is small enough to store with the character. */
export async function fileToAvatar(file: File, size = 256): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.')
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process the image.')
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size)
  bmp.close()
  return canvas.toDataURL('image/jpeg', 0.85)
}
