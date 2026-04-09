import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'

export default function Login() {
  const { login, isAuthenticated, ready } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!ready || !isAuthenticated) return
    navigate(from, { replace: true })
  }, [ready, isAuthenticated, from, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
    } catch (err) {
      const isTimeout =
        err.code === 'ECONNABORTED' ||
        (typeof err.message === 'string' && err.message.toLowerCase().includes('timeout'))
      if (isTimeout) {
        setError(
          'פג הזמן לחיבור לשרת. ודא ש-FastAPI רץ על פורט 8888, ש-MySQL ב-Laragon פעיל, וש-Vite מפנה בקשות ל-API (או הגדר VITE_API_URL).'
        )
      } else {
        const detail = err.response?.data?.detail
        const message =
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.map((d) => d.msg || JSON.stringify(d)).join(' ')
              : err.message || 'ההתחברות נכשלה'
        setError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="min-h-screen bg-gradient-to-bl from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-6"
      dir="rtl"
      lang="he"
    >
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl shadow-indigo-950/50 p-8 sm:p-10">
          <div className="text-center mb-8">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/30 mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-6 w-6"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              התחברות למערכת
            </h1>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              מחולל הבאנרים מבוסס AI — הזינו את פרטי החשבון שלכם
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="login-email"
                className="block text-sm font-medium text-slate-300 mb-1.5"
              >
                דואר אלקטרוני
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                disabled={submitting}
                className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-slate-100 text-right placeholder:text-slate-500 outline-none ring-indigo-500/0 focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-500/30 transition disabled:opacity-50"
                placeholder="שם@דומיין.co.il"
              />
            </div>
            <div>
              <label
                htmlFor="login-password"
                className="block text-sm font-medium text-slate-300 mb-1.5"
              >
                סיסמה
              </label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                disabled={submitting}
                className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-slate-100 text-right placeholder:text-slate-500 outline-none focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-500/30 transition disabled:opacity-50"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-200 text-right"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-60 disabled:pointer-events-none transition"
            >
              {submitting ? 'מתחבר…' : 'התחבר'}
            </button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500 leading-relaxed">
          אימות JWT — בסביבת ייצור מומלץ לשלוח פרטים רק דרך HTTPS
        </p>
      </div>
    </div>
  )
}
