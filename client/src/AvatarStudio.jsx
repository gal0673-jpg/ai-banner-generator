import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api, { API_BASE_URL, API_BASE_URL_DISPLAY, toAbsoluteApiUrl } from './api.js'
import { useAuth } from './AuthContext.jsx'

function axiosErrorMessage(err) {
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join(' ')
  return err.message || 'הבקשה נכשלה'
}

const DEFAULT_DID_URL =
  'https://d-id-public-bucket.s3.us-west-2.amazonaws.com/alice.jpg'
const DEFAULT_HEYGEN_ID = 'd365dda368044f6189ee68af637389ff'
const UGC_DEFAULT_VOICE_HINT = 'Wuv1s5YTNCjL9mFJTqo4'

/**
 * Best-available video URL priority:
 *   1. ugc_final_video_url / ugc_final_video_url_1_1 / ugc_final_video_url_16_9 — Remotion render (best)
 *   2. ugc_composited_video_url — FFmpeg crop-to-fill (no captions)
 *   3. ugc_raw_video_url     — raw HeyGen/D-ID CDN URL
 */
function ugcPlaybackUrl(payload) {
  const f = typeof payload?.ugc_final_video_url === 'string' ? payload.ugc_final_video_url.trim() : ''
  const f1_1 = typeof payload?.ugc_final_video_url_1_1 === 'string' ? payload.ugc_final_video_url_1_1.trim() : ''
  const f16_9 = typeof payload?.ugc_final_video_url_16_9 === 'string' ? payload.ugc_final_video_url_16_9.trim() : ''
  const c = typeof payload?.ugc_composited_video_url === 'string' ? payload.ugc_composited_video_url.trim() : ''
  const r = typeof payload?.ugc_raw_video_url === 'string' ? payload.ugc_raw_video_url.trim() : ''
  return f || f1_1 || f16_9 || c || r || ''
}

/** Which tier is currently being shown, for the UI badge. */
function ugcVideoTier(payload) {
  if (typeof payload?.ugc_final_video_url === 'string' && payload.ugc_final_video_url.trim())
    return 'final'
  if (typeof payload?.ugc_composited_video_url === 'string' && payload.ugc_composited_video_url.trim())
    return 'composited'
  return 'raw'
}

function formatUgcStatus(ugcStatus) {
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

function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block size-5 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin ${className}`}
      aria-hidden
    />
  )
}

const UGC_STATUS_PROGRESS = {
  pending: 5,
  scraped: 10,
  generating_script: 15,
  generating_video: 50,
  processing_video: 75,
  rendering_captions: 95,
  completed: 100,
}

/** Total job estimate (minutes) by target video length — used for ETA copy only. */
const VIDEO_LENGTH_TOTAL_MINUTES = {
  '15s': 3,
  '30s': 5,
  '50s': 8,
}

function UgcProgressTracker({ statusPayload, videoLength }) {
  const ugcStatus = statusPayload?.ugc_status
  const pct =
    typeof ugcStatus === 'string' && ugcStatus in UGC_STATUS_PROGRESS ? UGC_STATUS_PROGRESS[ugcStatus] : 5

  const totalMinutes = VIDEO_LENGTH_TOTAL_MINUTES[videoLength] ?? 5
  const remainingMinutes = Math.max(1, Math.round(totalMinutes * (1 - pct / 100)))

  return (
    <div
      className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 space-y-4"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={formatUgcStatus(ugcStatus) || 'התקדמות UGC'}
    >
      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200/90 dark:bg-slate-700/90">
        <div
          className="h-full rounded-full bg-gradient-to-l from-violet-600 to-violet-500 shadow-[0_0_12px_rgba(124,58,237,0.45)] transition-all duration-1000 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300" dir="rtl">
        זמן משוער לסיום: כ-{remainingMinutes} דקות. המערכת עובדת ברקע, ניתן להשאיר את המסך פתוח.
      </p>
    </div>
  )
}

function UgcScriptScenesBody({ scenes }) {
  if (!Array.isArray(scenes) || scenes.length === 0) return null
  return (
    <ul className="space-y-4 pt-2">
      {scenes.map((scene, i) => {
        const num = scene?.scene_number ?? i + 1
        const spoken = typeof scene?.spoken_text === 'string' ? scene.spoken_text.trim() : ''
        const onScreen = typeof scene?.on_screen_text === 'string' ? scene.on_screen_text.trim() : ''
        return (
          <li
            key={`ugc-scene-${num}-${i}`}
            className="rounded-xl border border-slate-200/90 dark:border-slate-700/90 bg-slate-50/80 dark:bg-slate-950/50 p-4 text-right"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-950/80 px-2.5 py-0.5 text-[11px] font-semibold text-violet-800 dark:text-violet-200 ring-1 ring-violet-200/80 dark:ring-violet-800/60">
                סצנה {num}
              </span>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  דיבור (תמליל)
                </p>
                <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed whitespace-pre-wrap" dir="rtl">
                  {spoken || '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  טקסט על המסך
                </p>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-relaxed" dir="rtl">
                  {onScreen || '—'}
                </p>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const UGC_RERENDER_SPEEDS = [
  { value: 1, label: '1.0× (רגיל)' },
  { value: 1.15, label: '1.15×' },
  { value: 1.25, label: '1.25×' },
]

const UGC_RERENDER_ANIMATIONS = [
  { value: 'pop', label: 'פופ טיקטוק' },
  { value: 'fade', label: 'כניסה חלקה' },
  { value: 'typewriter', label: 'מכונת כתיבה' },
]

const UGC_RERENDER_POSITIONS = [
  { value: 'bottom', label: 'תחתון' },
  { value: 'center', label: 'מרכז' },
  { value: 'top', label: 'עליון' },
]

const UGC_RERENDER_FONTS = [
  { value: 'heebo', label: 'Heebo' },
  { value: 'rubik', label: 'Rubik' },
  { value: 'assistant', label: 'Assistant' },
]

const _ALLOWED_ANIM = new Set(['pop', 'fade', 'typewriter'])
const _ALLOWED_POS = new Set(['bottom', 'center', 'top'])
const _ALLOWED_FONT = new Set(['heebo', 'rubik', 'assistant'])

export default function AvatarStudio() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const [scriptSource, setScriptSource] = useState('spoken_only')
  const [creativeBrief, setCreativeBrief] = useState('')
  const [directorNotes, setDirectorNotes] = useState('')
  const [spokenScript, setSpokenScript] = useState('')
  const [provider, setProvider] = useState('heygen_elevenlabs')
  const [heygenCharacterType, setHeygenCharacterType] = useState('avatar')
  const [avatarId, setAvatarId] = useState(DEFAULT_HEYGEN_ID)
  const [voiceId, setVoiceId] = useState('')
  const [videoLength, setVideoLength] = useState('15s')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [productImageUrl, setProductImageUrl] = useState('')
  const logoFileRef = useRef(null)
  const productFileRef = useRef(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [productUploading, setProductUploading] = useState(false)

  const hydratedScriptKeyRef = useRef('')
  const [rerenderSpeed, setRerenderSpeed] = useState(1.15)
  const [rerenderAnimation, setRerenderAnimation] = useState('pop')
  const [rerenderPosition, setRerenderPosition] = useState('bottom')
  const [rerenderFont, setRerenderFont] = useState('heebo')
  const [draftBrandColor, setDraftBrandColor] = useState('')
  const [rerenderSubmitting, setRerenderSubmitting] = useState(false)
  const [rerenderError, setRerenderError] = useState(null)
  /** Which aspect ratio re-render is in flight (for progressive 1:1 / 16:9 buttons). */
  const [pendingAspectRatio, setPendingAspectRatio] = useState(null)
  /** Which format tab is shown in the preview player (null = auto-pick first available). */
  const [activePreviewAspect, setActivePreviewAspect] = useState(null)

  const [taskId, setTaskId] = useState(null)
  const [statusPayload, setStatusPayload] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [isPosting, setIsPosting] = useState(false)
  const [sseBump, setSseBump] = useState(0)

  const bannerTerminal =
    statusPayload?.status === 'completed' || statusPayload?.status === 'failed'
  const ugcTerminal =
    statusPayload?.ugc_status === 'completed' || statusPayload?.ugc_status === 'failed'
  const terminal = bannerTerminal || ugcTerminal
  const isPolling = Boolean(taskId && !terminal)

  useEffect(() => {
    hydratedScriptKeyRef.current = ''
    setDraftBrandColor('')
    setRerenderSpeed(1.15)
    setRerenderAnimation('pop')
    setRerenderPosition('bottom')
    setRerenderFont('heebo')
    setRerenderError(null)
    setActivePreviewAspect(null)
  }, [taskId])

  useEffect(() => {
    if (statusPayload?.ugc_status === 'completed' || statusPayload?.ugc_status === 'failed') {
      setPendingAspectRatio(null)
    }
  }, [statusPayload?.ugc_status])

  useLayoutEffect(() => {
    if (statusPayload?.ugc_status !== 'completed' || !taskId) return
    const key = `${taskId}|${String(statusPayload?.ugc_final_video_url || '')}|${String(statusPayload?.ugc_composited_video_url || '')}|${String(statusPayload?.ugc_raw_video_url || '')}`
    if (hydratedScriptKeyRef.current === key) return
    hydratedScriptKeyRef.current = key
    const st = statusPayload?.ugc_script?.style
    const anim = typeof st?.animation === 'string' && _ALLOWED_ANIM.has(st.animation) ? st.animation : 'pop'
    const pos = typeof st?.position === 'string' && _ALLOWED_POS.has(st.position) ? st.position : 'bottom'
    const font = typeof st?.font === 'string' && _ALLOWED_FONT.has(st.font) ? st.font : 'heebo'
    setRerenderAnimation(anim)
    setRerenderPosition(pos)
    setRerenderFont(font)
    const rawSf = Number(statusPayload?.ugc_speed_factor)
    const nearest = UGC_RERENDER_SPEEDS.map((x) => x.value).reduce((best, v) =>
      Math.abs(v - rawSf) < Math.abs(best - rawSf) ? v : best,
    1.15,
    )
    setRerenderSpeed(nearest)
    setDraftBrandColor(typeof statusPayload?.brand_color === 'string' ? statusPayload.brand_color.trim() : '')
  }, [
    taskId,
    statusPayload?.ugc_status,
    statusPayload?.ugc_script,
    statusPayload?.ugc_final_video_url,
    statusPayload?.ugc_composited_video_url,
    statusPayload?.ugc_raw_video_url,
    statusPayload?.ugc_speed_factor,
    statusPayload?.brand_color,
  ])

  useEffect(() => {
    if (!taskId) return undefined
    const tick = async () => {
      try {
        const { data } = await api.get(`/status/${taskId}`)
        setStatusPayload(data)
      } catch {
        /* ignore */
      }
    }
    void tick()
    const id = setInterval(tick, 4000)
    return () => clearInterval(id)
  }, [taskId])

  useEffect(() => {
    if (!taskId) {
      setStatusPayload(null)
      return undefined
    }
    const ssePath = `${API_BASE_URL}/status/${taskId}/stream`
    const sse = new EventSource(ssePath)
    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setStatusPayload(data)
      } catch {
        /* ignore */
      }
    }
    return () => {
      sse.close()
    }
  }, [taskId, sseBump])

  const handleUgcRerender = async (ar) => {
    const targetAspect = ar ?? activePreviewAspect ?? aspectRatio ?? '9:16'
    if (!taskId) return
    setRerenderError(null)
    setRerenderSubmitting(true)
    setPendingAspectRatio(targetAspect)
    try {
      const body = {
        speed_factor: rerenderSpeed,
        caption_animation: rerenderAnimation,
        caption_position: rerenderPosition,
        caption_font: rerenderFont,
        aspect_ratio: targetAspect,
      }
      const lu = logoUrl.trim()
      if (lu) body.logo_url = lu
      const pu = productImageUrl.trim()
      if (pu) body.product_image_url = pu
      const bc = draftBrandColor.trim()
      if (bc) {
        if (!/^#[0-9A-Fa-f]{6}$/.test(bc)) {
          throw new Error('צבע מותג חייב להיות בפורמט #RRGGBB (שש ספרות הקסדצימליות)')
        }
        body.brand_color = bc.toUpperCase()
      }
      await api.post(`/tasks/${taskId}/ugc/re-render`, body)
    } catch (err) {
      setRerenderError(axiosErrorMessage(err))
      setPendingAspectRatio(null)
    } finally {
      setRerenderSubmitting(false)
    }
  }

  const uploadTempAsset = async (file, kind) => {
    const setBusy = kind === 'logo' ? setLogoUploading : setProductUploading
    const setUrl = kind === 'logo' ? setLogoUrl : setProductImageUrl
    setSubmitError(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const base = (API_BASE_URL || '').replace(/\/$/, '')
      const res = await fetch(`${base}/upload-temp-asset`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      })
      let data = {}
      try {
        data = await res.json()
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        const d = data?.detail
        if (typeof d === 'string') throw new Error(d)
        if (Array.isArray(d)) throw new Error(d.map((x) => x.msg || JSON.stringify(x)).join(' '))
        throw new Error(res.statusText || 'ההעלאה נכשלה')
      }
      const u = typeof data?.url === 'string' ? data.url.trim() : ''
      if (u) setUrl(toAbsoluteApiUrl(u))
    } catch (err) {
      setSubmitError(axiosErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitError(null)
    setIsPosting(true)
    try {
      const body = {
        script_source: scriptSource,
        provider,
        avatar_id: avatarId.trim(),
        video_length: videoLength,
        aspect_ratio: aspectRatio,
      }
      const v = voiceId.trim()
      if (v) body.voice_id = v
      if (provider === 'heygen_elevenlabs') {
        body.heygen_character_type = heygenCharacterType
      }
      if (scriptSource === 'from_brief_ai') {
        body.creative_brief = creativeBrief.trim()
        const dn = directorNotes.trim()
        if (dn) body.director_notes = dn
      } else {
        body.spoken_script = spokenScript.trim()
      }
      const wu = websiteUrl.trim()
      if (wu) body.website_url = wu
      const lu = logoUrl.trim()
      if (lu) body.logo_url = lu
      body.product_image_url = productImageUrl.trim() || undefined
      const { data } = await api.post('/avatar-studio/generate', body)
      const id = data?.task_id
      if (!id) throw new Error('לא התקבל מזהה משימה')
      setTaskId(id)
      setSseBump((n) => n + 1)
    } catch (err) {
      setSubmitError(axiosErrorMessage(err))
    } finally {
      setIsPosting(false)
    }
  }

  const formLocked = isPosting || isPolling

  const ugcFinal9_16 =
    typeof statusPayload?.ugc_final_video_url === 'string'
      ? statusPayload.ugc_final_video_url.trim()
      : ''
  const ugcFinal1_1 =
    typeof statusPayload?.ugc_final_video_url_1_1 === 'string'
      ? statusPayload.ugc_final_video_url_1_1.trim()
      : ''
  const ugcFinal16_9 =
    typeof statusPayload?.ugc_final_video_url_16_9 === 'string'
      ? statusPayload.ugc_final_video_url_16_9.trim()
      : ''
  const ugcPipelineBusy = ['processing_video', 'rendering_captions'].includes(statusPayload?.ugc_status)

  const currentVideoUrl = (() => {
    const c = typeof statusPayload?.ugc_composited_video_url === 'string' ? statusPayload.ugc_composited_video_url.trim() : ''
    const r = typeof statusPayload?.ugc_raw_video_url === 'string' ? statusPayload.ugc_raw_video_url.trim() : ''
    if (activePreviewAspect === '16:9') return ugcFinal16_9 || ''
    if (activePreviewAspect === '1:1') return ugcFinal1_1 || ''
    if (activePreviewAspect === '9:16') return ugcFinal9_16 || c || r || ''
    return ugcFinal9_16 || ugcFinal16_9 || ugcFinal1_1 || c || r || ''
  })()
  const effectivePreviewAspect =
    activePreviewAspect ?? (ugcFinal9_16 ? '9:16' : ugcFinal16_9 ? '16:9' : ugcFinal1_1 ? '1:1' : null)
  const formatAspectLoading = (ar) =>
    pendingAspectRatio === ar &&
    (rerenderSubmitting ||
      statusPayload?.ugc_status === 'processing_video' ||
      statusPayload?.ugc_status === 'rendering_captions')

  const statusChip = useMemo(() => {
    const s = statusPayload?.status
    if (!taskId) return null
    const ugcS = statusPayload?.ugc_status
    const tone =
      s === 'failed' || ugcS === 'failed'
        ? 'bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/25'
        : s === 'completed' || ugcS === 'completed'
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25'
          : 'bg-violet-500/15 text-violet-700 dark:text-violet-200 ring-violet-500/25'
    const showSpinner = isPolling
    const label =
      ugcS && (s === 'pending' || !bannerTerminal)
        ? formatUgcStatus(ugcS)
        : s ?? '…'
    return (
      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 ${tone}`}>
        {showSpinner && <Spinner className="!size-3.5 border-violet-400/40 border-t-violet-300" />}
        <span className="opacity-90">{label}</span>
      </span>
    )
  }, [taskId, statusPayload?.status, statusPayload?.ugc_status, isPolling, bannerTerminal])

  return (
    <div
      className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      dir="rtl"
      lang="he"
    >
      <header className="sticky top-0 z-20 border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[96%] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="text-start">
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              סטודיו אווטאר שיווקי
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              ללא סריקת אתר — בריף, בימוי ותסריט מובנים לווידאו מדבר
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              חזרה לבאנרים
            </Link>
            {user?.email && (
              <span className="hidden text-sm text-slate-600 dark:text-slate-400 sm:inline max-w-[180px] truncate">
                {user.email}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                logout()
                navigate('/login', { replace: true })
              }}
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              התנתקות
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[96%] gap-6 px-4 py-6 lg:grid-cols-[minmax(300px,400px)_1fr] sm:px-6 lg:py-8">
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm text-right space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                מקור תסריט
              </label>
              <select
                value={scriptSource}
                onChange={(ev) => setScriptSource(ev.target.value)}
                disabled={formLocked}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60"
              >
                <option value="from_brief_ai">AI מבריף + הערות בימוי</option>
                <option value="spoken_only">רק טקסט דיבור (בלי AI)</option>
              </select>
            </div>

            {scriptSource === 'from_brief_ai' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                    <span className="text-red-500">*</span> בריף קריאייטיבי
                  </label>
                  <textarea
                    rows={6}
                    value={creativeBrief}
                    onChange={(ev) => setCreativeBrief(ev.target.value)}
                    disabled={formLocked}
                    placeholder="מוצר, קהל, הצעה, טון — מה המסר?"
                    className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-violet-500 min-h-[120px] disabled:opacity-60"
                    dir="rtl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                    הערות בימוי / מבנה{' '}
                    <span className="text-slate-400 font-normal">(לא יוקראו בקול — מנחות את ה-AI)</span>
                  </label>
                  <textarea
                    rows={4}
                    value={directorNotes}
                    onChange={(ev) => setDirectorNotes(ev.target.value)}
                    disabled={formLocked}
                    placeholder="למשל: הוק 3 שניות, כאב, הוכחה, CTA חזק בסוף…"
                    className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-violet-500 min-h-[88px] disabled:opacity-60"
                    dir="rtl"
                  />
                </div>
              </>
            )}

            {scriptSource === 'spoken_only' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  <span className="text-red-500">*</span> טקסט לדיבור בלבד (עברית)
                </label>
                <textarea
                  rows={8}
                  value={spokenScript}
                  onChange={(ev) => setSpokenScript(ev.target.value)}
                  disabled={formLocked}
                  placeholder="רק מה שהאווטאר יאמר — בלי כותרות סצנה ואנגלית."
                  maxLength={12000}
                  className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-violet-500 min-h-[160px] disabled:opacity-60"
                  dir="rtl"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">ספק</label>
              <select
                value={provider}
                onChange={(ev) => {
                  const v = ev.target.value
                  setProvider(v)

                  const currentAvatar = avatarId.trim()
                  if (v === 'd-id' && (currentAvatar === DEFAULT_HEYGEN_ID || currentAvatar === '')) {
                    setAvatarId(DEFAULT_DID_URL)
                  } else if (
                    v === 'heygen_elevenlabs' &&
                    (currentAvatar === DEFAULT_DID_URL || currentAvatar === '')
                  ) {
                    setAvatarId(DEFAULT_HEYGEN_ID)
                  }
                }}
                disabled={formLocked}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
              >
                <option value="d-id">D-ID</option>
                <option value="heygen_elevenlabs">HeyGen + ElevenLabs</option>
              </select>
            </div>

            {provider === 'heygen_elevenlabs' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  סוג מזהה HeyGen
                </label>
                <select
                  value={heygenCharacterType}
                  onChange={(ev) => setHeygenCharacterType(ev.target.value)}
                  disabled={formLocked}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
                >
                  <option value="avatar">אווטאר סטודיו / Instant (avatar_id)</option>
                  <option value="talking_photo">תמונה מדברת / Photo avatar (talking_photo_id)</option>
                </select>
                <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed text-right">
                  אם HeyGen מחזיר &quot;avatar look not found&quot; — לרוב העתקת מזהה של תמונה מדברת אבל נשלח כ-avatar. נסה
                  &quot;תמונה מדברת&quot;.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">אווטאר / תמונה</label>
              <input
                type="text"
                value={avatarId}
                onChange={(ev) => setAvatarId(ev.target.value)}
                disabled={formLocked}
                placeholder={
                  provider === 'd-id'
                    ? 'URL תמונת פנים'
                    : heygenCharacterType === 'talking_photo'
                      ? 'talking_photo_id מ-List Avatars V2'
                      : 'avatar_id מ-HeyGen'
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                קול ElevenLabs <span className="text-slate-400 font-normal">(אופציונלי)</span>
              </label>
              <input
                type="text"
                value={voiceId}
                onChange={(ev) => setVoiceId(ev.target.value)}
                disabled={formLocked}
                placeholder={`ברירת מחדל: ${UGC_DEFAULT_VOICE_HINT}`}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">אורך יעד</label>
              <select
                value={videoLength}
                onChange={(ev) => setVideoLength(ev.target.value)}
                disabled={formLocked}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
              >
                <option value="15s">15 שניות</option>
                <option value="30s">30 שניות</option>
                <option value="50s">50 שניות</option>
              </select>
            </div>

            <div dir="rtl">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                יחס גובה-רוחב לווידאו
              </label>
              <select
                value={aspectRatio}
                onChange={(ev) => setAspectRatio(ev.target.value)}
                disabled={formLocked}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none disabled:opacity-60"
              >
                <option value="9:16">9:16 (Story/Reels)</option>
                <option value="16:9">16:9 (אופקי)</option>
                <option value="1:1">1:1 (ריבועי)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                כתובת לאתר בווידאו{' '}
                <span className="text-slate-400 font-normal">(אופציונלי)</span>
              </label>
              <input
                type="text"
                value={websiteUrl}
                onChange={(ev) => setWebsiteUrl(ev.target.value)}
                disabled={formLocked}
                placeholder="example.co.il — יוצג בלי https/www"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
                dir="ltr"
                autoComplete="off"
                maxLength={512}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                כתובת תמונת לוגו{' '}
                <span className="text-slate-400 font-normal">(אופציונלי)</span>
              </label>
              <div className="flex flex-wrap items-stretch gap-2">
                <input
                  type="text"
                  value={logoUrl}
                  onChange={(ev) => setLogoUrl(ev.target.value)}
                  disabled={formLocked}
                  placeholder="https://... קישור ישיר לתמונה"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
                  dir="ltr"
                  autoComplete="off"
                  maxLength={1024}
                />
                <input
                  ref={logoFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(ev) => {
                    const f = ev.target.files?.[0]
                    if (f) void uploadTempAsset(f, 'logo')
                    ev.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => logoFileRef.current?.click()}
                  disabled={formLocked || logoUploading}
                  className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 min-w-[5.5rem]"
                >
                  {logoUploading ? <Spinner className="!size-4" /> : null}
                  <span>{logoUploading ? 'מעלה…' : 'העלאה'}</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                תמונת מוצר (אופציונלי - תופיע במרכז ובסוף)
              </label>
              <div className="flex flex-wrap items-stretch gap-2">
                <input
                  type="text"
                  value={productImageUrl}
                  onChange={(ev) => setProductImageUrl(ev.target.value)}
                  disabled={formLocked}
                  placeholder="https://... קישור ישיר לתמונת מוצר"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
                  dir="ltr"
                  autoComplete="off"
                  maxLength={1024}
                />
                <input
                  ref={productFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(ev) => {
                    const f = ev.target.files?.[0]
                    if (f) void uploadTempAsset(f, 'product')
                    ev.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => productFileRef.current?.click()}
                  disabled={formLocked || productUploading}
                  className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 min-w-[5.5rem]"
                >
                  {productUploading ? <Spinner className="!size-4" /> : null}
                  <span>{productUploading ? 'מעלה…' : 'העלאה'}</span>
                </button>
              </div>
            </div>

            {submitError && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200"
              >
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={formLocked}
              className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md hover:bg-violet-500 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {isPosting && <Spinner className="!size-4 border-white/30 border-t-white" />}
              {isPosting ? 'שולח…' : isPolling ? 'מייצר…' : 'צור וידאו'}
            </button>

            <p className="text-[10px] text-slate-400">
              API: <code className="rounded bg-slate-100 dark:bg-slate-800 px-1" dir="ltr">{API_BASE_URL_DISPLAY}</code>
            </p>
          </form>
        </aside>

        <main className="min-h-[280px] space-y-4 text-right">
          {!taskId && (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/50 dark:bg-slate-900/40 px-6 py-16 text-center text-sm text-slate-500">
              מלא את הטופס ולחץ &quot;צור וידאו&quot;. הסטטוס והתסריט יופיעו כאן.
            </div>
          )}

          {taskId && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">סטטוס</h2>
                {statusChip}
              </div>
              {statusPayload?.task_kind && (
                <p className="text-xs text-slate-500">
                  סוג משימה: <span className="font-mono" dir="ltr">{statusPayload.task_kind}</span>
                </p>
              )}
              <p className="text-xs font-mono break-all" dir="ltr">
                task_id: {taskId}
              </p>

              {(statusPayload?.status === 'failed' || statusPayload?.ugc_status === 'failed') && (
                <div
                  role="alert"
                  className="rounded-2xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-900 dark:text-red-100"
                >
                  <strong className="font-semibold">שגיאה.</strong>
                  <p className="mt-1">
                    {statusPayload?.ugc_status === 'failed'
                      ? statusPayload.ugc_error || statusPayload.error
                      : statusPayload.error}
                  </p>
                </div>
              )}

              {isPolling && (
                <UgcProgressTracker statusPayload={statusPayload} videoLength={videoLength} />
              )}

              {statusPayload?.ugc_script?.scenes?.length > 0 && statusPayload?.ugc_status !== 'completed' && (
                <details className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm open:pb-2">
                  <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold">
                    תסריט (סצנות)
                  </summary>
                  <div className="px-5 pb-4 border-t border-slate-100 dark:border-slate-800 pt-3">
                    <UgcScriptScenesBody scenes={statusPayload.ugc_script.scenes} />
                  </div>
                </details>
              )}

              {statusPayload?.ugc_status === 'completed' && ugcPlaybackUrl(statusPayload) && (
                <div className="rounded-2xl border border-violet-200 dark:border-violet-800/60 bg-white dark:bg-slate-900 p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">וידאו</h3>
                    {/* Tier badge — tells the user which version they're watching */}
                    {ugcVideoTier(statusPayload) === 'final' && (
                      <span className="rounded-full bg-violet-100 dark:bg-violet-950/70 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300 ring-1 ring-violet-200/80 dark:ring-violet-800/60">
                        ✦ כתוביות + אנימציות
                      </span>
                    )}
                    {ugcVideoTier(statusPayload) === 'composited' && (
                      <span className="rounded-full bg-sky-100 dark:bg-sky-950/70 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300 ring-1 ring-sky-200/80 dark:ring-sky-800/60">
                        מלא מסך — FFmpeg (ללא כיתוביות)
                      </span>
                    )}
                    {ugcVideoTier(statusPayload) === 'raw' && (
                      <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-slate-700">
                        וידאו גלמי
                      </span>
                    )}
                  </div>

                  {statusPayload?.ugc_composite_note?.trim() && (
                    <div
                      role="alert"
                      className="flex gap-2 rounded-xl border border-amber-300 dark:border-amber-600/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200"
                      dir="rtl"
                    >
                      <span className="mt-0.5 shrink-0 text-amber-500">⚠</span>
                      <span className="leading-relaxed">{statusPayload.ugc_composite_note.trim()}</span>
                    </div>
                  )}

                  {(ugcFinal9_16 || ugcFinal1_1 || ugcFinal16_9) && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">תצוגה מקדימה:</span>
                      {ugcFinal9_16 && (
                        <button
                          type="button"
                          onClick={() => setActivePreviewAspect('9:16')}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                            effectivePreviewAspect === '9:16'
                              ? 'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-200 ring-1 ring-violet-300 dark:ring-violet-700'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          9:16
                        </button>
                      )}
                      {ugcFinal1_1 && (
                        <button
                          type="button"
                          onClick={() => setActivePreviewAspect('1:1')}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                            effectivePreviewAspect === '1:1'
                              ? 'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-200 ring-1 ring-violet-300 dark:ring-violet-700'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          1:1
                        </button>
                      )}
                      {ugcFinal16_9 && (
                        <button
                          type="button"
                          onClick={() => setActivePreviewAspect('16:9')}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                            effectivePreviewAspect === '16:9'
                              ? 'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-200 ring-1 ring-violet-300 dark:ring-violet-700'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          16:9
                        </button>
                      )}
                    </div>
                  )}
                  {(() => {
                    const currentAspect = activePreviewAspect || aspectRatio || '9:16'
                    return (
                      <div
                        className="relative mx-auto w-full bg-black rounded-xl overflow-hidden flex items-center justify-center shadow-lg"
                        style={{
                          maxWidth: currentAspect === '16:9' ? 640 : currentAspect === '1:1' ? 400 : 280,
                          aspectRatio: currentAspect === '16:9' ? '16 / 9' : currentAspect === '1:1' ? '1 / 1' : '9 / 16',
                        }}
                      >
                        <video
                          key={currentVideoUrl}
                          className="w-full h-full object-contain block"
                          src={currentVideoUrl}
                          controls
                          playsInline
                          preload="metadata"
                        />
                      </div>
                    )
                  })()}

                  {/* Download links — one per available tier */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <a
                      href={ugcPlaybackUrl(statusPayload)}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-violet-600 dark:text-violet-400 hover:underline"
                      dir="ltr"
                    >
                      ⬇ הורד (הטוב ביותר)
                    </a>
                    {statusPayload?.ugc_final_video_url?.trim() &&
                      statusPayload?.ugc_composited_video_url?.trim() && (
                        <a
                          href={statusPayload.ugc_composited_video_url.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-500 dark:text-slate-400 hover:underline"
                          dir="ltr"
                        >
                          גרסת FFmpeg
                        </a>
                      )}
                    {statusPayload?.ugc_raw_video_url?.trim() && (
                      <a
                        href={statusPayload.ugc_raw_video_url.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-500 dark:text-slate-400 hover:underline"
                        dir="ltr"
                      >
                        מקור מהספק
                      </a>
                    )}
                  </div>

                  {statusPayload?.ugc_status === 'completed' && (
                    <div className="rounded-xl border border-slate-200/90 dark:border-slate-700/90 bg-slate-50/80 dark:bg-slate-950/40 px-4 py-3 space-y-3">
                      <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        פורמטים נוספים (לפיד ולמחשב)
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        לאחר שהווידאו האנכי (9:16) מוכן, ניתן ליצור כאן גרסאות ריבועיות או אופקיות — ללא יצירה מחדש
                        ב-HeyGen.
                      </p>
                      <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                        {ugcFinal9_16 ? (
                          <a
                            href={ugcFinal9_16.startsWith('/') ? toAbsoluteApiUrl(ugcFinal9_16) : ugcFinal9_16}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded-lg border border-violet-300/80 dark:border-violet-700/60 bg-violet-50/90 dark:bg-violet-950/50 px-3 py-2 text-xs font-medium text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/40"
                            dir="ltr"
                          >
                            הורד MP4 (9:16)
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleUgcRerender('9:16')}
                            disabled={ugcPipelineBusy || rerenderSubmitting}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 min-h-[2.5rem]"
                          >
                            {formatAspectLoading('9:16') && (
                              <Spinner className="!size-3.5 border-violet-400/40 border-t-violet-600" />
                            )}
                            {formatAspectLoading('9:16') ? 'מייצר...' : 'צור גרסה 9:16'}
                          </button>
                        )}
                        {ugcFinal1_1 ? (
                          <a
                            href={ugcFinal1_1.startsWith('/') ? toAbsoluteApiUrl(ugcFinal1_1) : ugcFinal1_1}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded-lg border border-emerald-300/80 dark:border-emerald-700/60 bg-emerald-50/90 dark:bg-emerald-950/50 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                            dir="ltr"
                          >
                            הורד MP4 (1:1)
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleUgcRerender('1:1')}
                            disabled={ugcPipelineBusy || rerenderSubmitting}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 min-h-[2.5rem]"
                          >
                            {formatAspectLoading('1:1') && (
                              <Spinner className="!size-3.5 border-violet-400/40 border-t-violet-600" />
                            )}
                            {formatAspectLoading('1:1') ? 'מייצר...' : 'צור גרסה 1:1'}
                          </button>
                        )}
                        {ugcFinal16_9 ? (
                          <a
                            href={ugcFinal16_9.startsWith('/') ? toAbsoluteApiUrl(ugcFinal16_9) : ugcFinal16_9}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded-lg border border-sky-300/80 dark:border-sky-700/60 bg-sky-50/90 dark:bg-sky-950/50 px-3 py-2 text-xs font-medium text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/40"
                            dir="ltr"
                          >
                            הורד MP4 (16:9)
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleUgcRerender('16:9')}
                            disabled={ugcPipelineBusy || rerenderSubmitting}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 min-h-[2.5rem]"
                          >
                            {formatAspectLoading('16:9') && (
                              <Spinner className="!size-3.5 border-violet-400/40 border-t-violet-600" />
                            )}
                            {formatAspectLoading('16:9') ? 'מייצר...' : 'צור גרסה 16:9'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {Array.isArray(statusPayload?.ugc_script?.scenes) && statusPayload.ugc_script.scenes.length > 0 && (
                    <div className="mt-5 space-y-4 border-t border-slate-200 dark:border-slate-700 pt-5 text-right">
                      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        עריכה ורינדור מחדש (בלי HeyGen)
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        לוגו ותמונת מוצר נשלחים מהשדות בטופס משמאל (אם מולאו). ניתן לשנות מהירות, סגנון כתוביות ומיקום
                        ואז לרנדר שוב את שכבת הכיתוביות והעיצוב על אותו וידאו גלמי.
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                            מהירות וידאו
                          </label>
                          <select
                            value={String(rerenderSpeed)}
                            onChange={(ev) => setRerenderSpeed(Number(ev.target.value))}
                            disabled={rerenderSubmitting || ugcPipelineBusy}
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
                          >
                            {UGC_RERENDER_SPEEDS.map((opt) => (
                              <option key={opt.value} value={String(opt.value)}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                            סגנון אנימציה
                          </label>
                          <select
                            value={rerenderAnimation}
                            onChange={(ev) => setRerenderAnimation(ev.target.value)}
                            disabled={rerenderSubmitting || ugcPipelineBusy}
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
                          >
                            {UGC_RERENDER_ANIMATIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                            מיקום כתוביות
                          </label>
                          <select
                            value={rerenderPosition}
                            onChange={(ev) => setRerenderPosition(ev.target.value)}
                            disabled={rerenderSubmitting || ugcPipelineBusy}
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
                          >
                            {UGC_RERENDER_POSITIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                            גופן (פונט)
                          </label>
                          <select
                            value={rerenderFont}
                            onChange={(ev) => setRerenderFont(ev.target.value)}
                            disabled={rerenderSubmitting || ugcPipelineBusy}
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
                          >
                            {UGC_RERENDER_FONTS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                          צבע מותג <span className="text-slate-400 font-normal">(#RRGGBB, אופציונלי)</span>
                        </label>
                        <input
                          type="text"
                          value={draftBrandColor}
                          onChange={(ev) => setDraftBrandColor(ev.target.value)}
                          disabled={rerenderSubmitting || ugcPipelineBusy}
                          placeholder="#7C3AED"
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
                          dir="ltr"
                          maxLength={32}
                        />
                      </div>
                      {rerenderError && (
                        <div
                          role="alert"
                          className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200"
                        >
                          {rerenderError}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleUgcRerender()}
                        disabled={rerenderSubmitting || ugcPipelineBusy}
                        className="w-full rounded-xl border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/50 px-4 py-3 text-sm font-semibold text-violet-900 dark:text-violet-100 hover:bg-violet-100 dark:hover:bg-violet-900/40 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                      >
                        {(rerenderSubmitting || ugcPipelineBusy) && (
                          <Spinner className="!size-4 border-violet-400/40 border-t-violet-600" />
                        )}
                        {ugcPipelineBusy
                          ? 'מרנדר מחדש…'
                          : rerenderSubmitting
                            ? 'שולח…'
                            : `רינדור מחדש לגרסת ${activePreviewAspect || aspectRatio || '9:16'}`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
