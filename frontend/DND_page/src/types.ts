export interface User {
  id: string
  name: string
}

export type Tab = 'chats' | 'characters'
export type Role = 'user' | 'dm' | 'system'

export interface Message {
  id: string
  role: Role
  text: string
  at: number
}

/** Second bar under HP: spell slots, ki, rage, bardic inspiration, etc. */
export interface Resource {
  label: string
  current: number
  max: number
}

export interface Abilities {
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
}

export type AbilityKey = keyof Abilities

export type SkillKey =
  | 'acrobatics' | 'animalHandling' | 'arcana' | 'athletics' | 'deception' | 'history'
  | 'insight' | 'intimidation' | 'investigation' | 'medicine' | 'nature' | 'perception'
  | 'performance' | 'persuasion' | 'religion' | 'sleightOfHand' | 'stealth' | 'survival'

export interface Appearance {
  age: string
  height: string
  weight: string
  eyes: string
  skin: string
  hair: string
}

/** 0 to 3 of each: the dots on the sheet */
export interface DeathSaves {
  successes: number
  failures: number
}

export interface Character {
  id: string
  name: string
  race: string
  className: string
  level: number
  background: string
  alignment: string
  experience: number
  appearance: Appearance
  savingThrows: AbilityKey[] // abilities the character is proficient in
  skills: SkillKey[] // skills the character is proficient in
  otherProficiencies: string[] // other proficiencies & languages
  deathSaves: DeathSaves
  backstory: string
  ac: number
  speed: number
  abilities: Abilities
  features: string[]
  equipment: string[]
  avatarUrl?: string // portrait; falls back to the shadow-figure placeholder
  hp: { current: number; max: number }
  resource: Resource | null // null for classes with nothing to track
}

export interface Session {
  id: string
  title: string
  updatedAt: number
  characterIds: string[] // max 6
}

export interface ModelOption {
  id: string
  label: string
}

export interface ChatRequest {
  sessionId: string
  promptId: string // id of the player's message, so the server stores it under the same id
  model: string // id from /api/models
  prompt: string
}
export interface ChatReply {
  reply: string
  createdCharacterId?: string // set when the chat message made a new character
}

export interface Roll {
  die: string
  value: number
}

export const MAX_PARTY = 6

/** What the character creator sends: a Character without the id (the server assigns it). */
export type NewCharacter = Omit<Character, 'id'>
