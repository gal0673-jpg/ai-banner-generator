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

/** Shown in the UI footer; when using dev proxy, baseURL is '' but traffic still reaches :8888. */
export const API_BASE_URL_DISPLAY =
  API_BASE_URL ||
  (import.meta.env.DEV ? 'http://127.0.0.1:8888 (proxy דרך Vite)' : 'http://127.0.0.1:8888')

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.defaults.withCredentials = true

export default api
