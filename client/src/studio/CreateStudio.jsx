import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toAbsoluteApiUrl } from '../api.js'
import {
  createProfile,
  generateBannerFromProfile,
  generateCopyFromProfile,
  generateVideoFromProfile,
  listProfiles,
  pollProfileUntilScanned,
  pollTaskUntilDone,
  pollVideoUntilDone,
  scanProfile,
  updateProfile,
} from '../business/businessApi.js'

/**
 * Unified "create marketing asset" flow — three steps:
 *   1. Your business  — pick/create a profile; optionally scan the website once.
 *   2. What to create — asset type + goal (the system picks providers/formats).
 *   3. Get & edit      — generate, watch progress, download the result.
 *
 * All technical decisions (crawl vs. cached, provider, aspect, length) are made
 * by the backend. The old BannerWorkspace / AvatarStudio remain reachable under
 * /advanced for power users.
 */

const STEPS = [
  { n: 1, label: 'העסק שלך' },
  { n: 2, label: 'מה נכין?' },
  { n: 3, label: 'קבלה ועריכה' },
]

const ASSET_TYPES = [
  { id: 'banner', title: 'תמונות לפוסטים', desc: 'באנרים מעוצבים מוכנים לפרסום', ready: true },
  { id: 'copy', title: 'טקסטים שיווקיים', desc: 'כותרות, תיאורים וקריאות לפעולה', ready: true },
  { id: 'video', title: 'סרטון שיווקי', desc: 'סרטון תדמית/מכירתי עם אווטאר', ready: true },
]

function Stepper({ step }) {
  return (
    <div className="flex items-center justify-center gap-2 sm:gap-4 mb-8">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition ${
                step === s.n
                  ? 'bg-indigo-500 text-white'
                  : step > s.n
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-800 text-slate-400'
              }`}
            >
              {step > s.n ? '✓' : s.n}
            </div>
            <span className={`text-sm ${step === s.n ? 'text-white font-medium' : 'text-slate-400'}`}>
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && <div className="w-6 sm:w-10 h-px bg-slate-700" />}
        </div>
      ))}
    </div>
  )
}

const inputClass =
  'w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500'

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-sm text-slate-300 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
    </label>
  )
}

// ── Step 1: business profile ──────────────────────────────────────────────────

function StepBusiness({ profiles, reloadProfiles, selectedId, onSelect, onNext }) {
  const selected = useMemo(() => profiles.find((p) => p.id === selectedId) || null, [profiles, selectedId])
  const [mode, setMode] = useState(profiles.length ? 'existing' : 'new')
  const [website, setWebsite] = useState('')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')

  // Manual/editable fields (mirror the selected profile).
  const [form, setForm] = useState(blankForm())
  function blankForm() {
    return { name: '', website_url: '', description: '', audience: '', tone: '', offerings: '', brand_color: '' }
  }
  useEffect(() => {
    if (selected) {
      setForm({
        name: selected.name || '',
        website_url: selected.website_url || '',
        description: selected.description || '',
        audience: selected.audience || '',
        tone: selected.tone || '',
        offerings: selected.offerings || '',
        brand_color: selected.brand_color || '',
      })
    }
  }, [selected])

  async function handleScan() {
    setError('')
    const url = website.trim()
    if (!url) {
      setError('הזן כתובת אתר לסריקה')
      return
    }
    setScanning(true)
    try {
      const created = await scanProfile({ websiteUrl: url })
      const done = await pollProfileUntilScanned(created.id)
      await reloadProfiles()
      onSelect(done.id)
      if (done.scan_status === 'failed') {
        setError(done.scan_error || 'הסריקה נכשלה — אפשר להשלים ידנית')
      }
      setMode('existing')
    } catch (e) {
      setError(e?.response?.data?.detail || 'שגיאה בסריקת האתר')
    } finally {
      setScanning(false)
    }
  }

  async function handleSaveManual() {
    setError('')
    if (!form.name.trim()) {
      setError('שם העסק הוא שדה חובה')
      return
    }
    try {
      if (selected) {
        const updated = await updateProfile(selected.id, form)
        await reloadProfiles()
        onSelect(updated.id)
      } else {
        const created = await createProfile({ ...form, is_default: profiles.length === 0 })
        await reloadProfiles()
        onSelect(created.id)
      }
      setMode('existing')
    } catch (e) {
      setError(e?.response?.data?.detail || 'שגיאה בשמירת הפרופיל')
    }
  }

  return (
    <div className="space-y-6">
      {profiles.length > 0 && (
        <div>
          <h3 className="text-sm text-slate-300 mb-2">בחר עסק קיים</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => { onSelect(p.id); setMode('existing') }}
                className={`text-right rounded-lg border px-3 py-3 transition ${
                  selectedId === p.id
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-slate-700 bg-slate-900 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-2">
                  {p.logo_url && (
                    <img src={toAbsoluteApiUrl(p.logo_url)} alt="" className="w-8 h-8 rounded object-contain bg-white/5" />
                  )}
                  <div>
                    <div className="text-sm text-slate-100 font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {p.scan_status === 'scanning' ? 'סורק…' : p.website_url || 'ללא אתר'}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={() => { onSelect(null); setForm(blankForm()); setMode('new') }}
            className="mt-3 text-sm text-indigo-400 hover:text-indigo-300"
          >
            + הוסף עסק חדש
          </button>
        </div>
      )}

      {(mode === 'new' || !profiles.length) && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 space-y-4">
          <div>
            <h3 className="text-sm text-slate-200 font-medium mb-1">סריקת אתר אוטומטית</h3>
            <p className="text-xs text-slate-500 mb-2">
              הזן כתובת אתר ונמלא עבורך את פרטי העסק אוטומטית. אפשר גם למלא ידנית למטה.
            </p>
            <div className="flex gap-2">
              <input
                className={inputClass}
                placeholder="https://example.co.il"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                dir="ltr"
              />
              <button
                onClick={handleScan}
                disabled={scanning}
                className="shrink-0 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-4 py-2 text-sm text-white font-medium"
              >
                {scanning ? 'סורק…' : 'סרוק אתר'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(selected || mode === 'new') && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 space-y-4">
          <h3 className="text-sm text-slate-200 font-medium">פרטי העסק</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="שם העסק *">
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="כתובת אתר">
              <input className={inputClass} dir="ltr" value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })} />
            </Field>
            <Field label="טון / קול המותג" hint="לדוגמה: מקצועי וחם">
              <input className={inputClass} value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} />
            </Field>
            <Field label="צבע מותג">
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={/^#[0-9A-Fa-f]{6}$/.test(form.brand_color) ? form.brand_color : '#4f46e5'}
                  onChange={(e) => setForm({ ...form, brand_color: e.target.value.toUpperCase() })}
                  className="h-9 w-12 rounded bg-slate-900 border border-slate-700"
                />
                <input className={inputClass} dir="ltr" placeholder="#1D4ED8" value={form.brand_color} onChange={(e) => setForm({ ...form, brand_color: e.target.value })} />
              </div>
            </Field>
          </div>
          <Field label="מה העסק עושה?">
            <textarea rows={2} className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="קהל היעד">
            <textarea rows={2} className={inputClass} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} />
          </Field>
          <Field label="מוצרים / שירותים עיקריים">
            <textarea rows={2} className={inputClass} value={form.offerings} onChange={(e) => setForm({ ...form, offerings: e.target.value })} />
          </Field>
          <button onClick={handleSaveManual} className="rounded-lg bg-slate-700 hover:bg-slate-600 px-4 py-2 text-sm text-white">
            שמור פרטים
          </button>
        </div>
      )}

      {error && <div className="text-sm text-rose-400">{error}</div>}

      <div className="flex justify-end">
        <button
          onClick={onNext}
          disabled={!selectedId}
          className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 px-6 py-2.5 text-sm text-white font-medium"
        >
          המשך →
        </button>
      </div>
    </div>
  )
}

// ── Step 2: what to create ────────────────────────────────────────────────────

function StepChoose({ assetType, setAssetType, goal, setGoal, onBack, onGenerate }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {ASSET_TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => t.ready && setAssetType(t.id)}
            disabled={!t.ready}
            className={`text-right rounded-xl border p-4 transition ${
              assetType === t.id
                ? 'border-indigo-500 bg-indigo-500/10'
                : 'border-slate-700 bg-slate-900 hover:border-slate-500'
            } ${!t.ready ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className="text-base font-semibold text-slate-100">{t.title}</div>
            <div className="text-xs text-slate-400 mt-1">{t.desc}</div>
            {!t.ready && <div className="text-[11px] text-amber-400 mt-2">בקרוב</div>}
          </button>
        ))}
      </div>

      <Field label="מה המטרה של הקריאייטיב?" hint="לדוגמה: מבצע לחג, השקת מוצר חדש, הגדלת מודעות">
        <textarea rows={3} className={inputClass} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="ספר לנו במשפט מה תרצה להשיג…" />
      </Field>

      <div className="flex justify-between">
        <button onClick={onBack} className="rounded-lg bg-slate-800 hover:bg-slate-700 px-5 py-2.5 text-sm text-slate-200">
          → חזרה
        </button>
        <button onClick={onGenerate} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-6 py-2.5 text-sm text-white font-medium">
          צור קריאייטיב
        </button>
      </div>
    </div>
  )
}

// ── Step 3: results ───────────────────────────────────────────────────────────

const STATUS_LABELS = {
  pending: 'ממתין בתור…',
  scraped: 'קורא את פרטי העסק…',
  generating_image: 'מעצב את הקריאייטיב…',
  completed: 'מוכן!',
  failed: 'אירעה שגיאה',
}

const UGC_STATUS_LABELS = {
  pending: 'ממתין בתור…',
  scraped: 'קורא את פרטי העסק…',
  generating_script: 'כותב תסריט…',
  generating_video: 'מפיק את הסרטון…',
  processing_video: 'מעבד את הווידאו…',
  rendering_captions: 'מוסיף כתוביות…',
  completed: 'מוכן!',
  failed: 'אירעה שגיאה',
}

function CopyRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-800 py-2">
      <div>
        <div className="text-[11px] text-slate-500">{label}</div>
        <div className="text-sm text-slate-100 whitespace-pre-wrap">{value}</div>
      </div>
      <button
        onClick={() => navigator.clipboard?.writeText(value)}
        className="shrink-0 text-xs text-indigo-400 hover:text-indigo-300"
      >
        העתק
      </button>
    </div>
  )
}

function StepResult({ assetType, status, copy, copyLoading, copyError, onRestart }) {
  // ── Copy (instant) branch ───────────────────────────────────────────────────
  if (assetType === 'copy') {
    return (
      <div className="space-y-6">
        {copyLoading && (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm text-slate-300">כותב את הטקסטים…</div>
          </div>
        )}
        {copyError && (
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 p-4 text-sm text-rose-300">{copyError}</div>
        )}
        {copy && !copyLoading && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
            <CopyRow label="כותרת" value={copy.headline} />
            <CopyRow label="כותרת משנה" value={copy.subhead} />
            {Array.isArray(copy.bullet_points) &&
              copy.bullet_points.map((b, i) => <CopyRow key={i} label={`נקודה ${i + 1}`} value={b} />)}
            <CopyRow label="קריאה לפעולה" value={copy.cta} />
            <CopyRow label="הוק לוידאו" value={copy.video_hook} />
          </div>
        )}
        <div className="flex justify-between">
          <button onClick={onRestart} className="rounded-lg bg-slate-800 hover:bg-slate-700 px-5 py-2.5 text-sm text-slate-200">
            צור קריאייטיב נוסף
          </button>
        </div>
      </div>
    )
  }

  // ── Video (avatar-studio) branch ────────────────────────────────────────────
  if (assetType === 'video') {
    const ust = status?.ugc_status
    const videoUrl =
      status?.ugc_final_video_url || status?.ugc_composited_video_url || status?.ugc_raw_video_url || null
    return (
      <div className="space-y-6">
        {ust !== 'completed' && ust !== 'failed' && status?.status !== 'failed' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm text-slate-300">{UGC_STATUS_LABELS[ust] || 'עובד…'}</div>
            <div className="text-xs text-slate-500">הפקת וידאו עשויה להימשך מספר דקות</div>
          </div>
        )}
        {(ust === 'failed' || status?.status === 'failed') && (
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 p-4 text-sm text-rose-300">
            {status?.ugc_error || status?.error || 'הפקת הסרטון נכשלה.'}
          </div>
        )}
        {ust === 'completed' && videoUrl && (
          <div className="space-y-3">
            <video src={toAbsoluteApiUrl(videoUrl)} controls className="w-full max-w-sm mx-auto rounded-lg border border-slate-700 bg-black" />
            <div className="text-center">
              <a href={toAbsoluteApiUrl(videoUrl)} download className="text-sm text-indigo-300 hover:text-indigo-200">
                הורד את הסרטון
              </a>
            </div>
          </div>
        )}
        <div className="flex justify-between">
          <button onClick={onRestart} className="rounded-lg bg-slate-800 hover:bg-slate-700 px-5 py-2.5 text-sm text-slate-200">
            צור קריאייטיב נוסף
          </button>
        </div>
      </div>
    )
  }

  // ── Banner branch ───────────────────────────────────────────────────────────
  const st = status?.status
  const banners = status
    ? [status.rendered_banner_1_url, status.rendered_banner_2_url].filter(Boolean)
    : []

  return (
    <div className="space-y-6">
      {st !== 'completed' && st !== 'failed' && (
        <div className="flex flex-col items-center gap-3 py-10">
          <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-sm text-slate-300">{STATUS_LABELS[st] || 'עובד…'}</div>
        </div>
      )}

      {st === 'failed' && (
        <div className="rounded-lg border border-rose-700 bg-rose-950/40 p-4 text-sm text-rose-300">
          {status?.error || 'אירעה שגיאה ביצירת הקריאייטיב.'}
        </div>
      )}

      {st === 'completed' && (
        <div className="space-y-4">
          {status.headline && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <div className="text-lg font-semibold text-slate-100">{status.headline}</div>
              {status.subhead && <div className="text-sm text-slate-400 mt-1">{status.subhead}</div>}
              {Array.isArray(status.bullet_points) && (
                <ul className="mt-2 text-sm text-slate-300 list-disc pr-5 space-y-0.5">
                  {status.bullet_points.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              )}
              {status.cta && (
                <span
                  className="inline-block mt-3 rounded-md px-3 py-1 text-sm text-white"
                  style={{ backgroundColor: status.brand_color || '#4f46e5' }}
                >
                  {status.cta}
                </span>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {banners.map((url, i) => (
              <div key={i} className="rounded-lg border border-slate-700 overflow-hidden bg-slate-900">
                <img src={toAbsoluteApiUrl(url)} alt={`עיצוב ${i + 1}`} className="w-full block" />
                <a
                  href={toAbsoluteApiUrl(url)}
                  download
                  className="block text-center text-sm text-indigo-300 hover:text-indigo-200 py-2 border-t border-slate-700"
                >
                  הורד עיצוב {i + 1}
                </a>
              </div>
            ))}
          </div>

          <div className="text-xs text-slate-500">
            רוצה לערוך טקסטים, מיקומים ולהפיק וידאו?{' '}
            <Link to="/advanced" className="text-indigo-400 hover:text-indigo-300">פתח במסך המתקדם</Link>
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <button onClick={onRestart} className="rounded-lg bg-slate-800 hover:bg-slate-700 px-5 py-2.5 text-sm text-slate-200">
          צור קריאייטיב נוסף
        </button>
      </div>
    </div>
  )
}

// ── Container ─────────────────────────────────────────────────────────────────

export default function CreateStudio() {
  const [step, setStep] = useState(1)
  const [profiles, setProfiles] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [assetType, setAssetType] = useState('banner')
  const [goal, setGoal] = useState('')
  const [taskStatus, setTaskStatus] = useState(null)
  const [genError, setGenError] = useState('')
  const [copy, setCopy] = useState(null)
  const [copyLoading, setCopyLoading] = useState(false)
  const [copyError, setCopyError] = useState('')

  async function reloadProfiles() {
    const list = await listProfiles()
    setProfiles(list)
    if (!selectedId) {
      const def = list.find((p) => p.is_default) || list[0]
      if (def) setSelectedId(def.id)
    }
    return list
  }

  useEffect(() => {
    reloadProfiles().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleGenerate() {
    setGenError('')
    setStep(3)

    if (assetType === 'copy') {
      setCopy(null)
      setCopyError('')
      setCopyLoading(true)
      try {
        const result = await generateCopyFromProfile({ profileId: selectedId, goal: goal.trim() || null })
        setCopy(result)
      } catch (e) {
        setCopyError(e?.response?.data?.detail || 'שגיאה ביצירת הטקסטים')
      } finally {
        setCopyLoading(false)
      }
      return
    }

    if (assetType === 'video') {
      setTaskStatus({ ugc_status: 'pending' })
      try {
        const taskId = await generateVideoFromProfile({ profileId: selectedId, goal: goal.trim() || null })
        await pollVideoUntilDone(taskId, { onUpdate: (s) => setTaskStatus(s) })
      } catch (e) {
        const detail = e?.response?.data?.detail || 'שגיאה ביצירת הסרטון'
        setGenError(detail)
        setTaskStatus({ ugc_status: 'failed', ugc_error: detail })
      }
      return
    }

    // Banner (async task + polling)
    setTaskStatus({ status: 'pending' })
    try {
      const taskId = await generateBannerFromProfile({ profileId: selectedId, brief: goal.trim() || null })
      await pollTaskUntilDone(taskId, { onUpdate: (s) => setTaskStatus(s) })
    } catch (e) {
      setGenError(e?.response?.data?.detail || 'שגיאה ביצירה')
      setTaskStatus({ status: 'failed', error: e?.response?.data?.detail || 'שגיאה ביצירה' })
    }
  }

  function restart() {
    setStep(2)
    setTaskStatus(null)
    setGoal('')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" dir="rtl" lang="he">
      <header className="border-b border-slate-800 px-4 sm:px-8 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">סטודיו הקריאייטיב</h1>
        <Link to="/advanced" className="text-sm text-slate-400 hover:text-slate-200">מסך מתקדם</Link>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-8 py-8">
        <Stepper step={step} />

        {step === 1 && (
          <StepBusiness
            profiles={profiles}
            reloadProfiles={reloadProfiles}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <StepChoose
            assetType={assetType}
            setAssetType={setAssetType}
            goal={goal}
            setGoal={setGoal}
            onBack={() => setStep(1)}
            onGenerate={handleGenerate}
          />
        )}
        {step === 3 && (
          <StepResult
            assetType={assetType}
            status={taskStatus}
            copy={copy}
            copyLoading={copyLoading}
            copyError={copyError}
            onRestart={restart}
          />
        )}

        {genError && step !== 3 && <div className="mt-4 text-sm text-rose-400">{genError}</div>}
      </main>
    </div>
  )
}
