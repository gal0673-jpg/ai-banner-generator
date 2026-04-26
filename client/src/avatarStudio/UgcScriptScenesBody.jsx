export default function UgcScriptScenesBody({ scenes }) {
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
