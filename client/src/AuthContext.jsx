import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  // Restore session from the HttpOnly cookie via the server (no localStorage).
  useEffect(() => {
    let cancelled = false
    // Without a timeout, a hung proxy/API/DB connection can leave the SPA on "טוען…" forever.
    const failsafeMs = 12_000
    const failsafe = window.setTimeout(() => {
      if (!cancelled) setReady(true)
    }, failsafeMs)

    api
      .get('/auth/me', { timeout: 10_000 })
      .then((res) => {
        const email = res.data?.email
        if (!cancelled && email) {
          setUser({ email: String(email).trim().toLowerCase() })
        }
      })
      .catch(() => {
        /* not logged in, expired cookie, network error, or timeout */
      })
      .finally(() => {
        window.clearTimeout(failsafe)
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
      window.clearTimeout(failsafe)
    }
  }, [])

  const login = useCallback(async (email, password) => {
    const body = new URLSearchParams()
    body.set('username', email.trim())
    body.set('password', password)

    await api.post('/auth/login', body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 25_000,
    })

    const normalizedEmail = email.trim().toLowerCase()
    const nextUser = { email: normalizedEmail }
    setUser(nextUser)
    return nextUser
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {}, { timeout: 10_000 })
    } catch {
      /* still clear local UI state */
    }
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
