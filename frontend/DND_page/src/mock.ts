import type { Character, ModelOption, Session } from './types'

// Replace with GET /api/characters, /api/sessions, /api/models once FastAPI is ready.
export const mockCharacters: Character[] = [
  {
    id: 'c1', name: 'Brynn Ashvale', race: 'Human', className: 'Fighter', level: 5, ac: 18, speed: 30,
    hp: { current: 38, max: 49 }, resource: { label: 'Second Wind', current: 1, max: 1 },
    abilities: { str: 17, dex: 12, con: 16, int: 10, wis: 11, cha: 9 },
    features: ['Fighting Style: Defense', 'Second Wind', 'Action Surge', 'Martial Archetype: Champion'],
    equipment: ['Longsword', 'Shield', 'Chain mail', 'Handaxe ×2'],
  },
  {
    id: 'c2', name: 'Ilyra Voss', race: 'Elf', className: 'Wizard', level: 5, ac: 13, speed: 30,
    hp: { current: 17, max: 27 }, resource: { label: 'Spell slots', current: 5, max: 9 },
    abilities: { str: 8, dex: 14, con: 13, int: 17, wis: 12, cha: 10 },
    features: ['Arcane Recovery', 'Spellcasting', 'Arcane Tradition: Evocation', 'Sculpt Spells'],
    equipment: ['Quarterstaff', 'Spellbook', 'Component pouch', 'Dagger'],
  },
  {
    id: 'c3', name: 'Tomas Reed', race: 'Wood elf', className: 'Monk', level: 4, ac: 16, speed: 40,
    hp: { current: 31, max: 31 }, resource: { label: 'Ki', current: 3, max: 4 },
    abilities: { str: 10, dex: 17, con: 14, int: 10, wis: 16, cha: 8 },
    features: ['Martial Arts', 'Ki', 'Unarmored Movement', 'Deflect Missiles', 'Slow Fall'],
    equipment: ['Quarterstaff', 'Darts ×10', "Explorer's pack"],
  },
  {
    id: 'c4', name: 'Sister Maren', race: 'Dwarf', className: 'Cleric', level: 5, ac: 18, speed: 25,
    hp: { current: 9, max: 36 }, resource: { label: 'Spell slots', current: 6, max: 9 },
    abilities: { str: 14, dex: 10, con: 15, int: 10, wis: 17, cha: 12 },
    features: ['Spellcasting', 'Channel Divinity', 'Divine Domain: Life', 'Destroy Undead'],
    equipment: ['Mace', 'Shield', 'Holy symbol', 'Scale mail'],
  },
  {
    id: 'c5', name: 'Pip Underbough', race: 'Halfling', className: 'Rogue', level: 3, ac: 14, speed: 25,
    hp: { current: 21, max: 21 }, resource: null,
    abilities: { str: 8, dex: 17, con: 12, int: 13, wis: 10, cha: 14 },
    features: ['Sneak Attack', 'Expertise', 'Cunning Action', "Thieves' Cant"],
    equipment: ['Shortsword', 'Shortbow', "Thieves' tools", 'Leather armor'],
  },
]

export const mockSessions: Session[] = [
  { id: 's1', title: 'The Sunken Chapel', updatedAt: Date.now() - 3_600_000, characterIds: ['c1', 'c2'] },
  { id: 's2', title: 'Ashvale Road ambush', updatedAt: Date.now() - 86_400_000 * 3, characterIds: ['c3'] },
]

export const mockModels: ModelOption[] = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { id: 'local-llama', label: 'Local Llama' },
]
