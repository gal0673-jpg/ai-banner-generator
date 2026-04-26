import { useEffect, useState } from 'react'
import { useTaskWebSocket } from '../useTaskWebSocket.js'

/**
 * Owns task status hydration for a single task id: WebSocket (+ HTTP fallback inside hook),
 * terminal detection, and clears payload when taskId is cleared.
 *
 * Name reflects the user-facing “waiting on task” behaviour; implementation uses useTaskWebSocket.
 */
export function useTaskPolling(taskId) {
  const [statusPayload, setStatusPayload] = useState(null)

  useEffect(() => {
    if (!taskId) setStatusPayload(null)
  }, [taskId])

  useTaskWebSocket(taskId, setStatusPayload)

  const bannerTerminal =
    statusPayload?.status === 'completed' || statusPayload?.status === 'failed'
  const ugcTerminal =
    statusPayload?.ugc_status === 'completed' || statusPayload?.ugc_status === 'failed'
  const terminal = bannerTerminal || ugcTerminal
  const isPolling = Boolean(taskId && !terminal)

  return {
    statusPayload,
    bannerTerminal,
    ugcTerminal,
    terminal,
    isPolling,
  }
}
