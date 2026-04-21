import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from './api.js'
import { useAuth } from './AuthContext.jsx'

// ─── constants ────────────────────────────────────────────────────────────────

const GENDER_OPTIONS    = ['male', 'female']
const ASPECT_OPTIONS    = ['9:16', '16:9', '1:1']
const PROVIDER_AVATAR   = ['heygen_elevenlabs', 'd-id']
const PROVIDER_VOICE    = ['elevenlabs']
const HEYGEN_CHAR_TYPES = ['avatar', 'talking_photo']

const AVATAR_DEFAULTS = {
  name: '',
  gender: 'male',
  aspect_ratio: '9:16',
  provider: 'heygen_elevenlabs',
  external_id: '',
  heygen_character_type: 'avatar',
  recommended_voice_id: '',
  thumbnail_url: '',
  is_active: true,
}

const VOICE_DEFAULTS = {
  name: '',
  gender: 'male',
  provider: 'elevenlabs',
  external_id: '',
  is_active: true,
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function axiosErrMsg(err) {
  const d = err?.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join(' ')
  return err?.message || 'הפעולה נכשלה'
}

// ─── shared UI primitives ────────────────────────────────────────────────────

function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block size-4 rounded-full border-2 border-indigo-400/30 border-t-indigo-500 animate-spin ${className}`}
      aria-hidden
    />
  )
}

function Badge({ active }) {
  return active
    ? <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-950/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-300/60 dark:ring-emerald-700/40">פעיל</span>
    : <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400 ring-1 ring-slate-300/50 dark:ring-slate-700/40">כבוי</span>
}

function Sel({ id, value, onChange, options, disabled }) {
  return (
    <select
      id={id}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 transition"
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Field({ label, children, required }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
        {required && <span className="text-red-500 me-0.5">*</span>}
        {label}
      </label>
      {children}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 transition'

// ─── Avatar form modal ───────────────────────────────────────────────────────

function AvatarFormModal({ initial, onSave, onClose, loading, error }) {
  const [f, setF] = useState({ ...AVATAR_DEFAULTS, ...initial })
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-y-auto max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {initial?.id ? 'עריכת אווטאר' : 'הוספת אווטאר חדש'}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-3">
          <Field label="שם (לתצוגה)" required>
            <input className={inputCls} value={f.name} onChange={set('name')} placeholder="למשל: Daniel - Deep Voice" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="מין" required>
              <Sel value={f.gender} onChange={set('gender')} options={GENDER_OPTIONS} />
            </Field>
            <Field label="יחס גובה-רוחב" required>
              <Sel value={f.aspect_ratio} onChange={set('aspect_ratio')} options={ASPECT_OPTIONS} />
            </Field>
          </div>
          <Field label="ספק" required>
            <Sel value={f.provider} onChange={set('provider')} options={PROVIDER_AVATAR} />
          </Field>
          <Field label="מזהה חיצוני (external_id)" required>
            <input className={inputCls} value={f.external_id} onChange={set('external_id')} dir="ltr" placeholder="HeyGen avatar_id / D-ID image URL" />
          </Field>
          {f.provider === 'heygen_elevenlabs' && (
            <Field label="סוג תו HeyGen">
              <Sel value={f.heygen_character_type ?? 'avatar'} onChange={set('heygen_character_type')} options={HEYGEN_CHAR_TYPES} />
            </Field>
          )}
          <Field label="מזהה קול מומלץ (ElevenLabs)">
            <input className={inputCls} value={f.recommended_voice_id ?? ''} onChange={set('recommended_voice_id')} dir="ltr" placeholder="voice_id (אופציונלי)" />
          </Field>
          <Field label="URL לתמונה ממוזערת">
            <input className={inputCls} value={f.thumbnail_url ?? ''} onChange={set('thumbnail_url')} dir="ltr" placeholder="https://… (אופציונלי)" />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={f.is_active}
              onChange={set('is_active')}
              className="rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
            />
            פעיל
          </label>

          {error && (
            <div role="alert" className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition">
              ביטול
            </button>
            <button
              type="button"
              onClick={() => onSave(f)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition"
            >
              {loading && <Spinner />}
              {initial?.id ? 'שמור שינויים' : 'הוסף אווטאר'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Voice form modal ────────────────────────────────────────────────────────

function VoiceFormModal({ initial, onSave, onClose, loading, error }) {
  const [f, setF] = useState({ ...VOICE_DEFAULTS, ...initial })
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-y-auto max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {initial?.id ? 'עריכת קול' : 'הוספת קול חדש'}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-3">
          <Field label="שם (לתצוגה)" required>
            <input className={inputCls} value={f.name} onChange={set('name')} placeholder="למשל: Daniel - Deep Voice" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="מין" required>
              <Sel value={f.gender} onChange={set('gender')} options={GENDER_OPTIONS} />
            </Field>
            <Field label="ספק" required>
              <Sel value={f.provider} onChange={set('provider')} options={PROVIDER_VOICE} />
            </Field>
          </div>
          <Field label="מזהה חיצוני (external_id)" required>
            <input className={inputCls} value={f.external_id} onChange={set('external_id')} dir="ltr" placeholder="ElevenLabs voice_id" />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={f.is_active}
              onChange={set('is_active')}
              className="rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
            />
            פעיל
          </label>

          {error && (
            <div role="alert" className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition">
              ביטול
            </button>
            <button
              type="button"
              onClick={() => onSave(f)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition"
            >
              {loading && <Spinner />}
              {initial?.id ? 'שמור שינויים' : 'הוסף קול'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────

function DeleteConfirm({ name, onConfirm, onClose, loading }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">אישור מחיקה</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          האם למחוק את <strong className="text-slate-900 dark:text-white">«{name}»</strong>? הפעולה לא ניתנת לביטול.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition">
            ביטול
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50 transition"
          >
            {loading && <Spinner />}
            מחק
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Avatars tab ──────────────────────────────────────────────────────────────

function AvatarsTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchErr, setFetchErr] = useState(null)

  const [modal, setModal] = useState(null)   // null | { mode: 'create'|'edit', row?: object }
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState(null)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setFetchErr(null)
    try {
      const { data } = await api.get('/admin/avatars')
      if (mountedRef.current) setRows(data)
    } catch (e) {
      if (mountedRef.current) setFetchErr(axiosErrMsg(e))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRows() }, [fetchRows])

  const handleSave = async (fields) => {
    setSaving(true)
    setSaveErr(null)
    try {
      const { id, created_at, ...body } = fields
      if (id) {
        await api.put(`/admin/avatars/${id}`, body)
      } else {
        await api.post('/admin/avatars', body)
      }
      setModal(null)
      await fetchRows()
    } catch (e) {
      setSaveErr(axiosErrMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(`/admin/avatars/${deleteTarget.id}`)
      setDeleteTarget(null)
      await fetchRows()
    } catch (e) {
      setFetchErr(axiosErrMsg(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          אווטארים ({rows.length})
        </h2>
        <button
          type="button"
          onClick={() => { setSaveErr(null); setModal({ mode: 'create' }) }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition"
        >
          + הוסף אווטאר
        </button>
      </div>

      {fetchErr && (
        <div role="alert" className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200">
          {fetchErr}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/50 dark:bg-slate-900/40 px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          אין אווטארים במסד הנתונים עדיין. הוסף אחד עם הכפתור למעלה.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                {['שם', 'מין', 'AR', 'ספק', 'external_id', 'סוג', 'סטטוס', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition">
                  <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100 max-w-[150px] truncate" title={row.name}>{row.name}</td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{row.gender}</td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{row.aspect_ratio}</td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{row.provider}</td>
                  <td className="px-3 py-2.5 max-w-[180px]">
                    <span className="block truncate font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr" title={row.external_id}>{row.external_id}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400 text-xs">{row.heygen_character_type || '—'}</td>
                  <td className="px-3 py-2.5"><Badge active={row.is_active} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        type="button"
                        onClick={() => { setSaveErr(null); setModal({ mode: 'edit', row }) }}
                        className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                      >
                        עריכה
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(row)}
                        className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/50 transition"
                      >
                        מחק
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <AvatarFormModal
          initial={modal.mode === 'edit' ? modal.row : undefined}
          onSave={handleSave}
          onClose={() => setModal(null)}
          loading={saving}
          error={saveErr}
        />
      )}
      {deleteTarget && (
        <DeleteConfirm
          name={deleteTarget.name}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
          loading={deleting}
        />
      )}
    </div>
  )
}

// ─── Voices tab ───────────────────────────────────────────────────────────────

function VoicesTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchErr, setFetchErr] = useState(null)

  const [modal, setModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState(null)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setFetchErr(null)
    try {
      const { data } = await api.get('/admin/voices')
      if (mountedRef.current) setRows(data)
    } catch (e) {
      if (mountedRef.current) setFetchErr(axiosErrMsg(e))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRows() }, [fetchRows])

  const handleSave = async (fields) => {
    setSaving(true)
    setSaveErr(null)
    try {
      const { id, created_at, ...body } = fields
      if (id) {
        await api.put(`/admin/voices/${id}`, body)
      } else {
        await api.post('/admin/voices', body)
      }
      setModal(null)
      await fetchRows()
    } catch (e) {
      setSaveErr(axiosErrMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(`/admin/voices/${deleteTarget.id}`)
      setDeleteTarget(null)
      await fetchRows()
    } catch (e) {
      setFetchErr(axiosErrMsg(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          קולות ({rows.length})
        </h2>
        <button
          type="button"
          onClick={() => { setSaveErr(null); setModal({ mode: 'create' }) }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition"
        >
          + הוסף קול
        </button>
      </div>

      {fetchErr && (
        <div role="alert" className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200">
          {fetchErr}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/50 dark:bg-slate-900/40 px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          אין קולות במסד הנתונים עדיין. הוסף אחד עם הכפתור למעלה.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                {['שם', 'מין', 'ספק', 'external_id', 'סטטוס', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition">
                  <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100 max-w-[160px] truncate" title={row.name}>{row.name}</td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{row.gender}</td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{row.provider}</td>
                  <td className="px-3 py-2.5 max-w-[200px]">
                    <span className="block truncate font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr" title={row.external_id}>{row.external_id}</span>
                  </td>
                  <td className="px-3 py-2.5"><Badge active={row.is_active} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        type="button"
                        onClick={() => { setSaveErr(null); setModal({ mode: 'edit', row }) }}
                        className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                      >
                        עריכה
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(row)}
                        className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/50 transition"
                      >
                        מחק
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <VoiceFormModal
          initial={modal.mode === 'edit' ? modal.row : undefined}
          onSave={handleSave}
          onClose={() => setModal(null)}
          loading={saving}
          error={saveErr}
        />
      )}
      {deleteTarget && (
        <DeleteConfirm
          name={deleteTarget.name}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
          loading={deleting}
        />
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'avatars', label: 'ניהול אווטארים' },
  { id: 'voices',  label: 'ניהול קולות'   },
]

export default function AdminCatalog() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('avatars')

  return (
    <div
      className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      dir="rtl"
      lang="he"
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[96%] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="text-start">
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              ניהול קטלוג
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              אווטארים וקולות — ניהול רשומות DB
            </p>
          </div>
          <div className="flex items-center gap-3">
            {user?.email && (
              <span className="hidden text-sm text-slate-600 dark:text-slate-400 sm:inline max-w-[200px] truncate">
                {user.email}
              </span>
            )}
            <Link
              to="/"
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              סטודיו באנרים
            </Link>
            <Link
              to="/avatar-studio"
              className="rounded-lg border border-violet-300/80 dark:border-violet-600/50 bg-violet-50 dark:bg-violet-950/40 px-3 py-2 text-sm font-medium text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition"
            >
              סטודיו אווטאר
            </Link>
            <button
              type="button"
              onClick={() => { logout(); navigate('/login', { replace: true }) }}
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              התנתקות
            </button>
          </div>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="mx-auto max-w-[96%] px-4 py-6 sm:px-6 lg:py-8 space-y-6">

        {/* Tab bar */}
        <div className="flex items-center gap-1 rounded-xl bg-slate-200/70 dark:bg-slate-800/60 p-1 w-fit">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                activeTab === id
                  ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm">
          {activeTab === 'avatars' ? <AvatarsTab /> : <VoicesTab />}
        </div>
      </div>
    </div>
  )
}
