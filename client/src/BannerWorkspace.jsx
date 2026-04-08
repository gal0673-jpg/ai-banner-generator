import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { API_BASE_URL, API_BASE_URL_DISPLAY } from './api.js'
import { useAuth } from './AuthContext.jsx'
import BannerCanvas from './BannerCanvas.jsx'
import BannerCanvas2 from './BannerCanvas2.jsx'

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

function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block size-5 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin ${className}`}
      aria-hidden
    />
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
  const [aspectRatio,   setAspectRatio]   = useState('1:1')
  const [videoRenderError, setVideoRenderError] = useState(null)
  const [sseBump, setSseBump] = useState(0)
  const [videoHook,        setVideoHook]        = useState('')
  // Tracks the taskId for which we've already initialised videoHook from the
  // server, so that subsequent statusPayload updates don't overwrite user edits.
  const hookSyncedForTask = useRef(null)
  const taskIdRef = useRef(null)
  const terminalRef = useRef(false)
  const sseTerminalRef = useRef(false)

  useEffect(() => {
    taskIdRef.current = taskId
  }, [taskId])

  const terminal  = statusPayload?.status === 'completed' || statusPayload?.status === 'failed'
  const isPolling = Boolean(taskId && !terminal)
  const videoRendering = statusPayload?.video_status === 'processing'
  const completed =
    statusPayload?.status === 'completed' &&
    statusPayload?.background_url &&
    statusPayload?.logo_url

  const currentVideoUrl = useMemo(() => {
    if (!statusPayload) return null
    let u
    if (aspectRatio === '9:16') {
      u = activeDesign === 1 ? statusPayload.video_url_1_vertical : statusPayload.video_url_2_vertical
    } else {
      u = activeDesign === 1 ? statusPayload.video_url_1 : statusPayload.video_url_2
    }
    return typeof u === 'string' && u.trim() ? u.trim() : null
  }, [statusPayload, activeDesign, aspectRatio])

  useEffect(() => {
    terminalRef.current = terminal
  }, [terminal])

  // Restore latest banner task after refresh (same user session / cookie).
  useEffect(() => {
    if (!ready || !user) return undefined
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
  }, [ready, user])

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
    const sse = new EventSource(
      `${API_BASE_URL}/status/${taskId}/stream`,
      { withCredentials: true },
    )

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

  const handleTaskPersist = useCallback(async (partial) => {
    if (!taskId || !partial) return
    try {
      const body = {}
      if (partial.headline !== undefined)     body.headline     = partial.headline
      if (partial.subhead !== undefined)      body.subhead      = partial.subhead
      if (partial.cta !== undefined)          body.cta          = partial.cta
      if (partial.bullet_points !== undefined) body.bullet_points = partial.bullet_points
      if (partial.video_hook !== undefined)   body.video_hook   = partial.video_hook
      if (partial.canvas_state !== undefined) body.canvas_state = partial.canvas_state
      if (Object.keys(body).length === 0) return
      const { data } = await api.patch(`/tasks/${taskId}`, body)
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
      console.error('Auto-save failed', err)
    }
  }, [taskId])

  const isPrimaryAdmin = user?.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL

  const handleRenderVideo = useCallback(async () => {
    if (!taskId) return
    setVideoRenderError(null)
    try {
      const { data } = await api.post(`/tasks/${taskId}/render-video`, {
        design_type: activeDesign,
        aspect_ratio: aspectRatio,
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
  }, [taskId, activeDesign, aspectRatio])

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

  const handleGenerate = async (e) => {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) { setSubmitError('נא להזין כתובת אתר.'); return }

    setSubmitError(null)
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
      setTaskId(id)
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
    const tone =
      s === 'failed'      ? 'bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/25'
      : s === 'completed' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25'
      : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-200 ring-indigo-500/25'
    const showSpinner = isPolling || videoRendering
    const codeHint =
      s === 'completed' && videoRendering ? `${s} · video:processing` : (s ?? '…')
    return (
      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 ${tone}`}>
        {showSpinner && <Spinner className="!size-3.5 border-indigo-400/40 border-t-indigo-300" />}
        <span className="opacity-90">{formatStatus(s, { videoRendering })}</span>
        <span className="font-mono uppercase tracking-wide opacity-70" dir="ltr">({codeHint})</span>
      </span>
    )
  }, [taskId, statusPayload?.status, isPolling, videoRendering])

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
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
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
            className="mx-auto max-w-7xl px-4 pb-2 sm:px-6 text-end text-xs text-red-600 dark:text-red-400"
            role="alert"
          >
            {aiContextErr}
          </div>
        )}
      </header>

      {/* ── Two-column layout ────────────────────────────────────── */}
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(280px,340px)_1fr] sm:px-6 lg:py-8">

        {/* ── Sidebar: form ─────────────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm text-right">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              יצירת באנר חדש
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              הזן כתובת אתר והמערכת תייצר עבורך באנר מותאם אישית.
            </p>

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
                {statusChip}
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {formatStatus(statusPayload?.status, { videoRendering })}
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

              {statusPayload?.status === 'failed' && (
                <div
                  role="alert"
                  className="rounded-2xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-900 dark:text-red-100 text-right"
                >
                  <strong className="font-semibold">משהו השתבש.</strong>
                  <p className="mt-1">{statusPayload.error || 'שגיאה לא ידועה'}</p>
                </div>
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

                      {/* Aspect ratio toggle */}
                      <div
                        className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 p-1"
                        role="group"
                        aria-label="פורמט תמונה"
                      >
                        {[
                          {
                            ratio: '1:1',
                            label: '1:1',
                            sub: 'פיד',
                            icon: (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0">
                                <rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                              </svg>
                            ),
                          },
                          {
                            ratio: '9:16',
                            label: '9:16',
                            sub: 'סטורי',
                            icon: (
                              <svg width="10" height="14" viewBox="0 0 10 14" fill="none" aria-hidden className="shrink-0">
                                <rect x="1" y="1" width="8" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                              </svg>
                            ),
                          },
                        ].map(({ ratio, label, sub, icon }) => (
                          <button
                            key={ratio}
                            type="button"
                            onClick={() => setAspectRatio(ratio)}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                              aspectRatio === ratio
                                ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                            }`}
                          >
                            {icon}
                            <span dir="ltr" className="font-mono tracking-tight">{label}</span>
                            <span className={`text-[9px] font-normal rounded-full px-1.5 py-0.5 hidden sm:inline ${
                              aspectRatio === ratio
                                ? 'bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-300'
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
                      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl">
                        <BannerCanvas
                          key={`${taskId}-d1-${aspectRatio}`}
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
                          savedCanvasSlice={
                            aspectRatio === '9:16'
                              ? (statusPayload.canvas_state?.design1_vertical ?? null)
                              : (statusPayload.canvas_state?.design1 ?? null)
                          }
                          onPersist={handleTaskPersist}
                          onRenderVideo={handleRenderVideo}
                          isRenderingVideo={videoRendering}
                          videoRenderingHint={VIDEO_RENDERING_HINT}
                          aspectRatio={aspectRatio}
                        />
                      </div>
                    )}

                    {/* Design 2 */}
                    {activeDesign === 2 && (
                      <div className="overflow-hidden rounded-2xl border border-slate-800 shadow-2xl">
                        <BannerCanvas2
                          key={`${taskId}-d2-${aspectRatio}`}
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
                          savedCanvasSlice={
                            aspectRatio === '9:16'
                              ? (statusPayload.canvas_state?.design2_vertical ?? null)
                              : (statusPayload.canvas_state?.design2 ?? null)
                          }
                          onPersist={handleTaskPersist}
                          onRenderVideo={handleRenderVideo}
                          isRenderingVideo={videoRendering}
                          videoRenderingHint={VIDEO_RENDERING_HINT}
                          aspectRatio={aspectRatio}
                        />
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

                  {currentVideoUrl ? (
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-gradient-to-b from-white to-slate-50 dark:from-slate-900 dark:to-slate-950 p-5 shadow-sm space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                          סרטון אנימציה
                          <span className="text-slate-400 font-normal ms-2">
                            (עיצוב {activeDesign}
                            {aspectRatio === '9:16' && <span className="ms-1 text-violet-500 dark:text-violet-400">· 9:16</span>}
                            )
                          </span>
                        </h3>
                        <a
                          href={currentVideoUrl}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                          dir="ltr"
                        >
                          הורד MP4
                        </a>
                      </div>
                      <div className="rounded-xl overflow-hidden border border-slate-200/80 dark:border-slate-700 bg-black/5 dark:bg-black/40 max-w-lg mx-auto">
                        <video
                          key={currentVideoUrl}
                          className="w-full h-auto max-h-[min(70vh,520px)] object-contain"
                          src={currentVideoUrl}
                          controls
                          playsInline
                          loop
                          preload="metadata"
                        >
                          הדפדפן שלך אינו תומך בנגן וידאו.
                        </video>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono break-all text-center" dir="ltr">
                        {currentVideoUrl}
                      </p>
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
