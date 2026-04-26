import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'
import { PRIMARY_ADMIN_EMAIL } from './avatarStudio/ugcConstants.js'
import StatusPanel from './avatarStudio/StatusPanel.jsx'
import UgcForm from './avatarStudio/UgcForm.jsx'
import { useTaskPolling } from './avatarStudio/useTaskPolling.js'
import { useUgcFormState } from './avatarStudio/useUgcFormState.js'

export default function AvatarStudio() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const isPrimaryAdmin = user?.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL

  const [taskId, setTaskId] = useState(null)
  const { statusPayload, bannerTerminal, isPolling } = useTaskPolling(taskId)

  const ugcForm = useUgcFormState({ taskId, statusPayload, isPolling })

  const onFormSubmit = async (e) => {
    const id = await ugcForm.handleSubmit(e)
    if (id) setTaskId(id)
  }

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
            <Link
              to="/"
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              חזרה לבאנרים
            </Link>
            {isPrimaryAdmin && (
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
