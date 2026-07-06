import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'
import StatusPanel from './avatarStudio/StatusPanel.jsx'
import UgcForm from './avatarStudio/UgcForm.jsx'
import { useTaskPolling } from './avatarStudio/useTaskPolling.js'
import { useUgcFormState } from './avatarStudio/useUgcFormState.js'

export default function AvatarStudio() {
  const { user, logout, credits, refreshCredits } = useAuth()
  const navigate = useNavigate()
  // /auth/me returns is_superuser (any super) and is_primary_admin (the
  // bootstrapped account). The catalog link only needs superuser; the AI-context
  // export needs the primary admin (matches server-side require_primary_admin).
  const isSuperuser = Boolean(user?.isSuperuser)

  const [taskId, setTaskId] = useState(null)
  const { statusPayload, bannerTerminal, isPolling } = useTaskPolling(taskId)

  const ugcForm = useUgcFormState({ taskId, statusPayload, isPolling })

  const onFormSubmit = async (e) => {
    // Atomic UI reset: clear old status immediately on click.
    setTaskId(null)
    const id = await ugcForm.handleSubmit(e)
    if (id) {
      setTaskId(id)
      refreshCredits()
    } else {
      // Submit failed — could be 402 or another error; refresh anyway so the
      // header reflects any partial state changes server-side.
      refreshCredits()
    }
  }

  // Pick up the auto-refund whenever the task fails server-side.
  const lastFailKeyRef = useRef(null)
  useEffect(() => {
    const s = statusPayload?.status
    const us = statusPayload?.ugc_status
    const failedKey = `${s}|${us}`
    const anyFailed = s === 'failed' || us === 'failed'
    if (anyFailed && lastFailKeyRef.current !== failedKey) {
      lastFailKeyRef.current = failedKey
      refreshCredits()
    } else if (!anyFailed) {
      lastFailKeyRef.current = null
    }
  }, [statusPayload?.status, statusPayload?.ugc_status, refreshCredits])

  return (
    <div
      className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      dir="rtl"
      lang="he"
    >
      <header className="sticky top-0 z-20 border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[96%] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="text-start">
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">סטודיו אווטאר שיווקי</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">ללא סריקת אתר — בריף, בימוי ותסריט מובנים לווידאו מדבר</p>
          </div>
          <div className="flex items-center gap-3">
            {user?.isSuperuser ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-800/60"
                title="אדמין — ללא הגבלת קרדיטים (כל פעולה נרשמת ב-ledger)"
              >
                <span aria-hidden>∞</span>
                אדמין · ללא הגבלה
              </span>
            ) : typeof credits === 'number' ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                  credits <= 20
                    ? 'bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-800/60'
                    : credits <= 60
                    ? 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800/60'
                    : 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800/60'
                }`}
                title="קרדיטים זמינים (1 קרדיט ≈ $0.01 של עלות API)"
              >
                <span aria-hidden>⚡</span>
                {credits} קרדיטים
              </span>
            ) : null}
            <Link
              to="/"
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              חזרה לבאנרים
            </Link>
            {isSuperuser && (
              <Link
                to="/admin/catalog"
                className="rounded-lg border border-amber-300/80 dark:border-amber-600/50 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition"
              >
                ניהול קטלוג
              </Link>
            )}
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
          <UgcForm ugcForm={ugcForm} onSubmit={onFormSubmit} />
        </aside>

        <main className="min-h-[280px] space-y-4 text-right">
          {!taskId && (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/50 dark:bg-slate-900/40 px-6 py-16 text-center text-sm text-slate-500">
              מלא את הטופס ולחץ &quot;צור וידאו&quot;. הסטטוס והתסריט יופיעו כאן.
            </div>
          )}

          {taskId && (
            <StatusPanel
              taskId={taskId}
              statusPayload={statusPayload}
              videoLength={ugcForm.videoLength}
              isPolling={isPolling}
              bannerTerminal={bannerTerminal}
              ugcForm={ugcForm}
            />
          )}
        </main>
      </div>
    </div>
  )
}
