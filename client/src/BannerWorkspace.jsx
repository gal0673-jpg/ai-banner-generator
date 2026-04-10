import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { API_BASE_URL, API_BASE_URL_DISPLAY } from './api.js'
import { useAuth } from './AuthContext.jsx'
import BannerCanvas from './BannerCanvas.jsx'
import BannerCanvas2 from './BannerCanvas2.jsx'
import BannerCanvas3 from './BannerCanvas3.jsx'

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatStatus(status, { videoRendering = false } = {}) {
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

function axiosErrorMessage(err) {
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join(' ')
  return err.message || 'הבקשה נכשלה'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/80 p-6 animate-pulse space-y-4">
      <div className="h-4 w-1/3 rounded bg-slate-200 dark:bg-slate-700 ms-auto" />
      <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800" />
      <div className="h-3 w-5/6 rounded bg-slate-100 dark:bg-slate-800 ms-auto" />
      <div className="flex gap-3 pt-4">
        <div className="h-24 flex-1 rounded-xl bg-slate-100 dark:bg-slate-800" />
        <div className="h-24 flex-1 rounded-xl bg-slate-100 dark:bg-slate-800" />
      </div>
    </div>
  )
}

/** Must match api.SUPERUSER_EMAIL (primary admin only). */
const PRIMARY_ADMIN_EMAIL = 'gal0673@gmail.com'

const VIDEO_RENDERING_HINT =
  'הווידאו מיוצר ברקע — אפשר להמשיך לערוך את הבאנר. · Video is rendering in the background; you can keep editing.'

/** After "נתק מהמשימה", do not auto-load /banners/latest on refresh (stuck pending would return forever). */
const SKIP_LATEST_RESTORE_KEY = 'banner_workspace_skip_latest_restore'

/** D-ID sample portrait; stable for tests (see test_ugc.py). */
const UGC_DEFAULT_AVATAR_URL =
  'https://d-id-public-bucket.s3.us-west-2.amazonaws.com/alice.jpg'

function formatUgcStatus(ugcStatus) {
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

function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block size-5 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin ${className}`}
      aria-hidden
    />
  )
}

function readSkipLatestRestoreFlag() {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SKIP_LATEST_RESTORE_KEY) === '1'
  } catch {
    return false
  }
}

/** Renders UGC video script scenes (spoken + on-screen copy). */
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
              <span className="inline-flex items-center rounded-full bg-indigo-100 dark:bg-indigo-950/80 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-800 dark:text-indigo-200 ring-1 ring-indigo-200/80 dark:ring-indigo-800/60">
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


// ─── Main workspace ───────────────────────────────────────────────────────────

export default function BannerWorkspace() {
  const { user, logout, ready } = useAuth()
  const navigate = useNavigate()

  const [url,           setUrl]           = useState('')
  const [brief,         setBrief]         = useState('')
  const [customHook,    setCustomHook]    = useState('')
  const [taskId,        setTaskId]        = useState(null)
  const [statusPayload, setStatusPayload] = useState(null)
  const [submitError,   setSubmitError]   = useState(null)
  const [isPosting,     setIsPosting]     = useState(false)
  const [aiContextBusy, setAiContextBusy] = useState(false)
  const [aiContextErr,  setAiContextErr]  = useState(null)
  const [activeDesign,  setActiveDesign]  = useState(1)
  const [videoRenderError, setVideoRenderError] = useState(null)
  const [sseBump, setSseBump] = useState(0)
  const [videoHook,        setVideoHook]        = useState('')
  const [latestRestoreNonce, setLatestRestoreNonce] = useState(0)
  const [skipLatestRestore, setSkipLatestRestore] = useState(readSkipLatestRestoreFlag)
  const [ugcPanelOpen, setUgcPanelOpen] = useState(false)
  const [ugcCustomScript, setUgcCustomScript] = useState('')
  const [ugcPosting, setUgcPosting] = useState(false)
  const [ugcError, setUgcError] = useState(null)
  // Tracks the taskId for which we've already initialised videoHook from the
  // server, so that subsequent statusPayload updates don't overwrite user edits.
  const hookSyncedForTask = useRef(null)
  const taskIdRef = useRef(null)
  const terminalRef = useRef(false)
  const sseTerminalRef = useRef(false)

  useEffect(() => {
    taskIdRef.current = taskId
  }, [taskId])

  const bannerTerminal =
    statusPayload?.status === 'completed' || statusPayload?.status === 'failed'
  const ugcTerminal =
    statusPayload?.ugc_status === 'completed' || statusPayload?.ugc_status === 'failed'
  const terminal = bannerTerminal || ugcTerminal
  const isPolling = Boolean(taskId && !terminal)
  const videoRendering = statusPayload?.video_status === 'processing'
  const completed =
    statusPayload?.status === 'completed' &&
    statusPayload?.background_url &&
    statusPayload?.logo_url

  const squareVideoUrl = useMemo(() => {
    if (!statusPayload) return null
    const u =
      activeDesign === 3 ? statusPayload.video_url_3
      : activeDesign === 2 ? statusPayload.video_url_2
      : statusPayload.video_url_1
    return typeof u === 'string' && u.trim() ? u.trim() : null
  }, [statusPayload, activeDesign])

  const verticalVideoUrl = useMemo(() => {
    if (!statusPayload) return null
    const u =
      activeDesign === 3 ? statusPayload.video_url_3_vertical
      : activeDesign === 2 ? statusPayload.video_url_2_vertical
      : statusPayload.video_url_1_vertical
    return typeof u === 'string' && u.trim() ? u.trim() : null
  }, [statusPayload, activeDesign])

  useEffect(() => {
    terminalRef.current = terminal
  }, [terminal])

  // Restore latest banner task after refresh (same user session / cookie).
  useEffect(() => {
    if (!ready || !user) return undefined
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SKIP_LATEST_RESTORE_KEY) === '1') {
      return undefined
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/banners/latest')
        if (cancelled || !data?.task_id) return
        if (taskIdRef.current != null) return
        setTaskId(data.task_id)
        setStatusPayload(data)
        if (typeof data.url === 'string') setUrl(data.url)
        setBrief(typeof data.brief === 'string' ? data.brief : '')
        if (typeof data.video_hook === 'string' && data.video_hook.trim()) {
          setCustomHook(data.video_hook.trim())
        }
      } catch {
        /* not authenticated or network */
      }
    })()
    return () => { cancelled = true }
  }, [ready, user, latestRestoreNonce])

  const disconnectFromLatestTask = useCallback(() => {
    try {
      sessionStorage.setItem(SKIP_LATEST_RESTORE_KEY, '1')
    } catch {
      /* private mode */
    }
    setSkipLatestRestore(true)
    setTaskId(null)
    setStatusPayload(null)
    setSubmitError(null)
    setUgcError(null)
    setVideoRenderError(null)
    hookSyncedForTask.current = null
    setSseBump((n) => n + 1)
  }, [])

  const reconnectLatestTask = useCallback(() => {
    try {
      sessionStorage.removeItem(SKIP_LATEST_RESTORE_KEY)
    } catch {
      /* ignore */
    }
    setSkipLatestRestore(false)
    setTaskId(null)
    setStatusPayload(null)
    hookSyncedForTask.current = null
    setLatestRestoreNonce((n) => n + 1)
  }, [])

  // Poll on an interval whenever a task is loaded (covers banner pipeline, async video render, and SSE gaps).
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
      sseTerminalRef.current = false
      return undefined
    }

    sseTerminalRef.current = false
    // EventSource only accepts a URL; credentials follow same-origin rules (Vite proxy → cookies OK).
    const ssePath = `${API_BASE_URL}/status/${taskId}/stream`
    const sse = new EventSource(ssePath)

    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setStatusPayload(data)
        if (data.status === 'failed') {
          sseTerminalRef.current = true
          sse.close()
        }
      } catch {
        // ignore malformed frames
      }
    }

    sse.onerror = () => {
      if (sseTerminalRef.current) return
      // Do not close() or mark failed: let the browser reconnect, and polling covers gaps.
    }

    return () => { sse.close() }
  }, [taskId, sseBump])

  // Initialise videoHook from the server value exactly once per task (when the
  // task first arrives in a completed state).  After that we leave local state
  // alone so we don't clobber whatever the user has typed.
  useEffect(() => {
    if (completed && taskId && hookSyncedForTask.current !== taskId) {
      setVideoHook(statusPayload?.video_hook ?? '')
      hookSyncedForTask.current = taskId
    }
  }, [completed, taskId, statusPayload?.video_hook])

  const handleLogout = () => { logout(); navigate('/login', { replace: true }) }

  const handleTaskPersist = useCallback(async (partial, signal) => {
    if (!taskId || !partial) return
    try {
      const body = {}
      if (partial.headline !== undefined)      body.headline      = partial.headline
      if (partial.subhead !== undefined)       body.subhead       = partial.subhead
      if (partial.cta !== undefined)           body.cta           = partial.cta
      if (partial.bullet_points !== undefined) body.bullet_points = partial.bullet_points
      if (partial.video_hook !== undefined)    body.video_hook    = partial.video_hook
      if (partial.canvas_state !== undefined)  body.canvas_state  = partial.canvas_state
      if (Object.keys(body).length === 0) return
      // `signal` is an AbortSignal provided by useBannerCanvasState to cancel
      // in-flight PATCH requests when a newer edit supersedes them.
      const { data } = await api.patch(`/tasks/${taskId}`, body, { signal })
      setStatusPayload((p) =>
        p
          ? {
              ...p,
              headline:      data.headline      ?? p.headline,
              subhead:       data.subhead       ?? p.subhead,
              cta:           data.cta           ?? p.cta,
              bullet_points: data.bullet_points ?? p.bullet_points,
              video_hook:    data.video_hook    !== undefined ? data.video_hook : p.video_hook,
              canvas_state:  data.canvas_state  ?? p.canvas_state,
            }
          : p,
      )
    } catch (err) {
      // Axios throws CanceledError (code ERR_CANCELED) when the AbortSignal fires.
      // This is expected and not an error worth logging.
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError') return
      console.error('Auto-save failed', err)
    }
  }, [taskId])

  const isPrimaryAdmin = user?.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL

  const handleRenderVideo = useCallback(async (aspectRatioParam = '1:1') => {
    if (!taskId) return
    setVideoRenderError(null)
    try {
      const { data } = await api.post(`/tasks/${taskId}/render-video`, {
        design_type: activeDesign,
        aspect_ratio: aspectRatioParam,
      })
      if (data?.status === 'processing') {
        setStatusPayload((p) =>
          p
            ? {
                ...p,
                video_status: 'processing',
                video_render_error: null,
              }
            : p,
        )
        setSseBump((n) => n + 1)
      }
    } catch (err) {
      setVideoRenderError(axiosErrorMessage(err))
    }
  }, [taskId, activeDesign])

  const handleRenderVideo11  = useCallback(() => handleRenderVideo('1:1'),  [handleRenderVideo])
  const handleRenderVideo916 = useCallback(() => handleRenderVideo('9:16'), [handleRenderVideo])

  useEffect(() => {
    if (statusPayload?.video_status === 'failed' && statusPayload?.video_render_error) {
      setVideoRenderError(statusPayload.video_render_error)
    }
  }, [statusPayload?.video_status, statusPayload?.video_render_error])

  const prevVideoStatusRef = useRef(null)
  useEffect(() => {
    const v = statusPayload?.video_status
    const prev = prevVideoStatusRef.current
    if (prev === 'processing' && v !== 'processing' && v !== 'failed') {
      setVideoRenderError(null)
    }
    prevVideoStatusRef.current = v
  }, [statusPayload?.video_status])

  const handleDownloadAiContext = useCallback(async () => {
    setAiContextErr(null)
    setAiContextBusy(true)
    try {
      const res = await api.get('/admin/ai-banner-context', {
        responseType: 'blob',
        params: { _: Date.now() },
      })
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'ai-banner-context.txt'
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setAiContextErr(axiosErrorMessage(err))
    } finally {
      setAiContextBusy(false)
    }
  }, [])

  const handleGenerateUGC = async () => {
    const trimmed = url.trim()
    if (!trimmed) {
      setUgcError('נא להזין כתובת אתר.')
      return
    }
    setUgcError(null)
    setSubmitError(null)
    setStatusPayload(null)
    setTaskId(null)
    setUgcPosting(true)
    try {
      const body = {
        url: trimmed,
        provider: 'd-id',
        avatar_id: UGC_DEFAULT_AVATAR_URL,
        video_length: '30s',
        brief: brief.trim() || null,
      }
      const script = ugcCustomScript.trim()
      if (script) body.custom_script = script
      const { data } = await api.post('/generate-ugc', body)
      const id = data?.task_id
      if (!id) throw new Error('לא התקבל מזהה משימה מהשרת')
      try {
        sessionStorage.removeItem(SKIP_LATEST_RESTORE_KEY)
      } catch {
        /* ignore */
      }
      setSkipLatestRestore(false)
      setTaskId(id)
    } catch (err) {
      setUgcError(axiosErrorMessage(err))
    } finally {
      setUgcPosting(false)
    }
  }

  const handleGenerate = async (e) => {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) { setSubmitError('נא להזין כתובת אתר.'); return }

    setSubmitError(null)
    setUgcError(null)
    setStatusPayload(null)
    setTaskId(null)
    setIsPosting(true)

    try {
      const { data } = await api.post('/generate', {
        url: trimmed,
        brief: brief.trim() || null,
        video_hook: customHook.trim() || null,
      })
      const id = data?.task_id
      if (!id) throw new Error('לא התקבל מזהה משימה מהשרת')
      try {
        sessionStorage.removeItem(SKIP_LATEST_RESTORE_KEY)
      } catch {
        /* ignore */
      }
      setSkipLatestRestore(false)
      setTaskId(id)
    } catch (err) {
      setSubmitError(axiosErrorMessage(err))
    } finally {
      setIsPosting(false)
    }
  }

  const formLocked = isPosting || isPolling || ugcPosting

  const statusChip = useMemo(() => {
    const s = statusPayload?.status
    if (!taskId) return null
    const ugcS = statusPayload?.ugc_status
    const tone =
      s === 'failed' || ugcS === 'failed'
        ? 'bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/25'
        : s === 'completed' || ugcS === 'completed'
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25'
          : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-200 ring-indigo-500/25'
    const showSpinner = isPolling || videoRendering
    const label =
      ugcS && (s === 'pending' || !bannerTerminal)
        ? formatUgcStatus(ugcS)
        : formatStatus(s, { videoRendering })
    const codeHint =
      ugcS && (s === 'pending' || !bannerTerminal)
        ? `ugc:${ugcS ?? '…'}`
        : s === 'completed' && videoRendering
          ? `${s} · video:processing`
          : (s ?? '…')
    return (
      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 ${tone}`}>
        {showSpinner && <Spinner className="!size-3.5 border-indigo-400/40 border-t-indigo-300" />}
        <span className="opacity-90">{label}</span>
        <span className="font-mono uppercase tracking-wide opacity-70" dir="ltr">({codeHint})</span>
      </span>
    )
  }, [taskId, statusPayload?.status, statusPayload?.ugc_status, isPolling, videoRendering, bannerTerminal])

  const handleResetVideoRender = useCallback(async () => {
    if (!taskId) return
    try {
      const { data } = await api.post(`/tasks/${taskId}/video-render/reset`)
      setStatusPayload(data)
      setVideoRenderError(null)
    } catch (err) {
      setVideoRenderError(axiosErrorMessage(err))
    }
  }, [taskId])

  return (
    <div
      className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      dir="rtl"
      lang="he"
    >
      {/* ── Top nav ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[96%] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="text-start">
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              סטודיו באנרים
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              ייצור אוטומטי של קופי, ויז׳ואל ועיצובים מוכנים לייצוא
            </p>
          </div>
          <div className="flex items-center gap-3">
            {user?.email && (
              <span className="hidden text-sm text-slate-600 dark:text-slate-400 sm:inline max-w-[200px] truncate">
                {user.email}
              </span>
            )}
            {isPrimaryAdmin && (
              <button
                type="button"
                onClick={handleDownloadAiContext}
                disabled={aiContextBusy}
                className="rounded-lg border border-indigo-300/80 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-2 text-sm font-medium text-indigo-800 dark:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 disabled:opacity-50 transition"
                title="מייצר מחדש את הקובץ בשורש הפרויקט ומוריד אותו"
              >
                {aiContextBusy ? 'מייצא…' : 'הורד ai-banner-context'}
              </button>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              התנתקות
            </button>
          </div>
        </div>
        {isPrimaryAdmin && aiContextErr && (
          <div
            className="mx-auto max-w-[96%] px-4 pb-2 sm:px-6 text-end text-xs text-red-600 dark:text-red-400"
            role="alert"
          >
            {aiContextErr}
          </div>
        )}
      </header>

      {/* ── Two-column layout ────────────────────────────────────── */}
      <div className="mx-auto grid max-w-[96%] gap-6 px-4 py-6 lg:grid-cols-[minmax(300px,360px)_1fr] sm:px-6 lg:py-8">

        {/* ── Sidebar: form ─────────────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm text-right">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              יצירת באנר חדש
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              הזן כתובת אתר והמערכת תייצר עבורך באנר מותאם אישית.
            </p>

            {skipLatestRestore && !taskId && (
              <div className="mt-4 rounded-xl border border-amber-200/90 dark:border-amber-800/50 bg-amber-50/90 dark:bg-amber-950/25 px-3 py-3 text-xs text-amber-950 dark:text-amber-100 space-y-2">
                <p className="leading-relaxed">
                  המשימה האחרונה לא תיטען אוטומטית אחרי רענון (כדי שלא תיתקעו שוב על אותו מסך). אפשר ליצור באנר חדש, או לטעון שוב את המשימה מהשרת.
                </p>
                <button
                  type="button"
                  onClick={reconnectLatestTask}
                  className="w-full rounded-lg border border-amber-400/80 dark:border-amber-600 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100/80 dark:hover:bg-amber-900/40 transition"
                >
                  טען משימה אחרונה מהשרת
                </button>
              </div>
            )}

            <form className="mt-5 space-y-4" onSubmit={handleGenerate}>
              <div>
                <label
                  htmlFor="bw-url"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
                >
                  <span className="text-red-500">*</span> כתובת אתר (URL)
                </label>
                <input
                  id="bw-url"
                  name="url"
                  type="text"
                  required
                  placeholder="https://www.domein.co.il"
                  value={url}
                  onChange={(ev) => setUrl(ev.target.value)}
                  disabled={formLocked}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 transition"
                  autoComplete="url"
                />
              </div>

              <div>
                <label
                  htmlFor="bw-brief"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
                >
                  בריף / מטרת הקמפיין{' '}
                  <span className="text-slate-400 font-normal">(אופציונלי)</span>
                </label>
                <textarea
                  id="bw-brief"
                  name="brief"
                  rows={5}
                  placeholder="לדוגמה: הגדלת מכירות, קהל יעד צעיר, טון תקשורתי חברותי…"
                  value={brief}
                  onChange={(ev) => setBrief(ev.target.value)}
                  disabled={formLocked}
                  className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 min-h-[100px] transition"
                />
              </div>

              <div>
                <label
                  htmlFor="bw-custom-hook"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
                >
                  סלוגן פתיחה לווידאו{' '}
                  <span className="text-slate-400 font-normal">(אופציונלי)</span>
                </label>
                <input
                  id="bw-custom-hook"
                  name="video_hook"
                  type="text"
                  maxLength={256}
                  placeholder="לדוגמה: מבצע חסר תקדים!"
                  value={customHook}
                  onChange={(ev) => setCustomHook(ev.target.value)}
                  disabled={formLocked}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 transition"
                  dir="rtl"
                />
                <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                  אם מולא — יחליף את ה-hook שה-AI מייצר. ישמש כטקסט פתיחה של 2 שניות בסרטון.
                </p>
              </div>

              {submitError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200 text-right"
                >
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={formLocked}
                className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-900/20 hover:bg-indigo-500 disabled:opacity-50 disabled:pointer-events-none transition"
              >
                {isPosting ? 'מתחיל…' : isPolling ? 'העבודה רצה…' : 'צור באנר'}
              </button>
            </form>

            <div className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-5 space-y-3">
              <button
                type="button"
                onClick={() => setUgcPanelOpen((o) => !o)}
                className="w-full rounded-xl border border-violet-300/90 dark:border-violet-600/50 bg-violet-50/90 dark:bg-violet-950/40 px-4 py-2.5 text-sm font-semibold text-violet-900 dark:text-violet-100 hover:bg-violet-100/90 dark:hover:bg-violet-900/50 transition text-right"
                aria-expanded={ugcPanelOpen}
              >
                {ugcPanelOpen ? 'הסתר וידאו אווטאר UGC' : 'וידאו אווטאר UGC (D-ID)'}
              </button>

              {ugcPanelOpen && (
                <div className="rounded-xl border border-violet-200/80 dark:border-violet-800/50 bg-violet-50/40 dark:bg-violet-950/20 p-4 space-y-3">
                  <p className="text-[11px] text-violet-900/80 dark:text-violet-200/80 leading-relaxed">
                    יוצר סרטון דמות מדברת לפי כתובת האתר (סריקה + תסריט) או לפי תסריט מותאם אישית. ספק: D-ID.
                  </p>
                  <div>
                    <label
                      htmlFor="bw-ugc-custom-script"
                      className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
                    >
                      תסריט מותאם (Custom Script){' '}
                      <span className="text-slate-400 font-normal">(אופציונלי — דילוג על תסריט AI)</span>
                    </label>
                    <textarea
                      id="bw-ugc-custom-script"
                      name="ugc_custom_script"
                      rows={4}
                      maxLength={2000}
                      placeholder="הקלד כאן טקסט לדיבור — אם יישאר ריק, המערכת תייצר תסריט אוטומטית מהאתר."
                      value={ugcCustomScript}
                      onChange={(ev) => setUgcCustomScript(ev.target.value)}
                      disabled={formLocked}
                      className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60 min-h-[88px] transition"
                      dir="rtl"
                    />
                  </div>
                  {ugcError && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200 text-right"
                    >
                      {ugcError}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleGenerateUGC}
                    disabled={formLocked}
                    className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-violet-900/20 hover:bg-violet-500 disabled:opacity-50 disabled:pointer-events-none transition inline-flex items-center justify-center gap-2"
                  >
                    {ugcPosting && <Spinner className="!size-4 border-white/30 border-t-white" />}
                    {ugcPosting ? 'שולח…' : 'צור וידאו אווטאר'}
                  </button>
                </div>
              )}
            </div>

            <p className="mt-4 text-[10px] text-slate-400 dark:text-slate-500 text-right">
              כתובת API:{' '}
              <code className="rounded bg-slate-100 dark:bg-slate-800 px-1" dir="ltr">
                {API_BASE_URL_DISPLAY}
              </code>
            </p>
          </div>
        </aside>

        {/* ── Main area ─────────────────────────────────────────── */}
        <main className="min-h-[320px] space-y-6">
          {!taskId && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/50 dark:bg-slate-900/40 px-6 py-20 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
                הזן כתובת אתר ולחץ על &quot;צור באנר&quot;. ההתקדמות והתוצאה יופיעו כאן בזמן אמת.
              </p>
            </div>
          )}

          {taskId && (
            <section aria-live="polite" className="space-y-4 text-right">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  סטטוס משימה
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {statusChip}
                  <button
                    type="button"
                    onClick={disconnectFromLatestTask}
                    className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                  >
                    נתק מהמשימה (רענון לא יחזיר אותה)
                  </button>
                </div>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {statusPayload?.ugc_status &&
                (statusPayload?.status === 'pending' || !bannerTerminal)
                  ? formatUgcStatus(statusPayload.ugc_status)
                  : formatStatus(statusPayload?.status, { videoRendering })}
              </p>
              <p className="text-xs text-slate-500 font-mono break-all" dir="ltr">
                מזהה משימה: {taskId}
              </p>

              {videoRendering && (
                <div className="rounded-xl border border-amber-200/90 dark:border-amber-800/60 bg-amber-50/90 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-950 dark:text-amber-100 space-y-2">
                  <p className="leading-relaxed">
                    אם עצרת את ה-worker של Celery או שהייצור נתקע, השרת עדיין מסמן &quot;מייצר וידאו&quot;.
                    לחץ לאיפוס המצב בבסיס הנתונים ואז הפעל מחדש את ה-worker ונסה שוב לייצר וידאו.
                  </p>
                  <button
                    type="button"
                    onClick={handleResetVideoRender}
                    className="rounded-lg border border-amber-400/80 dark:border-amber-600 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100/80 dark:hover:bg-amber-900/40 transition"
                  >
                    אפס מצב ייצור וידאו
                  </button>
                </div>
              )}

              {isPolling && <StatusSkeleton />}

              {(statusPayload?.status === 'failed' || statusPayload?.ugc_status === 'failed') && (
                <div
                  role="alert"
                  className="rounded-2xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-900 dark:text-red-100 text-right"
                >
                  <strong className="font-semibold">משהו השתבש.</strong>
                  <p className="mt-1">
                    {statusPayload?.ugc_status === 'failed'
                      ? statusPayload.ugc_error || statusPayload.error || 'שגיאה ב-UGC'
                      : statusPayload.error || 'שגיאה לא ידועה'}
                  </p>
                </div>
              )}

              {statusPayload?.ugc_status === 'completed' &&
                typeof statusPayload?.ugc_raw_video_url === 'string' &&
                statusPayload.ugc_raw_video_url.trim() && (
                  <div className="rounded-2xl border border-violet-200 dark:border-violet-800/60 bg-gradient-to-b from-white to-violet-50/40 dark:from-slate-900 dark:to-violet-950/30 p-5 shadow-sm space-y-3">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      וידאו אווטאר UGC
                    </h3>
                    <div className="rounded-xl overflow-hidden border border-slate-200/80 dark:border-slate-700 bg-black/5 dark:bg-black/40">
                      <video
                        key={statusPayload.ugc_raw_video_url}
                        className="w-full h-auto max-h-[min(70vh,520px)] object-contain mx-auto"
                        src={statusPayload.ugc_raw_video_url.trim()}
                        controls
                        playsInline
                        preload="metadata"
                      >
                        הדפדפן שלך אינו תומך בנגן וידאו.
                      </video>
                    </div>
                    <a
                      href={statusPayload.ugc_raw_video_url.trim()}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline"
                      dir="ltr"
                    >
                      הורד וידאו
                    </a>
                  </div>
                )}

              {/* UGC script while banner pipeline not yet completed (e.g. UGC-only or mid-run) */}
              {!completed &&
                statusPayload?.ugc_script &&
                Array.isArray(statusPayload.ugc_script.scenes) &&
                statusPayload.ugc_script.scenes.length > 0 && (
                  <details className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
                    <summary className="cursor-pointer select-none px-5 py-3.5 text-sm font-semibold text-slate-700 dark:text-slate-200 list-none flex items-center justify-between gap-2">
                      <span>תסריט וידאו — UGC Script</span>
                      <span className="text-slate-400 text-xs font-normal">לחץ לפתיחה</span>
                    </summary>
                    <div className="px-5 pb-5 border-t border-slate-100 dark:border-slate-800">
                      <p className="text-xs text-slate-500 dark:text-slate-400 pt-3 mb-1 leading-relaxed">
                        תסריט שנוצר לווידאו UGC — דיבור (TTS) וטקסט גרפי לכל סצנה.
                      </p>
                      <UgcScriptScenesBody scenes={statusPayload.ugc_script.scenes} />
                    </div>
                  </details>
                )}

              {completed && (
                <div className="space-y-6">

                  {/* ── Design + Aspect-ratio controls ────────────────────── */}
                  <div>
                    {/* Row: Design tabs + Aspect ratio toggle */}
                    <div className="flex flex-wrap items-center gap-3 mb-4">

                      {/* Design tabs */}
                      <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 p-1">
                        {[
                          { id: 1, label: 'עיצוב 1', sub: 'Split Panel' },
                          { id: 2, label: 'עיצוב 2', sub: 'Immersive' },
                          { id: 3, label: 'עיצוב 3', sub: 'Minimal Card' },
                        ].map(({ id, label, sub }) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setActiveDesign(id)}
                            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                              activeDesign === id
                                ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                            }`}
                          >
                            {label}
                            <span className={`text-[10px] font-normal rounded-full px-1.5 py-0.5 ${
                              activeDesign === id
                                ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300'
                                : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
                            }`}>
                              {sub}
                            </span>
                          </button>
                        ))}
                      </div>

                    </div>

                    {/* Hint */}
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                      גרור אלמנטים, שנה גודל, לחץ על טקסט לעריכה ישירה
                    </p>

                    {/* ── Video Hook ──────────────────────────────────────── */}
                    <div className="mb-4 rounded-2xl border border-amber-200/80 dark:border-amber-700/40 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3.5 space-y-2">
                      <label
                        htmlFor="bw-video-hook"
                        className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300 tracking-wide"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                          <polygon points="23 7 16 12 23 17 23 7" />
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                        </svg>
                        סלוגן פתיחה לווידאו
                        <span className="font-normal text-amber-600/80 dark:text-amber-400/70">(video hook – אופציונלי)</span>
                      </label>
                      <p className="text-[11px] text-amber-700/60 dark:text-amber-400/60 leading-relaxed">
                        טקסט קצר ופוצץ שיופיע 2 שניות בתחילת הסרטון לפני הבאנר הראשי.
                      </p>
                      <input
                        id="bw-video-hook"
                        type="text"
                        maxLength={256}
                        placeholder="לדוגמה: אל תחמיצו את המבצע!"
                        value={videoHook}
                        onChange={(e) => setVideoHook(e.target.value)}
                        onBlur={() => handleTaskPersist({ video_hook: videoHook })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur()
                          }
                        }}
                        className="w-full rounded-xl border border-amber-200 dark:border-amber-700/50 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-right outline-none focus:border-amber-400 dark:focus:border-amber-500 focus:ring-2 focus:ring-amber-400/20 transition placeholder:text-slate-400 dark:placeholder:text-slate-600"
                        dir="rtl"
                      />
                    </div>

                    {/* Design 1 */}
                    {activeDesign === 1 && (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        <div>
                          <h3 className="text-center text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">
                            Feed (1:1)
                          </h3>
                          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl">
                            <BannerCanvas
                              key={`${taskId}-d1-11`}
                              apiBase={API_BASE_URL}
                              taskId={taskId}
                              backgroundUrl={statusPayload.background_url}
                              logoUrl={statusPayload.logo_url}
                              headline={statusPayload.headline}
                              subhead={statusPayload.subhead}
                              bulletPoints={statusPayload.bullet_points}
                              cta={statusPayload.cta}
                              brandColor={statusPayload.brand_color}
                              siteUrl={url}
                              savedCanvasSlice={statusPayload.canvas_state?.design1 ?? null}
                              onPersist={handleTaskPersist}
                              onRenderVideo={handleRenderVideo11}
                              isRenderingVideo={videoRendering}
                              videoRenderingHint={VIDEO_RENDERING_HINT}
                              aspectRatio="1:1"
                            />
                          </div>
                        </div>
                        <div>
                          <h3 className="text-center text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">
                            Story / Reels (9:16)
                          </h3>
                          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl">
                            <BannerCanvas
                              key={`${taskId}-d1-916`}
                              apiBase={API_BASE_URL}
                              taskId={taskId}
                              backgroundUrl={statusPayload.background_url}
                              logoUrl={statusPayload.logo_url}
                              headline={statusPayload.headline}
                              subhead={statusPayload.subhead}
                              bulletPoints={statusPayload.bullet_points}
                              cta={statusPayload.cta}
                              brandColor={statusPayload.brand_color}
                              siteUrl={url}
                              savedCanvasSlice={statusPayload.canvas_state?.design1_vertical ?? null}
                              onPersist={handleTaskPersist}
                              onRenderVideo={handleRenderVideo916}
                              isRenderingVideo={videoRendering}
                              videoRenderingHint={VIDEO_RENDERING_HINT}
                              aspectRatio="9:16"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Design 2 */}
                    {activeDesign === 2 && (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        <div>
                          <h3 className="text-center text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">
                            Feed (1:1)
                          </h3>
                          <div className="rounded-2xl border border-slate-800 shadow-2xl">
                            <BannerCanvas2
                              key={`${taskId}-d2-11`}
                              apiBase={API_BASE_URL}
                              taskId={taskId}
                              backgroundUrl={statusPayload.background_url}
                              logoUrl={statusPayload.logo_url}
                              headline={statusPayload.headline}
                              subhead={statusPayload.subhead}
                              bulletPoints={statusPayload.bullet_points}
                              cta={statusPayload.cta}
                              brandColor={statusPayload.brand_color}
                              siteUrl={url}
                              savedCanvasSlice={statusPayload.canvas_state?.design2 ?? null}
                              onPersist={handleTaskPersist}
                              onRenderVideo={handleRenderVideo11}
                              isRenderingVideo={videoRendering}
                              videoRenderingHint={VIDEO_RENDERING_HINT}
                              aspectRatio="1:1"
                            />
                          </div>
                        </div>
                        <div>
                          <h3 className="text-center text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">
                            Story / Reels (9:16)
                          </h3>
                          <div className="rounded-2xl border border-slate-800 shadow-2xl">
                            <BannerCanvas2
                              key={`${taskId}-d2-916`}
                              apiBase={API_BASE_URL}
                              taskId={taskId}
                              backgroundUrl={statusPayload.background_url}
                              logoUrl={statusPayload.logo_url}
                              headline={statusPayload.headline}
                              subhead={statusPayload.subhead}
                              bulletPoints={statusPayload.bullet_points}
                              cta={statusPayload.cta}
                              brandColor={statusPayload.brand_color}
                              siteUrl={url}
                              savedCanvasSlice={statusPayload.canvas_state?.design2_vertical ?? null}
                              onPersist={handleTaskPersist}
                              onRenderVideo={handleRenderVideo916}
                              isRenderingVideo={videoRendering}
                              videoRenderingHint={VIDEO_RENDERING_HINT}
                              aspectRatio="9:16"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Design 3 */}
                    {activeDesign === 3 && (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        <div>
                          <h3 className="text-center text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">
                            Feed (1:1)
                          </h3>
                          <div className="rounded-2xl border border-slate-200 shadow-2xl">
                            <BannerCanvas3
                              key={`${taskId}-d3-11`}
                              apiBase={API_BASE_URL}
                              taskId={taskId}
                              backgroundUrl={statusPayload.background_url}
                              logoUrl={statusPayload.logo_url}
                              headline={statusPayload.headline}
                              subhead={statusPayload.subhead}
                              bulletPoints={statusPayload.bullet_points}
                              cta={statusPayload.cta}
                              brandColor={statusPayload.brand_color}
                              siteUrl={url}
                              savedCanvasSlice={statusPayload.canvas_state?.design3 ?? null}
                              onPersist={handleTaskPersist}
                              onRenderVideo={handleRenderVideo11}
                              isRenderingVideo={videoRendering}
                              videoRenderingHint={VIDEO_RENDERING_HINT}
                              aspectRatio="1:1"
                            />
                          </div>
                        </div>
                        <div>
                          <h3 className="text-center text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">
                            Story / Reels (9:16)
                          </h3>
                          <div className="rounded-2xl border border-slate-200 shadow-2xl">
                            <BannerCanvas3
                              key={`${taskId}-d3-916`}
                              apiBase={API_BASE_URL}
                              taskId={taskId}
                              backgroundUrl={statusPayload.background_url}
                              logoUrl={statusPayload.logo_url}
                              headline={statusPayload.headline}
                              subhead={statusPayload.subhead}
                              bulletPoints={statusPayload.bullet_points}
                              cta={statusPayload.cta}
                              brandColor={statusPayload.brand_color}
                              siteUrl={url}
                              savedCanvasSlice={statusPayload.canvas_state?.design3_vertical ?? null}
                              onPersist={handleTaskPersist}
                              onRenderVideo={handleRenderVideo916}
                              isRenderingVideo={videoRendering}
                              videoRenderingHint={VIDEO_RENDERING_HINT}
                              aspectRatio="9:16"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {videoRenderError && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200 text-right"
                    >
                      {videoRenderError}
                    </div>
                  )}

                  {(squareVideoUrl || verticalVideoUrl) ? (
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-gradient-to-b from-white to-slate-50 dark:from-slate-900 dark:to-slate-950 p-5 shadow-sm space-y-4">
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        סרטון אנימציה
                        <span className="text-slate-400 font-normal ms-2">(עיצוב {activeDesign})</span>
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {squareVideoUrl && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Feed (1:1)</p>
                              <a
                                href={squareVideoUrl}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                                dir="ltr"
                              >
                                הורד MP4
                              </a>
                            </div>
                            <div className="rounded-xl overflow-hidden border border-slate-200/80 dark:border-slate-700 bg-black/5 dark:bg-black/40">
                              <video
                                key={squareVideoUrl}
                                className="w-full h-auto max-h-[min(60vh,480px)] object-contain"
                                src={squareVideoUrl}
                                controls
                                playsInline
                                loop
                                preload="metadata"
                              >
                                הדפדפן שלך אינו תומך בנגן וידאו.
                              </video>
                            </div>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono break-all text-center" dir="ltr">
                              {squareVideoUrl}
                            </p>
                          </div>
                        )}
                        {verticalVideoUrl && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Story / Reels (9:16)</p>
                              <a
                                href={verticalVideoUrl}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                                dir="ltr"
                              >
                                הורד MP4
                              </a>
                            </div>
                            <div className="rounded-xl overflow-hidden border border-slate-200/80 dark:border-slate-700 bg-black/5 dark:bg-black/40">
                              <video
                                key={verticalVideoUrl}
                                className="w-full h-auto max-h-[min(60vh,480px)] object-contain"
                                src={verticalVideoUrl}
                                controls
                                playsInline
                                loop
                                preload="metadata"
                              >
                                הדפדפן שלך אינו תומך בנגן וידאו.
                              </video>
                            </div>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono break-all text-center" dir="ltr">
                              {verticalVideoUrl}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {/* ── Copy metadata (collapsible reference) ─────────────── */}
                  <details className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
                    <summary className="cursor-pointer select-none px-5 py-3.5 text-sm font-semibold text-slate-700 dark:text-slate-200 list-none flex items-center justify-between gap-2">
                      <span>קופי שנוצר</span>
                      <span className="text-slate-400 text-xs font-normal">לחץ לפתיחה</span>
                    </summary>
                    <div className="px-5 pb-5">
                      <dl className="grid gap-4 sm:grid-cols-2 text-sm pt-2 border-t border-slate-100 dark:border-slate-800">
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-slate-500">כותרת ראשית</dt>
                          <dd className="mt-1 font-medium text-slate-900 dark:text-white" dir="rtl">{statusPayload.headline}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-slate-500">כותרת משנה</dt>
                          <dd className="mt-1 text-slate-700 dark:text-slate-300" dir="rtl">{statusPayload.subhead}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs uppercase tracking-wide text-slate-500">נקודות מפתח</dt>
                          <dd className="mt-2">
                            <ul className="list-disc list-inside space-y-1 text-slate-700 dark:text-slate-300" dir="rtl">
                              {(statusPayload.bullet_points || []).map((b, i) => <li key={i}>{b}</li>)}
                            </ul>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-slate-500">קריאה לפעולה</dt>
                          <dd className="mt-1 font-medium text-slate-900 dark:text-white" dir="rtl">{statusPayload.cta}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-slate-500">צבע מותג</dt>
                          <dd className="mt-1 flex items-center gap-2 flex-row-reverse justify-end">
                            <span
                              className="inline-block size-6 rounded-md border border-slate-200 dark:border-slate-600 shadow-inner"
                              style={{ backgroundColor: statusPayload.brand_color || '#ccc' }}
                              title={statusPayload.brand_color}
                            />
                            <code className="text-xs" dir="ltr">{statusPayload.brand_color}</code>
                          </dd>
                        </div>
                      </dl>

                      {statusPayload.ugc_script &&
                        Array.isArray(statusPayload.ugc_script.scenes) &&
                        statusPayload.ugc_script.scenes.length > 0 && (
                          <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800">
                            <details className="rounded-xl border border-slate-200/90 dark:border-slate-700/90 bg-slate-50/50 dark:bg-slate-950/40 overflow-hidden">
                              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 list-none flex items-center justify-between gap-2">
                                <span>תסריט וידאו — UGC Script</span>
                                <span className="text-slate-400 text-xs font-normal">לחץ לפתיחה</span>
                              </summary>
                              <div className="px-4 pb-4 border-t border-slate-200/80 dark:border-slate-700/80 bg-white/60 dark:bg-slate-900/40">
                                <p className="text-xs text-slate-500 dark:text-slate-400 pt-3 mb-2 leading-relaxed">
                                  דיבור (תמליל ל־TTS) וטקסט על המסך לכל סצנה.
                                </p>
                                <UgcScriptScenesBody scenes={statusPayload.ugc_script.scenes} />
                              </div>
                            </details>
                          </div>
                        )}
                    </div>
                  </details>

                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
