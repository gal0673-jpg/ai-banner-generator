import { useCallback, useEffect, useRef } from 'react'

/**
 * Debounces `callback` by `delay` milliseconds.
 *
 * Returns `{ schedule, flush, cancel }`:
 *   - `schedule()` — resets the timer; the callback fires `delay` ms after the
 *     last call.  Safe to call as often as needed.
 *   - `flush()` — cancels the timer and calls the callback immediately (useful
 *     for imperative saves, e.g. before navigation).
 *   - `cancel()` — cancels any pending timer without calling the callback
 *     (useful when the pending work is no longer needed).
 *
 * Key guarantees:
 *   1. `callback` is always read from a ref, so it never goes stale — callers
 *      do NOT need to include it in their own dependency arrays.
 *   2. On unmount the hook flushes any pending timer automatically to prevent
 *      data loss.
 *   3. `schedule`, `flush`, and `cancel` are stable references (empty dep
 *      arrays) for the lifetime of the component, except when `delay` changes.
 */
export function useDebouncedCallback(callback, delay) {
  const timerRef    = useRef(null)
  const callbackRef = useRef(callback)
  // Keep callbackRef fresh on every render (synchronous, no useEffect lag).
  callbackRef.current = callback

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const flush = useCallback(() => {
    cancel()
    callbackRef.current()
  }, [cancel])

  const schedule = useCallback(() => {
    cancel()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      callbackRef.current()
    }, delay)
  }, [cancel, delay])

  // Flush any pending call on unmount so in-progress edits are not lost.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        callbackRef.current()
      }
    },
    [],
  )

  return { schedule, flush, cancel }
}
