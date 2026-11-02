import type { Abilities, Character, Resource, Session } from './types'

/**
 * Turns whatever the backend (FastAPI + NoSQL) sends into the shape the UI expects.
 * Missing or oddly named fields get safe defaults, so a half-filled character document
 * can never crash the sheet. If your documents use other field names, add them to the
 * alias lists below; nothing else in the app needs to change.
 */
type Raw = Record<string, unknown>

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, d = ''): string => (typeof v === 'string' && v.trim() ? v : d)
const num = (v: unknown, d: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}
const first = (o: Raw, keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null)

/** Mongo-style ids: "abc", or { $oid: "abc" } */
export function docId(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (isObj(v) && typeof v.$oid === 'string') return v.$oid
  return ''
}

/** Accepts [..] or { items: [..] } */
export function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (isObj(raw) && Array.isArray(raw.items)) return raw.items
  return []
}

const ABILITY_ALIASES: Record<keyof Abilities, string[]> = {
  str: ['str', 'strength'],
  dex: ['dex', 'dexterity'],
  con: ['con', 'constitution'],
  int: ['int', 'intelligence'],
  wis: ['wis', 'wisdom'],
  cha: ['cha', 'charisma'],
}

function toAbilities(v: unknown): Abilities {
  const src = isObj(v) ? v : {}
  const out = {} as Abilities
  for (const k of Object.keys(ABILITY_ALIASES) as (keyof Abilities)[]) {
    out[k] = num(first(src, ABILITY_ALIASES[k]), 10)
  }
  return out
}

// ["Longsword"] or [{ name: "Handaxe", quantity: 2 }]
function toList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((item) => {
      if (typeof item === 'string') return item
      if (isObj(item) && typeof item.name === 'string') {
        const qty = num(item.quantity ?? item.qty, 1)
        return qty > 1 ? `${item.name} ×${qty}` : item.name
      }
      return ''
    })
    .filter(Boolean)
}

function toResource(v: unknown): Resource | null {
  if (!isObj(v)) return null
  const max = Math.max(1, num(v.max, 1))
  return { label: str(first(v, ['label', 'name']), 'Resource'), current: Math.min(num(v.current, max), max), max }
}

export function normalizeCharacter(doc: unknown): Character {
  const d = isObj(doc) ? doc : {}
  const hpDoc = isObj(d.hp) ? d.hp : {}
  const maxHp = Math.max(1, num(first(hpDoc, ['max']) ?? first(d, ['hp_max', 'hpMax', 'max_hp', 'maxHp']), 1))
  const curHp = num(first(hpDoc, ['current']) ?? first(d, ['hp_current', 'hpCurrent', 'current_hp', 'currentHp']), maxHp)
  const avatar = str(first(d, ['avatarUrl', 'avatar_url', 'portrait', 'portrait_url']))

  return {
    id: docId(first(d, ['id', '_id'])),
    name: str(d.name, 'Unnamed hero'),
    race: str(first(d, ['race', 'species']), 'Unknown'),
    className: str(first(d, ['className', 'class_name', 'class', 'character_class']), 'Adventurer'),
    level: Math.max(1, num(d.level, 1)),
    ac: num(first(d, ['ac', 'armor_class', 'armorClass']), 10),
    speed: num(d.speed, 30),
    abilities: toAbilities(first(d, ['abilities', 'ability_scores', 'abilityScores'])),
    features: toList(first(d, ['features', 'traits'])),
    equipment: toList(first(d, ['equipment', 'inventory'])),
    avatarUrl: avatar || undefined,
    hp: { current: Math.min(Math.max(0, curHp), maxHp), max: maxHp },
    resource: toResource(d.resource),
  }
}

export function normalizeSession(doc: unknown): Session {
  const d = isObj(doc) ? doc : {}
  const when = first(d, ['updatedAt', 'updated_at'])
  const ts = typeof when === 'number' ? when : typeof when === 'string' ? Date.parse(when) : NaN
  const ids = first(d, ['characterIds', 'character_ids', 'party'])
  return {
    id: docId(first(d, ['id', '_id'])),
    title: str(d.title, 'Untitled session'),
    updatedAt: Number.isFinite(ts) ? ts : Date.now(),
    characterIds: Array.isArray(ids) ? ids.map(docId).filter(Boolean) : [],
  }
}
