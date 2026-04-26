/**
 * FastAPI usually returns a JSON array as `res.data` directly.
 * If the payload is wrapped, pick the first array among common keys.
 */
export function extractCatalogArray(resData) {
  if (Array.isArray(resData)) return resData
  if (resData && typeof resData === 'object') {
    const keys = ['items', 'data', 'avatars', 'voices', 'results']
    for (const k of keys) {
      const v = resData[k]
      if (Array.isArray(v)) return v
    }
  }
  return []
}

export function axiosErrorMessage(err) {
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join(' ')
  return err.message || 'הבקשה נכשלה'
}

/**
 * Best-available video URL priority:
 *   1. ugc_final_video_url / ugc_final_video_url_1_1 / ugc_final_video_url_16_9 — Remotion render (best)
 *   2. ugc_composited_video_url — FFmpeg crop-to-fill (no captions)
 *   3. ugc_raw_video_url     — raw HeyGen/D-ID CDN URL
 */
export function ugcPlaybackUrl(payload) {
  const f = typeof payload?.ugc_final_video_url === 'string' ? payload.ugc_final_video_url.trim() : ''
  const f1_1 = typeof payload?.ugc_final_video_url_1_1 === 'string' ? payload.ugc_final_video_url_1_1.trim() : ''
  const f16_9 = typeof payload?.ugc_final_video_url_16_9 === 'string' ? payload.ugc_final_video_url_16_9.trim() : ''
  const c = typeof payload?.ugc_composited_video_url === 'string' ? payload.ugc_composited_video_url.trim() : ''
  const r = typeof payload?.ugc_raw_video_url === 'string' ? payload.ugc_raw_video_url.trim() : ''
  return f || f1_1 || f16_9 || c || r || ''
}

/** Which tier is currently being shown, for the UI badge. */
export function ugcVideoTier(payload) {
  if (typeof payload?.ugc_final_video_url === 'string' && payload.ugc_final_video_url.trim()) return 'final'
  if (typeof payload?.ugc_composited_video_url === 'string' && payload.ugc_composited_video_url.trim())
    return 'composited'
  return 'raw'
}

export function formatUgcStatus(ugcStatus) {
  if (!ugcStatus) return 'מתחיל…'
  const map = {
    pending: 'UGC: בתור להכנה...',
    scraped: 'UGC: סורק את האתר...',
    generating_script: 'UGC: כותב תסריט בימוי...',
    generating_video: 'UGC: מייצר וידאו באולפן AI (זה עשוי לקחת כמה דקות)...',
    processing_video: 'UGC: מעבד וידאו ומשפר איכות...',
    rendering_captions: 'UGC: מטמיע כתוביות ואנימציות...',
    completed: 'UGC: הסרטון מוכן!',
    failed: 'UGC: נכשל',
  }
  return map[ugcStatus] || `UGC: ${ugcStatus.replace(/_/g, ' ')}`
}
