import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE_URL_DISPLAY } from '../api.js'
import { TONE_TAGS, videoLayoutsVisibleForScriptSource } from './ugcConstants.js'
import Spinner from './Spinner.jsx'

export default function UgcForm({ ugcForm, onSubmit }) {
  const {
    scriptSource,
    setScriptSource,
    creativeBrief,
    setCreativeBrief,
    directorNotes,
    setDirectorNotes,
    spokenScript,
    setSpokenScript,
    videoLength,
    setVideoLength,
    aspectRatio,
    websiteUrl,
    setWebsiteUrl,
    logoUrl,
    setLogoUrl,
    productImageUrl,
    setProductImageUrl,
    selectedLayout,
    setSelectedLayout,
    logoFileRef,
    productFileRef,
    logoUploading,
    productUploading,
    uploadTempAsset,
    customGalleryImages,
    setCustomGalleryImages,
    requiredGalleryImages,
    gallerySlotUploading,
    avatars,
    catalogLoading,
    selectedAvatarDbId,
    setSelectedAvatarDbId,
    filteredVoices,
    selectedVoiceDbId,
    setSelectedVoiceDbId,
    selectedAvatar,
    formLocked,
    submitError,
    isPosting,
    isPolling,
  } = ugcForm

  const visibleVideoLayouts = videoLayoutsVisibleForScriptSource(scriptSource)
  const galleryPickSlotRef = useRef(0)
  const galleryFileInputRef = useRef(null)

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm text-right space-y-4"
    >
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">מקור תסריט</label>
        <select
          value={scriptSource}
          onChange={(ev) => setScriptSource(ev.target.value)}
          disabled={formLocked}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60"
        >
          <option value="from_brief_ai">AI מבריף + הערות בימוי</option>
          <option value="spoken_only">רק טקסט דיבור (בלי AI)</option>
        </select>
        {scriptSource === 'spoken_only' && (
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
            חובה למלא את תיבת &quot;טקסט לדיבור בלבד&quot; למטה לפני שליחה.
          </p>
        )}
      </div>

      {scriptSource === 'from_brief_ai' && (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              <span className="text-red-500">*</span> בריף קריאייטיבי
            </label>
            <textarea
              rows={6}
              value={creativeBrief}
              onChange={(ev) => setCreativeBrief(ev.target.value)}
              disabled={formLocked}
              required
              placeholder="מוצר, קהל, הצעה, טון — מה המסר?"
              className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-violet-500 min-h-[120px] disabled:opacity-60"
              dir="rtl"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              הערות בימוי / מבנה{' '}
              <span className="text-slate-400 font-normal">(לא יוקראו בקול — מנחות את ה-AI)</span>
            </label>
            <textarea
              rows={4}
              value={directorNotes}
              onChange={(ev) => setDirectorNotes(ev.target.value)}
              disabled={formLocked}
              placeholder="למשל: הוק 3 שניות, כאב, הוכחה, CTA חזק בסוף…"
              className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-violet-500 min-h-[88px] disabled:opacity-60"
              dir="rtl"
            />
            <div className="mt-2 space-y-1.5" dir="rtl">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">טון מומלץ (לחץ להוספה):</p>
              <div className="flex flex-wrap gap-1.5 justify-start" dir="rtl">
                {TONE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setDirectorNotes((d) => `${d}${tag} `)}
                    disabled={formLocked}
                    className="inline-flex items-center rounded-full bg-violet-50/90 dark:bg-violet-950/50 px-2.5 py-1 text-[11px] font-medium text-violet-800 dark:text-violet-200 ring-1 ring-violet-200/80 dark:ring-violet-800/60 hover:bg-violet-100 dark:hover:bg-violet-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {scriptSource === 'spoken_only' && (
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
            <span className="text-red-500">*</span> טקסט לדיבור בלבד (עברית)
          </label>
          <textarea
            rows={8}
            value={spokenScript}
            onChange={(ev) => setSpokenScript(ev.target.value)}
            disabled={formLocked}
            required
            placeholder="רק מה שהאווטאר יאמר — בלי כותרות סצנה ואנגלית."
            maxLength={12000}
            className="w-full resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-right outline-none focus:border-violet-500 min-h-[160px] disabled:opacity-60"
            dir="rtl"
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
          <span className="text-red-500">*</span> בחר אווטאר
        </label>

        {catalogLoading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Spinner className="!size-4" /> טוען קטלוג…
          </div>
        ) : avatars.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            אין אווטארים פעילים.{' '}
            <Link to="/admin/catalog" className="text-violet-600 dark:text-violet-400 hover:underline">
              הוסף בניהול הקטלוג
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {avatars.map((av) => {
              const isSelected = selectedAvatarDbId === av.id
              return (
                <button
                  key={av.id}
                  type="button"
                  onClick={() => setSelectedAvatarDbId(av.id)}
                  disabled={formLocked}
                  className={`relative flex flex-col overflow-hidden rounded-xl border-2 transition focus:outline-none disabled:opacity-60 ${
                    isSelected
                      ? 'border-violet-500 ring-2 ring-violet-500/30 shadow-md'
                      : 'border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-600'
                  }`}
                >
                  <div className="aspect-[9/16] w-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    {av.thumbnail_url ? (
                      <img
                        src={av.thumbnail_url}
                        alt={av.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-slate-400 dark:text-slate-600">
                        {av.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className={`px-1.5 py-1.5 text-center ${isSelected ? 'bg-violet-600' : 'bg-slate-50 dark:bg-slate-800'}`}>
                    <p
                      className={`text-[10px] font-semibold leading-tight truncate ${isSelected ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}
                    >
                      {av.name}
                    </p>
                    <p className={`text-[9px] mt-0.5 ${isSelected ? 'text-violet-200' : 'text-slate-400 dark:text-slate-500'}`}>
                      {av.aspect_ratio}
                    </p>
                  </div>
                  {isSelected && (
                    <span className="absolute top-1.5 right-1.5 size-4 rounded-full bg-violet-500 border-2 border-white flex items-center justify-center">
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="white">
                        <path
                          d="M2 5l2.5 2.5L8 3"
                          stroke="white"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
          קול{' '}
          {selectedAvatar && (
            <span className="text-slate-400 font-normal">({selectedAvatar.gender === 'male' ? 'גברי' : 'נשי'})</span>
          )}
        </label>
        <select
          value={selectedVoiceDbId}
          onChange={(ev) => setSelectedVoiceDbId(ev.target.value)}
          disabled={formLocked || filteredVoices.length === 0}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60"
        >
          {filteredVoices.length === 0 ? (
            <option value="">אין קולות זמינים לקטגוריה זו</option>
          ) : (
            filteredVoices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))
          )}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">אורך יעד</label>
        <select
          value={videoLength}
          onChange={(ev) => setVideoLength(ev.target.value)}
          disabled={formLocked}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
        >
          <option value="15s">15 שניות</option>
          <option value="30s">30 שניות</option>
          <option value="50s">50 שניות</option>
        </select>
      </div>

      <div dir="rtl">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
          יחס גובה-רוחב <span className="text-slate-400 font-normal">(נקבע לפי האווטאר)</span>
        </label>
        <select
          value={aspectRatio}
          disabled
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2.5 text-sm text-right outline-none opacity-70 cursor-not-allowed"
        >
          <option value="9:16">9:16 (Story/Reels)</option>
          <option value="16:9">16:9 (אופקי)</option>
          <option value="1:1">1:1 (ריבועי)</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
          כתובת לאתר בווידאו <span className="text-slate-400 font-normal">(אופציונלי)</span>
        </label>
        <input
          type="text"
          value={websiteUrl}
          onChange={(ev) => setWebsiteUrl(ev.target.value)}
          disabled={formLocked}
          placeholder="example.co.il — יוצג בלי https/www"
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
          dir="ltr"
          autoComplete="off"
          maxLength={512}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
          כתובת תמונת לוגו <span className="text-slate-400 font-normal">(אופציונלי)</span>
        </label>
        <div className="flex flex-wrap items-stretch gap-2">
          <input
            type="text"
            value={logoUrl}
            onChange={(ev) => setLogoUrl(ev.target.value)}
            disabled={formLocked}
            placeholder="https://... קישור ישיר לתמונה"
            className="min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
            dir="ltr"
            autoComplete="off"
            maxLength={1024}
          />
          <input
            ref={logoFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(ev) => {
              const f = ev.target.files?.[0]
              if (f) void uploadTempAsset(f, 'logo')
              ev.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => logoFileRef.current?.click()}
            disabled={formLocked || logoUploading}
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 min-w-[5.5rem]"
          >
            {logoUploading ? <Spinner className="!size-4" /> : null}
            <span>{logoUploading ? 'מעלה…' : 'העלאה'}</span>
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
          תמונת מוצר (אופציונלי - תופיע במרכז ובסוף)
        </label>
        <div className="flex flex-wrap items-stretch gap-2">
          <input
            type="text"
            value={productImageUrl}
            onChange={(ev) => setProductImageUrl(ev.target.value)}
            disabled={formLocked}
            placeholder="https://... קישור ישיר לתמונת מוצר"
            className="min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
            dir="ltr"
            autoComplete="off"
            maxLength={1024}
          />
          <input
            ref={productFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(ev) => {
              const f = ev.target.files?.[0]
              if (f) void uploadTempAsset(f, 'product')
              ev.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => productFileRef.current?.click()}
            disabled={formLocked || productUploading}
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 min-w-[5.5rem]"
          >
            {productUploading ? <Spinner className="!size-4" /> : null}
            <span>{productUploading ? 'מעלה…' : 'העלאה'}</span>
          </button>
        </div>
      </div>

      <div role="radiogroup" aria-label="סגנון וידאו" className="space-y-2">
        <span className="block text-xs font-medium text-slate-600 dark:text-slate-300">סגנון וידאו</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visibleVideoLayouts.map((layout) => {
            const isOn = selectedLayout === layout.id
            return (
              <button
                key={layout.id}
                type="button"
                role="radio"
                aria-checked={isOn}
                onClick={() => setSelectedLayout(layout.id)}
                disabled={formLocked}
                className={`rounded-xl border-2 px-3 py-2.5 text-sm text-right font-medium transition focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-60 ${
                  isOn
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/50 text-violet-900 dark:text-violet-100'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 hover:border-violet-300 dark:hover:border-violet-600'
                }`}
              >
                {layout.label}
              </button>
            )
          })}
        </div>
      </div>

      {requiredGalleryImages > 0 && (
        <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/40 px-3 py-3" dir="rtl">
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
            תמונות מותאמות אישית (אופציונלי): המערכת תייצר תמונות AI עבור כל סלוט שתשאירו ריק.
          </p>
          <input
            ref={galleryFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(ev) => {
              const f = ev.target.files?.[0]
              if (f) void uploadTempAsset(f, 'gallery', galleryPickSlotRef.current)
              ev.target.value = ''
            }}
          />
          {Array.from({ length: requiredGalleryImages }, (_, slotIndex) => {
            const url = typeof customGalleryImages[slotIndex] === 'string' ? customGalleryImages[slotIndex] : ''
            const busyHere = gallerySlotUploading === slotIndex
            return (
              <div key={slotIndex} className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  <span dir="ltr" className="inline-block">
                    Upload Image {slotIndex + 1} (Optional)
                  </span>
                </label>
                <div className="flex flex-wrap items-stretch gap-2">
                  <input
                    type="text"
                    value={url}
                    onChange={(ev) => {
                      const v = ev.target.value
                      setCustomGalleryImages((prev) => {
                        const next = Array.from({ length: requiredGalleryImages }, (_, i) =>
                          typeof prev[i] === 'string' ? prev[i] : '',
                        )
                        next[slotIndex] = v
                        return next
                      })
                    }}
                    disabled={formLocked}
                    placeholder="https://... או העלאה"
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none disabled:opacity-60"
                    dir="ltr"
                    autoComplete="off"
                    maxLength={1024}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      galleryPickSlotRef.current = slotIndex
                      galleryFileInputRef.current?.click()
                    }}
                    disabled={formLocked || busyHere}
                    className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 min-w-[5.5rem]"
                  >
                    {busyHere ? <Spinner className="!size-4" /> : null}
                    <span>{busyHere ? 'מעלה…' : 'העלאה'}</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {submitError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200"
        >
          {submitError}
        </div>
      )}

      <button
        type="submit"
        disabled={formLocked}
        className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md hover:bg-violet-500 disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {isPosting && <Spinner className="!size-4 border-white/30 border-t-white" />}
        {isPosting ? 'שולח…' : isPolling ? 'מייצר…' : 'צור וידאו'}
      </button>

      <p className="text-[10px] text-slate-400">
        API:{' '}
        <code className="rounded bg-slate-100 dark:bg-slate-800 px-1" dir="ltr">
          {API_BASE_URL_DISPLAY}
        </code>
      </p>
    </form>
  )
}
