/**
 * Pure helper functions for BannerWorkspace (no JSX — safe for Fast Refresh).
 * Stateless components live in ``components.jsx`` next to this file.
 */

import { SKIP_LATEST_RESTORE_KEY } from './constants.js'


/** Hebrew label for a top-level banner status code. */
export function formatStatus(status, { videoRendering = false } = {}) {
  if (!status) return 'מתחיל…'
  if (status === 'completed' && videoRendering) return 'באנר הושלם · מייצר וידאו ברקע…'
  const map = {
    pending: 'ממתין…',
    scraped: 'סורק את האתר…',
    generating_image: 'מייצר ויז׳ואל וקופי…',
    completed: 'הושלם',
    failed: 'נכשל',
  }
  return map[status] || status.replace(/_/g, ' ')
}


/** Extract a human-readable error message from an axios failure. Handles strings,
 *  Pydantic validation arrays, and the structured 402 credits detail object. */
export function axiosErrorMessage(err) {
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join(' ')
  // Credits gate (HTTP 402): server returns {error, balance, required, message}.
  if (d && typeof d === 'object') {
    if (typeof d.message === 'string') return d.message
    return JSON.stringify(d)
  }
  return err.message || 'הבקשה נכשלה'
}


/** True when an axios error is a 402 (insufficient credits). */
export function isInsufficientCreditsError(err) {
  return (
    err?.response?.status === 402 &&
    err?.response?.data?.detail?.error === 'insufficient_credits'
  )
}


/** Pick the best playable UGC URL from a /status payload (final > composited > raw). */
export function ugcPlaybackUrl(payload) {
  const f = typeof payload?.ugc_final_video_url === 'string' ? payload.ugc_final_video_url.trim() : ''
  const f1_1 = typeof payload?.ugc_final_video_url_1_1 === 'string' ? payload.ugc_final_video_url_1_1.trim() : ''
  const f16_9 = typeof payload?.ugc_final_video_url_16_9 === 'string' ? payload.ugc_final_video_url_16_9.trim() : ''
  const c = typeof payload?.ugc_composited_video_url === 'string' ? payload.ugc_composited_video_url.trim() : ''
  const r = typeof payload?.ugc_raw_video_url === 'string' ? payload.ugc_raw_video_url.trim() : ''
  return f || f1_1 || f16_9 || c || r || ''
}


/** Hebrew label for a UGC pipeline status code. */
export function formatUgcStatus(ugcStatus) {
  if (!ugcStatus) return 'מתחיל…'
  const map = {
    pending: 'UGC: ממתין…',
    scraped: 'UGC: נסרק את האתר…',
    generating_script: 'UGC: מכין תסריט…',
    generating_video: 'UGC: מייצר וידאו…',
    completed: 'UGC: הושלם',
    failed: 'UGC: נכשל',
  }
  return map[ugcStatus] || `UGC: ${ugcStatus.replace(/_/g, ' ')}`
}


/** Read the "skip latest banner restore" flag from sessionStorage (with private-mode guard). */
export function readSkipLatestRestoreFlag() {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SKIP_LATEST_RESTORE_KEY) === '1'
  } catch {
    return false
  }
}
