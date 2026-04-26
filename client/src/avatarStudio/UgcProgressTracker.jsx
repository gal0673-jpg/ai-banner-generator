import { UGC_STATUS_PROGRESS, VIDEO_LENGTH_TOTAL_MINUTES } from './ugcConstants.js'
import { formatUgcStatus } from './ugcHelpers.js'

export default function UgcProgressTracker({ statusPayload, videoLength }) {
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
