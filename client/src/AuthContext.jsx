import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api from './api.js'

const AuthContext = createContext(null)

const USER_KEY = 'user'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    const raw = localStorage.getItem(USER_KEY)
    if (token && raw) {
      try {
        setUser(JSON.parse(raw))
      } catch {
        localStorage.removeItem(USER_KEY)
        localStorage.removeItem('token')
      }
    }
    setReady(true)
  }, [])

  const login = useCallback(async (email, password) => {
    const body = new URLSearchParams()
    body.set('username', email.trim())
    body.set('password', password)

    const { data } = await api.post('/auth/login', body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const accessToken = data?.access_token
    if (!accessToken) {
      throw new Error('No access token in response')
    }

    const normalizedEmail = email.trim().toLowerCase()
    const nextUser = { email: normalizedEmail }

    localStorage.setItem('token', accessToken)
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
    setUser(nextUser)
    return nextUser
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem(USER_KEY)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      ready,
      login,
      logout,
      isAuthenticated: Boolean(user),
    }),
    [user, ready, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
