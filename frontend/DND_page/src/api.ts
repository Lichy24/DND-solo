import { asArray, docId, normalizeCharacter, normalizeMessage, normalizeSession, normalizeUser } from './normalize'
import type { Character, ChatReply, ChatRequest, DeathSaves, Message, ModelOption, NewCharacter, Role, Session, User } from './types'

const BASE = '/api' // proxied to FastAPI by vite.config.ts

export class ApiError extends Error {
  constructor(
    readonly status: number, // 0 = could not reach the server
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}, userId?: string): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (userId) headers.set('X-User-Id', userId) // tells the server who is asking

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is it running?')
  }
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { detail?: unknown } // FastAPI error shape
      if (typeof body.detail === 'string') detail = body.detail
      else if (Array.isArray(body.detail)) {
        // FastAPI validation errors: [{ loc: ['body', 'abilities'], msg: '...' }]
        detail = body.detail
          .slice(0, 3)
          .map((d) => {
            const x = d as { loc?: unknown[]; msg?: string }
            const where = Array.isArray(x.loc) ? x.loc.filter((p) => p !== 'body').join('.') : ''
            return where ? `${where}: ${x.msg}` : String(x.msg ?? '')
          })
          .join('; ')
      }
    } catch {
      /* body was not JSON */
    }
    throw new ApiError(res.status, detail || `${init.method ?? 'GET'} ${path} failed (${res.status})`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

const json = (method: 'POST' | 'PUT' | 'PATCH', body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

/* ---------- before login ---------- */
export const usersApi = {
  // GET /api/users -> [{ id, name }]
  async list(): Promise<User[]> {
    return asArray(await request<unknown>('/users')).map(normalizeUser).filter((u) => u.id)
  },
  // POST /api/users { name } -> { id, name }   (server assigns the id)
  async create(name: string): Promise<User> {
    const user = normalizeUser(await request<unknown>('/users', json('POST', { name })))
    if (!user.id) throw new ApiError(500, 'Server did not return a user id.')
    return user
  },
}

/* ---------- after login: every call carries the user id ---------- */
export function createClient(userId: string) {
  const call = <T>(path: string, init?: RequestInit) => request<T>(path, init, userId)

  return {
    // GET /api/characters
    async characters(): Promise<Character[]> {
      return asArray(await call<unknown>('/characters')).map(normalizeCharacter)
    },
    // POST /api/create_character -> the saved character (with its new id)
    async createCharacter(c: NewCharacter): Promise<Character> {
      return normalizeCharacter(await call<unknown>('/create_character', json('POST', c)))
    },
    // GET /api/characters/{id}
    async character(id: string): Promise<Character> {
      return normalizeCharacter(await call<unknown>(`/characters/${encodeURIComponent(id)}`))
    },
    // PUT /api/characters/{id}  (same body as create) -> the saved character
    async updateCharacter(id: string, c: NewCharacter): Promise<Character> {
      return normalizeCharacter(await call<unknown>(`/characters/${encodeURIComponent(id)}`, json('PUT', c)))
    },
    // PUT /api/characters/{id}/death-saves { successes, failures }  (the dots on the sheet)
    async saveDeathSaves(id: string, saves: DeathSaves): Promise<void> {
      await call<unknown>(`/characters/${encodeURIComponent(id)}/death-saves`, json('PUT', saves))
    },
    // DELETE /api/characters/{id} -> 204
    async deleteCharacter(id: string): Promise<void> {
      await call<void>(`/characters/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    // PATCH /api/sessions/{id} { name } -> session
    async renameSession(id: string, name: string): Promise<Session> {
      return normalizeSession(await call<unknown>(`/sessions/${encodeURIComponent(id)}`, json('PATCH', { name })))
    },
    // DELETE /api/sessions/{id} -> 204
    async deleteSession(id: string): Promise<void> {
      await call<void>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    // GET /api/sessions
    async sessions(): Promise<Session[]> {
      return asArray(await call<unknown>('/sessions')).map(normalizeSession)
    },
    // GET /api/models -> [{ id, label }]
    async models(): Promise<ModelOption[]> {
      return asArray(await call<unknown>('/models'))
        .map((m) => {
          const o = m as Partial<ModelOption>
          return { id: docId(o.id), label: String(o.label ?? o.id ?? '') }
        })
        .filter((m) => m.id)
    },
    // POST /api/sessions { name } -> session
    async createSession(name: string): Promise<Session> {
      return normalizeSession(await call<unknown>('/sessions', json('POST', { name })))
    },
    // PUT /api/sessions/{id}/party { members } -> session
    async saveParty(sessionId: string, characterIds: string[]): Promise<Session> {
      return normalizeSession(await call<unknown>(`/sessions/${encodeURIComponent(sessionId)}/party`, json('PUT', { members: characterIds })))
    },
    // GET /api/sessions/{id}/messages
    async messages(sessionId: string): Promise<Message[]> {
      return asArray(await call<unknown>(`/sessions/${encodeURIComponent(sessionId)}/messages`)).map(normalizeMessage)
    },
    // POST /api/sessions/{id}/messages { role, text }   (used to keep dice rolls in the history)
    async saveMessage(sessionId: string, role: Role, text: string): Promise<Message> {
      return normalizeMessage(await call<unknown>(`/sessions/${encodeURIComponent(sessionId)}/messages`, json('POST', { role, text })))
    },
    // POST /api/prompt { session_id, prompt_id, prompt, user_id, model_id } -> { reply }
    // The server stores both the player's message and the DM's reply.
    async chat(req: ChatRequest): Promise<ChatReply> {
      const raw = await call<unknown>(
        '/prompt',
        json('POST', { session_id: req.sessionId, prompt_id: req.promptId, prompt: req.prompt, user_id: userId, model_id: req.model }),
      )
      const body = (typeof raw === 'object' && raw !== null ? raw : {}) as { reply?: unknown; createdCharacterId?: unknown }
      const reply = typeof raw === 'string' ? raw : String(body.reply ?? '')
      if (!reply) throw new ApiError(502, 'The DM sent an empty answer.')
      return { reply, createdCharacterId: typeof body.createdCharacterId === 'string' ? body.createdCharacterId : undefined }
    },
  }
}

export type Client = ReturnType<typeof createClient>
