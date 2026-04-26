import { ugcVideoTier } from './ugcHelpers.js'

export default function VideoPreview({
  statusPayload,
  ugcFinal9_16,
  ugcFinal1_1,
  ugcFinal16_9,
  activePreviewAspect,
  setActivePreviewAspect,
  effectivePreviewAspect,
  currentVideoUrl,
  aspectRatio,
}) {
  const tier = ugcVideoTier(statusPayload)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">וידאו</h3>
        {tier === 'final' && (
          <span className="rounded-full bg-violet-100 dark:bg-violet-950/70 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300 ring-1 ring-violet-200/80 dark:ring-violet-800/60">
            ✦ כתוביות + אנימציות
          </span>
        )}
        {tier === 'composited' && (
          <span className="rounded-full bg-sky-100 dark:bg-sky-950/70 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300 ring-1 ring-sky-200/80 dark:ring-sky-800/60">
            מלא מסך — FFmpeg (ללא כיתוביות)
          </span>
        )}
        {tier === 'raw' && (
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
    </div>
  )
}
