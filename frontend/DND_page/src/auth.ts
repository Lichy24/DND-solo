import type { User } from './types'

const KEY = 'solo-tabletop.user'

function parse(raw: string | null): User | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<User>
    return typeof v.id === 'string' && v.id && typeof v.name === 'string' ? { id: v.id, name: v.name } : null
  } catch {
    return null
  }
}

/** "Keep me logged in" -> localStorage (survives closing the browser). Otherwise sessionStorage (this tab only). */
export function storeUser(user: User, remember: boolean) {
  try {
    clearStoredUser()
    ;(remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(user))
  } catch {
    /* storage blocked (private mode etc.): the user just has to log in again next time */
  }
}

export function loadStoredUser(): User | null {
  try {
    return parse(localStorage.getItem(KEY)) ?? parse(sessionStorage.getItem(KEY))
  } catch {
    return null
  }
}

export function clearStoredUser() {
  try {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
