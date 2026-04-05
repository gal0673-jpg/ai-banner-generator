import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { API_BASE_URL } from './api.js'
import { useAuth } from './AuthContext.jsx'
import BannerCanvas from './BannerCanvas.jsx'
import BannerCanvas2 from './BannerCanvas2.jsx'

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatStatus(status) {
  if (!status) return 'מתחיל…'
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
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const [url,           setUrl]           = useState('')
  const [brief,         setBrief]         = useState('')
  const [taskId,        setTaskId]        = useState(null)
  const [statusPayload, setStatusPayload] = useState(null)
  const [submitError,   setSubmitError]   = useState(null)
  const [isPosting,     setIsPosting]     = useState(false)
  const [aiContextBusy, setAiContextBusy] = useState(false)
  const [aiContextErr,  setAiContextErr]  = useState(null)
  const [activeDesign,  setActiveDesign]  = useState(1)

  const terminal  = statusPayload?.status === 'completed' || statusPayload?.status === 'failed'
  const isPolling = Boolean(taskId && !terminal)
  const completed =
    statusPayload?.status === 'completed' &&
    statusPayload?.background_url &&
    statusPayload?.logo_url

  useEffect(() => {
    if (!taskId) { setStatusPayload(null); return undefined }

    let alive = true
    let intervalId

    const tick = async () => {
      try {
        const { data } = await api.get(`/status/${taskId}`)
        if (!alive) return
        setStatusPayload(data)
        if (data.status === 'completed' || data.status === 'failed') clearInterval(intervalId)
      } catch (err) {
        if (!alive) return
        setStatusPayload({
          task_id: taskId, status: 'failed', error: axiosErrorMessage(err),
          headline: null, subhead: null, bullet_points: null,
          cta: null, brand_color: null, background_url: null, logo_url: null,
        })
        clearInterval(intervalId)
      }
    }

    tick()
    intervalId = setInterval(tick, 3000)
    return () => { alive = false; clearInterval(intervalId) }
  }, [taskId])

  const handleLogout = () => { logout(); navigate('/login', { replace: true }) }

  const isPrimaryAdmin = user?.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL

  const handleDownloadAiContext = useCallback(async () => {
    setAiContextErr(null)
    setAiContextBusy(true)
    try {
      const res = await api.get('/admin/ai-banner-context', { responseType: 'blob' })
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
      const { data } = await api.post('/generate', { url: trimmed, brief: brief.trim() || null })
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
    return (
      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 ${tone}`}>
        {isPolling && <Spinner className="!size-3.5 border-indigo-400/40 border-t-indigo-300" />}
        <span className="opacity-90">{formatStatus(s)}</span>
        <span className="font-mono uppercase tracking-wide opacity-70" dir="ltr">({s ?? '…'})</span>
      </span>
    )
  }, [taskId, statusPayload?.status, isPolling])

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
                {API_BASE_URL}
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
                {formatStatus(statusPayload?.status)}
              </p>
              <p className="text-xs text-slate-500 font-mono break-all" dir="ltr">
                מזהה משימה: {taskId}
              </p>

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

                  {/* ── Design tabs ───────────────────────────────────────── */}
                  <div>
                    {/* Tab bar */}
                    <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 p-1 mb-4 w-fit">
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

                    {/* Hint */}
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                      גרור אלמנטים, שנה גודל, לחץ על טקסט לעריכה ישירה
                    </p>

                    {/* Design 1 */}
                    {activeDesign === 1 && (
                      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl">
                        <BannerCanvas
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
                        />
                      </div>
                    )}

                    {/* Design 2 */}
                    {activeDesign === 2 && (
                      <div className="overflow-hidden rounded-2xl border border-slate-800 shadow-2xl">
                        <BannerCanvas2
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
                        />
                      </div>
                    )}
                  </div>

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
