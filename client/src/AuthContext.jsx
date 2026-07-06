import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import api from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [credits, setCredits] = useState(null)
  const sessionFetchIdRef = useRef(0)

  // Restore session from the HttpOnly cookie via the server (no localStorage).
  useEffect(() => {
    const fetchId = ++sessionFetchIdRef.current
    const ac = new AbortController()
    let failsafe = 0
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(failsafe)
      // Always unblock the shell (idempotent). Strict Mode double-mount + abort can
      // otherwise leave "טוען…" if a stale request's `finally` skipped `setReady`.
      setReady(true)
    }

    // Without a timeout, a hung proxy/API/DB connection can leave the SPA on "טוען…" forever.
    const failsafeMs = 12_000
    failsafe = window.setTimeout(finish, failsafeMs)

    api
      .get('/auth/me', { timeout: 10_000, signal: ac.signal })
      .then((res) => {
        const email = res.data?.email
        if (sessionFetchIdRef.current !== fetchId) return
        if (email) {
          setUser({
            email: String(email).trim().toLowerCase(),
            isSuperuser: Boolean(res.data?.is_superuser),
            isPrimaryAdmin: Boolean(res.data?.is_primary_admin),
          })
          if (typeof res.data?.credits_balance === 'number') {
            setCredits(res.data.credits_balance)
          }
        }
      })
      .catch(() => {
        /* not logged in, expired cookie, network error, timeout, or abort */
      })
      .finally(finish)

    return () => {
      ac.abort()
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
    // /auth/me also triggers the monthly refill server-side, so call it post-login
    // to pick up the (possibly bumped) balance + admin flags.
    let isSuperuser = false
    let isPrimaryAdmin = false
    try {
      const meRes = await api.get('/auth/me', { timeout: 10_000 })
      isSuperuser = Boolean(meRes.data?.is_superuser)
      isPrimaryAdmin = Boolean(meRes.data?.is_primary_admin)
      if (typeof meRes.data?.credits_balance === 'number') {
        setCredits(meRes.data.credits_balance)
      }
    } catch {
      /* keep going with default isSuperuser/isPrimaryAdmin=false */
    }
    const nextUser = { email: normalizedEmail, isSuperuser, isPrimaryAdmin }
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
    setCredits(null)
  }, [])

  /** Re-fetch the current credit balance (call after a debit/refund event). */
  const refreshCredits = useCallback(async () => {
    try {
      const { data } = await api.get('/me/credits', { timeout: 10_000 })
      if (typeof data?.balance === 'number') {
        setCredits(data.balance)
      }
      return data
    } catch {
      return null
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      ready,
      login,
      logout,
      credits,
      refreshCredits,
      isAuthenticated: Boolean(user),
    }),
    [user, ready, login, logout, credits, refreshCredits],
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
