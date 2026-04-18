import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api, { API_BASE_URL, API_BASE_URL_DISPLAY } from './api.js'
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
 *   1. ugc_final_video_url   — Remotion render: captions + animations (best)
 *   2. ugc_composited_video_url — FFmpeg blur-bg PiP (no captions)
 *   3. ugc_raw_video_url     — raw HeyGen/D-ID CDN URL
 */
function ugcPlaybackUrl(payload) {
  const f = typeof payload?.ugc_final_video_url === 'string' ? payload.ugc_final_video_url.trim() : ''
  const c = typeof payload?.ugc_composited_video_url === 'string' ? payload.ugc_composited_video_url.trim() : ''
  const r = typeof payload?.ugc_raw_video_url === 'string' ? payload.ugc_raw_video_url.trim() : ''
  return f || c || r || ''
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
    pending: 'UGC: ממתין…',
    scraped: 'UGC: נסרק…',
    generating_script: 'UGC: מכין תסריט…',
    generating_video: 'UGC: מייצר וידאו…',
    rendering_captions: 'UGC: מרנדר כתוביות…',
    completed: 'UGC: הושלם',
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
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [productImageUrl, setProductImageUrl] = useState('')
  const logoFileRef = useRef(null)
  const productFileRef = useRef(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [productUploading, setProductUploading] = useState(false)

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
      if (u) setUrl(u)
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
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 animate-pulse space-y-3">
                  <div className="h-4 w-1/3 rounded bg-slate-200 dark:bg-slate-700 ms-auto" />
                  <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800" />
                </div>
              )}

              {statusPayload?.ugc_script?.scenes?.length > 0 && (
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
                        רקע מטושטש (FFmpeg)
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

                  {/* 9:16 letterbox — centers horizontal videos inside a vertical frame */}
                  <div
                    className="relative mx-auto w-full max-w-[280px] overflow-hidden rounded-xl bg-black"
                    style={{ aspectRatio: '9/16' }}
                  >
                    <video
                      key={ugcPlaybackUrl(statusPayload)}
                      className="absolute inset-0 h-full w-full object-contain"
                      src={ugcPlaybackUrl(statusPayload)}
                      controls
                      playsInline
                      preload="metadata"
                    />
                  </div>

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
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
