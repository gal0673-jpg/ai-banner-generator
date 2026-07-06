/**
 * Stateless presentational components for BannerWorkspace.
 * Helper functions (non-JSX) live in ``helpers.js``.
 */


export function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block size-5 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin ${className}`}
      aria-hidden
    />
  )
}


export function StatusSkeleton() {
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


/** UGC script scenes renderer (spoken + on-screen copy per scene). */
export function UgcScriptScenesBody({ scenes }) {
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
