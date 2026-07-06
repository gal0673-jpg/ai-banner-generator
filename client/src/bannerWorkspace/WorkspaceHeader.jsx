/**
 * Top-navigation header for BannerWorkspace.
 *
 * Pure presentational — receives every state value it needs as a prop so it
 * can be tested or replaced without touching the workspace's task lifecycle.
 *
 * Renders, left-to-right (in RTL):
 *   - Title + subtitle
 *   - Credit badge (admin special-cased to "∞ אדמין · ללא הגבלה")
 *   - Email (truncated)
 *   - Quick-links: avatar studio + (super) catalog + (primary) AI context export
 *   - Logout
 *   - Below header: aiContextErr error row (primary admin only)
 */

import { Link } from 'react-router-dom'


export default function WorkspaceHeader({
  user,
  credits,
  isSuperuser,
  isPrimaryAdmin,
  aiContextBusy,
  aiContextErr,
  handleDownloadAiContext,
  handleLogout,
}) {
  return (
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
          {user?.email && (
            <span className="hidden text-sm text-slate-600 dark:text-slate-400 sm:inline max-w-[200px] truncate">
              {user.email}
            </span>
          )}
          <Link
            to="/avatar-studio"
            className="rounded-lg border border-violet-300/80 dark:border-violet-600/50 bg-violet-50 dark:bg-violet-950/40 px-3 py-2 text-sm font-medium text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition"
          >
            סטודיו אווטאר
          </Link>
          {isSuperuser && (
            <Link
              to="/admin/catalog"
              className="rounded-lg border border-amber-300/80 dark:border-amber-600/50 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition"
            >
              ניהול קטלוג
            </Link>
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
  )
}
