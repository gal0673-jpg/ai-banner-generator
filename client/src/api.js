import axios from 'axios'

/**
 * - In dev: set VITE_API_URL= (empty) in client/.env to use the Vite proxy (same origin as the UI; avoids CORS).
 * - Or set VITE_API_URL=http://127.0.0.1:8888 to call the API directly (CORS must allow your exact Origin).
 * - In production builds, empty VITE_API_URL falls back to http://127.0.0.1:8888.
 */
const configured = import.meta.env.VITE_API_URL
export const API_BASE_URL =
  import.meta.env.DEV && configured === ''
    ? ''
    : typeof configured === 'string' && configured.trim() !== ''
      ? configured.trim().replace(/\/$/, '')
      : 'http://127.0.0.1:8888'

/** Shown in the UI footer: direct URL, or browser origin when axios uses same-origin + Vite proxy → :8888. */
function devProxyLabel() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8888 (proxy דרך Vite)'
  return `${window.location.origin} → proxy ל־http://127.0.0.1:8888`
}
export const API_BASE_URL_DISPLAY =
  API_BASE_URL || (import.meta.env.DEV ? devProxyLabel() : 'http://127.0.0.1:8888')

/**
 * Turn a server-relative path (e.g. `/task-files/temp/...`) into an absolute URL for
 * Remotion / external fetches. Leaves `http(s)://` URLs unchanged.
 */
export function toAbsoluteApiUrl(pathOrUrl) {
  const u = typeof pathOrUrl === 'string' ? pathOrUrl.trim() : ''
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  const base = (API_BASE_URL || 'http://127.0.0.1:8888').replace(/\/$/, '')
  return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`
}

/**
 * WebSocket base URL — derived from the HTTP base by swapping the scheme.
 * ``http://127.0.0.1:8888`` → ``ws://127.0.0.1:8888``
 * ``https://api.example.com`` → ``wss://api.example.com``
 * Same-origin proxy (API_BASE_URL === '') → '' (relative WS paths are not
 * valid so we fall back to the explicit local address in that case).
 */
export const WS_BASE_URL =
  API_BASE_URL
    ? API_BASE_URL.replace(/^http/, 'ws')
    : 'ws://127.0.0.1:8888'

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.defaults.withCredentials = true

export default api
