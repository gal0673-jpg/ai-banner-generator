/**
 * Collapsible UGC panel used inside the BannerWorkspace sidebar.
 *
 * Lives next to its parent (BannerWorkspace) instead of trying to own state —
 * the workspace coordinates the task lifecycle (taskId, status polling, error
 * surfaces) and this component is a pure form view that talks to the parent
 * via props + callbacks. Two reasons to keep it dumb:
 *
 *   1. The "create UGC task" submit handler ``handleGenerateUGC`` lives in the
 *      workspace because it has to mutate workspace-scoped state on success
 *      (``setTaskId``, ``refreshCredits``).
 *   2. Several controls (e.g. provider toggle) need to coordinate with the
 *      shared form-lock state ``formLocked`` that's a function of multiple
 *      lifecycle flags also owned by the workspace.
 */

import { Link } from 'react-router-dom'

import { UGC_DEFAULT_AVATAR_URL, UGC_DEFAULT_VOICE_ID_HINT } from './constants.js'
import { Spinner } from './components.jsx'


export default function UgcPanel({
  // panel visibility
  ugcPanelOpen,
  setUgcPanelOpen,
  // provider + avatar
  ugcProvider,
  setUgcProvider,
  ugcHeygenCharacterType,
  setUgcHeygenCharacterType,
  ugcAvatarId,
  setUgcAvatarId,
  // ElevenLabs voice + aspect ratio + website URL
  ugcVoiceId,
  setUgcVoiceId,
  aspectRatio,
  setAspectRatio,
  ugcWebsiteUrl,
  setUgcWebsiteUrl,
  // custom script (skips AI script generation)
  ugcCustomScript,
  setUgcCustomScript,
  // lifecycle state from parent
  formLocked,
  ugcPosting,
  ugcError,
  handleGenerateUGC,
}) {
  return (
    <div className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-5 space-y-3">
      <button
        type="button"
        onClick={() => setUgcPanelOpen((o) => !o)}
        className="w-full rounded-xl border border-violet-300/90 dark:border-violet-600/50 bg-violet-50/90 dark:bg-violet-950/40 px-4 py-2.5 text-sm font-semibold text-violet-900 dark:text-violet-100 hover:bg-violet-100/90 dark:hover:bg-violet-900/50 transition text-right"
        aria-expanded={ugcPanelOpen}
      >
        {ugcPanelOpen ? 'הסתר אווטאר' : 'וידאו אווטאר'}
      </button>

      {ugcPanelOpen && (
        <div className="rounded-xl border border-violet-200/80 dark:border-violet-800/50 bg-violet-50/40 dark:bg-violet-950/20 p-4 space-y-3">
          <div className="rounded-xl border-2 border-violet-500/60 dark:border-violet-400/40 bg-white dark:bg-slate-900/90 p-4 shadow-sm space-y-3">
            <p className="text-sm font-bold text-violet-950 dark:text-violet-100 text-right">
              סטודיו אווטאר מלא (מומלץ)
            </p>
            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed text-right">
              דף נפרד: <strong className="text-slate-800 dark:text-slate-100">בריף שיווקי</strong>,{' '}
              <strong className="text-slate-800 dark:text-slate-100">הערות בימוי</strong> שלא נקראות בקול, תסריט
              מובנה מ-AI או טקסט דיבור בלבד — <strong className="text-slate-800 dark:text-slate-100">בלי סריקת אתר</strong>.
            </p>
            <Link
              to="/avatar-studio"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-violet-900/25 hover:bg-violet-500 transition"
            >
              פתח סטודיו אווטאר
            </Link>
          </div>

          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-t border-violet-200/60 dark:border-violet-800/40 pt-3 text-right">
            מסלול ישן — UGC עם סריקת כתובת האתר מהטופס למעלה
          </p>
          <p className="text-[11px] text-violet-900/80 dark:text-violet-200/80 leading-relaxed">
            דורש URL + סריקה. תסריט מותאם (אופציונלי) הוא טקסט דיבור אחד — בלי שדות בימוי נפרדים. השוואת D-ID / HeyGen.
          </p>
          <div>
            <label
              htmlFor="bw-ugc-provider"
              className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
            >
              ספק וידאו
            </label>
            <select
              id="bw-ugc-provider"
              value={ugcProvider}
              onChange={(ev) => {
                const v = ev.target.value
                setUgcProvider(v)
                if (v === 'heygen_elevenlabs' && ugcAvatarId.trim() === UGC_DEFAULT_AVATAR_URL) {
                  setUgcAvatarId('')
                }
                if (v === 'd-id' && !ugcAvatarId.trim()) {
                  setUgcAvatarId(UGC_DEFAULT_AVATAR_URL)
                }
              }}
              disabled={formLocked}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60 transition"
            >
              <option value="d-id">D-ID (תמונת פורטרט + אודיו)</option>
              <option value="heygen_elevenlabs">HeyGen + ElevenLabs</option>
            </select>
          </div>
          {ugcProvider === 'heygen_elevenlabs' && (
            <div>
              <label
                htmlFor="bw-ugc-heygen-type"
                className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
              >
                סוג מזהה HeyGen
              </label>
              <select
                id="bw-ugc-heygen-type"
                value={ugcHeygenCharacterType}
                onChange={(ev) => setUgcHeygenCharacterType(ev.target.value)}
                disabled={formLocked}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60 transition"
              >
                <option value="avatar">אווטאר סטודיו (avatar_id)</option>
                <option value="talking_photo">תמונה מדברת (talking_photo_id)</option>
              </select>
            </div>
          )}
          <div>
            <label
              htmlFor="bw-ugc-avatar"
              className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
            >
              אווטאר / תמונת מקור
            </label>
            <input
              id="bw-ugc-avatar"
              type="text"
              value={ugcAvatarId}
              onChange={(ev) => setUgcAvatarId(ev.target.value)}
              disabled={formLocked}
              placeholder={
                ugcProvider === 'd-id'
                  ? 'https://… תמונת פנים ציבורית (HTTPS)'
                  : ugcHeygenCharacterType === 'talking_photo'
                    ? 'talking_photo_id (List Avatars V2)'
                    : 'avatar_id מ-HeyGen'
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60 transition"
              dir="ltr"
            />
            <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
              D-ID: URL לתמונה. HeyGen: בחר למעלה avatar או talking_photo לפי סוג המזהה מהדשבורד.
            </p>
          </div>
          <div>
            <label
              htmlFor="bw-ugc-voice"
              className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
            >
              מזהה קול ElevenLabs{' '}
              <span className="text-slate-400 font-normal">(אופציונלי)</span>
            </label>
            <input
              id="bw-ugc-voice"
              type="text"
              value={ugcVoiceId}
              onChange={(ev) => setUgcVoiceId(ev.target.value)}
              disabled={formLocked}
              placeholder={`ריק = ברירת מחדל (${UGC_DEFAULT_VOICE_ID_HINT})`}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60 transition"
              dir="ltr"
              autoComplete="off"
            />
          </div>
          <div dir="rtl">
            <label
              htmlFor="bw-ugc-aspect"
              className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
            >
              יחס גובה-רוחב לווידאו
            </label>
            <select
              id="bw-ugc-aspect"
              value={aspectRatio}
              onChange={(ev) => setAspectRatio(ev.target.value)}
              disabled={formLocked}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60 transition"
            >
              <option value="9:16">9:16 (Story/Reels)</option>
              <option value="16:9">16:9 (אופקי)</option>
              <option value="1:1">1:1 (ריבועי)</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="bw-ugc-website"
              className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
            >
              כתובת לאתר בווידאו{' '}
              <span className="text-slate-400 font-normal">
                (אופציונלי — בלי https/www, מוצג בפינה ואז במרכז בסוף)
              </span>
            </label>
            <input
              id="bw-ugc-website"
              type="text"
              value={ugcWebsiteUrl}
              onChange={(ev) => setUgcWebsiteUrl(ev.target.value)}
              disabled={formLocked}
              placeholder="למשל: example.co.il או https://www.example.co.il"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60 transition"
              dir="ltr"
              autoComplete="off"
              maxLength={512}
            />
          </div>
          <div>
            <label
              htmlFor="bw-ugc-custom-script"
              className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
            >
              תסריט מותאם (Custom Script){' '}
              <span className="text-slate-400 font-normal">(אופציונלי — דילוג על תסריט AI)</span>
            </label>
            <textarea
              id="bw-ugc-custom-script"
              name="ugc_custom_script"
              rows={4}
              maxLength={2000}
              placeholder="הקלד כאן טקסט לדיבור — אם יישאר ריק, המערכת תייצר תסריט אוטומטית מהאתר."
              value={ugcCustomScript}
              onChange={(ev) => setUgcCustomScript(ev.target.value)}
              disabled={formLocked}
              className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60 min-h-[88px] transition"
              dir="rtl"
            />
          </div>
          {ugcError && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200 text-right"
            >
              {ugcError}
            </div>
          )}
          <button
            type="button"
            onClick={handleGenerateUGC}
            disabled={formLocked}
            className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-violet-900/20 hover:bg-violet-500 disabled:opacity-50 disabled:pointer-events-none transition inline-flex items-center justify-center gap-2"
          >
            {ugcPosting && <Spinner className="!size-4 border-white/30 border-t-white" />}
            {ugcPosting ? 'שולח…' : 'צור וידאו אווטאר'}
          </button>
        </div>
      )}
    </div>
  )
}
