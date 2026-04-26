import { useMemo } from 'react'
import { toAbsoluteApiUrl } from '../api.js'
import {
  UGC_RERENDER_ANIMATIONS,
  UGC_RERENDER_FONTS,
  UGC_RERENDER_POSITIONS,
  UGC_RERENDER_SPEEDS,
} from './ugcConstants.js'
import { formatUgcStatus, ugcPlaybackUrl } from './ugcHelpers.js'
import Spinner from './Spinner.jsx'
import UgcProgressTracker from './UgcProgressTracker.jsx'
import UgcScriptScenesBody from './UgcScriptScenesBody.jsx'
import VideoPreview from './VideoPreview.jsx'

export default function StatusPanel({
  taskId,
  statusPayload,
  videoLength,
  isPolling,
  bannerTerminal,
  ugcForm,
}) {
  const {
    activePreviewAspect,
    setActivePreviewAspect,
    aspectRatio,
    currentVideoUrl,
    effectivePreviewAspect,
    formatAspectLoading,
    handleUgcRerender,
    rerenderSpeed,
    setRerenderSpeed,
    rerenderAnimation,
    setRerenderAnimation,
    rerenderPosition,
    setRerenderPosition,
    rerenderFont,
    setRerenderFont,
    draftBrandColor,
    setDraftBrandColor,
    rerenderSubmitting,
    rerenderError,
    ugcFinal9_16,
    ugcFinal1_1,
    ugcFinal16_9,
    ugcPipelineBusy,
  } = ugcForm

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
    const label = ugcS && (s === 'pending' || !bannerTerminal) ? formatUgcStatus(ugcS) : (s ?? '…')
    return (
      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 ${tone}`}>
        {showSpinner && <Spinner className="!size-3.5 border-violet-400/40 border-t-violet-300" />}
        <span className="opacity-90">{label}</span>
      </span>
    )
  }, [taskId, statusPayload?.status, statusPayload?.ugc_status, isPolling, bannerTerminal])

  return (
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

      {isPolling && <UgcProgressTracker statusPayload={statusPayload} videoLength={videoLength} />}

      {statusPayload?.ugc_script?.scenes?.length > 0 && statusPayload?.ugc_status !== 'completed' && (
        <details className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm open:pb-2">
          <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold">תסריט (סצנות)</summary>
          <div className="px-5 pb-4 border-t border-slate-100 dark:border-slate-800 pt-3">
            <UgcScriptScenesBody scenes={statusPayload.ugc_script.scenes} />
          </div>
        </details>
      )}

      {statusPayload?.ugc_status === 'completed' && ugcPlaybackUrl(statusPayload) && (
        <div className="rounded-2xl border border-violet-200 dark:border-violet-800/60 bg-white dark:bg-slate-900 p-5 space-y-3">
          <VideoPreview
            statusPayload={statusPayload}
            ugcFinal9_16={ugcFinal9_16}
            ugcFinal1_1={ugcFinal1_1}
            ugcFinal16_9={ugcFinal16_9}
            activePreviewAspect={activePreviewAspect}
            setActivePreviewAspect={setActivePreviewAspect}
            effectivePreviewAspect={effectivePreviewAspect}
            currentVideoUrl={currentVideoUrl}
            aspectRatio={aspectRatio}
          />

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
            {statusPayload?.ugc_final_video_url?.trim() && statusPayload?.ugc_composited_video_url?.trim() && (
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
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">פורמטים נוספים (לפיד ולמחשב)</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                לאחר שהווידאו האנכי (9:16) מוכן, ניתן ליצור כאן גרסאות ריבועיות או אופקיות — ללא יצירה מחדש ב-HeyGen.
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
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">עריכה ורינדור מחדש (בלי HeyGen)</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                לוגו ותמונת מוצר נשלחים מהשדות בטופס משמאל (אם מולאו). ניתן לשנות מהירות, סגנון כתוביות ומיקום ואז לרנדר שוב את
                שכבת הכיתוביות והעיצוב על אותו וידאו גלמי.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">מהירות וידאו</label>
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
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">סגנון אנימציה</label>
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
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">מיקום כתוביות</label>
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
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">גופן (פונט)</label>
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
                {ugcPipelineBusy ? 'מרנדר מחדש…' : rerenderSubmitting ? 'שולח…' : `רינדור מחדש לגרסת ${activePreviewAspect || aspectRatio || '9:16'}`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
