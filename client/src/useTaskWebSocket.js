/**
 * useTaskWebSocket — real-time task-status updates via WebSocket.
 *
 * Strategy:
 *  1. On mount (or when taskId changes), perform an immediate HTTP GET to
 *     hydrate the current state, then open a WebSocket to /ws/task/{taskId}.
 *  2. The WebSocket stays open for the lifetime of the taskId (so re-render
 *     operations that flip status back to in-progress are handled seamlessly).
 *  3. On unexpected close, reconnect with exponential back-off (up to
 *     RECONNECT_DELAYS.length attempts).
 *  4. If all reconnect attempts fail **or** the server returns a 4401/4403
 *     close code, fall back to polling every POLL_INTERVAL_MS.
 *  5. When taskId becomes null, all connections and timers are torn down.
 *
 * @param {string|null} taskId
 * @param {(payload: object) => void} onMessage  Callback for each status update.
 */

import { useEffect, useRef } from 'react'

import api, { WS_BASE_URL } from './api.js'

const RECONNECT_DELAYS = [1_000, 3_000, 8_000]
const POLL_INTERVAL_MS = 4_000

export function useTaskWebSocket(taskId, onMessage) {
  // Stable refs — updated without re-running the main effect.
  const onMessageRef = useRef(onMessage)
  const activeIdRef = useRef(taskId)

  useEffect(() => { onMessageRef.current = onMessage }, [onMessage])
  useEffect(() => { activeIdRef.current = taskId }, [taskId])

  useEffect(() => {
    if (!taskId) return

    let ws = null
    let pollTimer = null
    let reconnectTimer = null
    let retries = 0
    let destroyed = false

    function teardown() {
      destroyed = true
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000)
        }
        ws = null
      }
      if (pollTimer !== null) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    function startPolling() {
      if (pollTimer !== null || destroyed) return
      pollTimer = setInterval(async () => {
        if (destroyed || activeIdRef.current !== taskId) return
        try {
          const { data } = await api.get(`/status/${taskId}`)
          if (!destroyed) onMessageRef.current(data)
        } catch {
          // ignore transient errors; interval will retry
        }
      }, POLL_INTERVAL_MS)
    }

    function connect() {
      if (destroyed) return

      const url = `${WS_BASE_URL}/ws/task/${taskId}`
      ws = new WebSocket(url)

      ws.onopen = () => {
        retries = 0
        // WS is healthy — cancel any in-flight polling fallback.
        if (pollTimer !== null) {
          clearInterval(pollTimer)
          pollTimer = null
        }
      }

      ws.onmessage = (event) => {
        if (destroyed) return
        try {
          const data = JSON.parse(event.data)
          onMessageRef.current(data)
        } catch {
          // discard malformed frame
        }
      }

      ws.onclose = (event) => {
        if (destroyed) return

        // Intentional close from our teardown() — nothing to do.
        if (event.code === 1000) return

        // Auth / ownership errors — no point retrying; fall back to polling.
        if (event.code === 4401 || event.code === 4403) {
          startPolling()
          return
        }

        const attempt = retries++
        if (attempt < RECONNECT_DELAYS.length) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAYS[attempt])
        } else {
          // All reconnect attempts exhausted — use polling as safety net.
          startPolling()
        }
      }

      ws.onerror = () => {
        // `onclose` fires immediately after `onerror`; reconnect logic lives there.
      }
    }

    // Hydrate with current state before the first WS message arrives.
    api.get(`/status/${taskId}`).then(({ data }) => {
      if (!destroyed && activeIdRef.current === taskId) {
        onMessageRef.current(data)
      }
    }).catch(() => {})

    connect()

    return teardown
  }, [taskId])
}
