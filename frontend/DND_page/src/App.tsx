import { useState } from 'react'
import { clearStoredUser, loadStoredUser, storeUser } from './auth'
import type { User } from './types'
import { LoginPage } from './components/LoginPage'
import { Game } from './Game'
import { CharacterCreator } from './components/CharacterCreator'
import { CREATOR_PATH } from './creator'

/** First screen is the login page; once a user is chosen the game takes over. */
function Main() {
  const [user, setUser] = useState<User | null>(loadStoredUser)

  function login(u: User, remember: boolean) {
    storeUser(u, remember)
    setUser(u)
  }

  function logout() {
    clearStoredUser()
    setUser(null)
  }

  // key = user id, so every piece of game state is thrown away when someone else logs in
  return user ? <Game key={user.id} user={user} onLogout={logout} /> : <LoginPage onLogin={login} />
}

// /characters/new is the character sheet window; everything else is the normal app
export default function App() {
  return window.location.pathname === CREATOR_PATH ? <CharacterCreator /> : <Main />
}
