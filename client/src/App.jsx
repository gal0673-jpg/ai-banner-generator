import { useCallback, useEffect, useState } from 'react'
import BannerCanvas from './BannerCanvas.jsx'
import './App.css'

const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:8000'

function App() {
  const [url, setUrl] = useState('')
  const [taskId, setTaskId] = useState(null)
  const [statusPayload, setStatusPayload] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const pollStatus = useCallback(async (signal) => {
    if (!taskId) return
    const res = await fetch(`${API_BASE}/status/${taskId}`, { signal })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || res.statusText)
    }
    return res.json()
  }, [taskId])

  useEffect(() => {
    if (!taskId) {
      setStatusPayload(null)
      return undefined
    }

    const ac = new AbortController()
    let intervalId

    const tick = async () => {
      try {
        const data = await pollStatus(ac.signal)
        setStatusPayload(data)
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(intervalId)
        }
      } catch (e) {
        if (e.name === 'AbortError') return
        setStatusPayload({
          task_id: taskId,
          status: 'failed',
          error: e.message || String(e),
          headline: null,
          subhead: null,
          bullet_points: null,
          cta: null,
          background_url: null,
          logo_url: null,
        })
        clearInterval(intervalId)
      }
    }

    tick()
    intervalId = setInterval(tick, 3000)

    return () => {
      ac.abort()
      clearInterval(intervalId)
    }
  }, [taskId, pollStatus])

  const handleGenerate = async (e) => {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) {
      setSubmitError('Please enter a URL.')
      return
    }

    setSubmitError(null)
    setStatusPayload(null)
    setTaskId(null)
    setIsSubmitting(true)

    try {
      const res = await fetch(`${API_BASE}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        const msg = Array.isArray(detail.detail)
          ? detail.detail.map((d) => d.msg || d).join(', ')
          : detail.detail
        throw new Error(msg || res.statusText)
      }
      const body = await res.json()
      setTaskId(body.task_id)
    } catch (err) {
      setSubmitError(err.message || String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const terminal =
    statusPayload?.status === 'completed' || statusPayload?.status === 'failed'
  const editorReady =
    statusPayload?.status === 'completed' &&
    statusPayload?.background_url &&
    statusPayload?.logo_url

  return (
    <div className={`app${editorReady ? ' app--editor' : ''}`}>
      <header className="header">
        <h1>Live banner editor</h1>
        <p className="lede">
          Enter a website URL. The API crawls the site, generates Hebrew copy and a DALL-E
          background, then you can drag, resize, and edit layers on a 1080×1080 canvas and
          export PNG.
        </p>
      </header>

      <form className="form" onSubmit={handleGenerate}>
        <label className="label" htmlFor="site-url">
          Website URL
        </label>
        <div className="row">
          <input
            id="site-url"
            type="text"
            name="url"
            className="input"
            placeholder="https://example.com"
            value={url}
            onChange={(ev) => setUrl(ev.target.value)}
            disabled={isSubmitting || (!!taskId && !terminal)}
            autoComplete="url"
          />
          <button
            type="submit"
            className="btn"
            disabled={isSubmitting || (!!taskId && !terminal)}
          >
            {isSubmitting ? 'Starting…' : 'Generate'}
          </button>
        </div>
        {submitError && <p className="error">{submitError}</p>}
        <p className="hint">
          API: <code>{API_BASE}</code> — set <code>VITE_API_URL</code> in{' '}
          <code>.env</code> if needed.
        </p>
      </form>

      {taskId && (
        <section className="status-section" aria-live="polite">
          <h2>Job status</h2>
          <dl className="status-dl">
            <dt>Task ID</dt>
            <dd>
              <code>{taskId}</code>
            </dd>
            <dt>Status</dt>
            <dd className="status-value">{statusPayload?.status ?? '…'}</dd>
          </dl>
          {statusPayload?.error && (
            <p className="error detail">{statusPayload.error}</p>
          )}
        </section>
      )}

      {editorReady && (
        <section className="result-section">
          <h2>Canvas</h2>
          <p className="canvas-hint">
            Drag from the dashed frame (or the logo). Click text to edit. Use handles to
            resize.
          </p>
          <BannerCanvas
            apiBase={API_BASE}
            taskId={taskId}
            backgroundUrl={statusPayload.background_url}
            logoUrl={statusPayload.logo_url}
            headline={statusPayload.headline}
            subhead={statusPayload.subhead}
            bulletPoints={statusPayload.bullet_points}
            cta={statusPayload.cta}
          />
        </section>
      )}
    </div>
  )
}

export default App
