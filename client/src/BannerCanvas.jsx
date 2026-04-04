import { useCallback, useEffect, useRef, useState } from 'react'
import { Rnd } from 'react-rnd'
import { toPng } from 'html-to-image'
import './BannerCanvas.css'

function EditableText({
  className,
  style,
  text,
  resetKey,
  onTextChange,
  dir = 'rtl',
  as = 'div',
}) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.textContent = text ?? ''
  }, [text, resetKey])

  const common = {
    ref,
    dir,
    className,
    style,
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    onMouseDown: (e) => e.stopPropagation(),
    onBlur: (e) => onTextChange?.(e.currentTarget.textContent ?? ''),
  }

  return as === 'span' ? (
    <span {...common} />
  ) : (
    <div {...common} />
  )
}

export default function BannerCanvas({
  apiBase,
  taskId,
  backgroundUrl,
  logoUrl,
  headline: headlineInitial,
  subhead: subheadInitial,
  bulletPoints,
  cta: ctaInitial,
}) {
  const viewportRef = useRef(null)
  const captureRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [downloadError, setDownloadError] = useState(null)

  const [headline, setHeadline] = useState(headlineInitial ?? '')
  const [subhead, setSubhead] = useState(subheadInitial ?? '')
  const [bullets, setBullets] = useState(() => [...(bulletPoints || [])])
  const [cta, setCta] = useState(ctaInitial ?? '')

  useEffect(() => {
    setHeadline(headlineInitial ?? '')
    setSubhead(subheadInitial ?? '')
    setBullets([...(bulletPoints || [])])
    setCta(ctaInitial ?? '')
    // Reset copy only when a new task id is shown (new job), not on unrelated parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  const setBulletAt = useCallback((index, value) => {
    setBullets((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }, [])

  const bgSrc = backgroundUrl ? `${apiBase}${backgroundUrl}` : ''
  const logoSrc = logoUrl ? `${apiBase}${logoUrl}` : ''

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (w > 0) setScale(w / 1080)
    })
    ro.observe(el)
    setScale(el.clientWidth / 1080)
    return () => ro.disconnect()
  }, [])

  const handleDownload = useCallback(async () => {
    const node = captureRef.current
    if (!node) return
    setDownloadError(null)
    setExporting(true)
    await new Promise((r) => requestAnimationFrame(r))
    await new Promise((r) => requestAnimationFrame(r))
    try {
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 1,
        filter: (el) => !el.classList?.contains('react-resizable-handle'),
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `banner-${(taskId || 'export').slice(0, 8)}.png`
      a.click()
    } catch (e) {
      setDownloadError(e.message || String(e))
    } finally {
      setExporting(false)
    }
  }, [taskId])

  const rndCommon = {
    bounds: 'parent',
    minWidth: 60,
    minHeight: 36,
    // Explicit 2D drag (default); no axis lock.
    dragAxis: 'both',
  }

  return (
    <div className="banner-canvas-root">
      <div className="banner-viewport" ref={viewportRef}>
        <div
          className="banner-viewport-inner"
          style={{
            width: 1080 * scale,
            height: 1080 * scale,
          }}
        >
          <div
            ref={captureRef}
            dir="rtl"
            className={`banner-canvas${exporting ? ' capture-mode' : ''}`}
            style={{
              transform: `scale(${scale})`,
            }}
          >
            <img
              className="banner-bg"
              src={bgSrc}
              alt=""
              crossOrigin="anonymous"
            />
            <div className="banner-bg-overlay" aria-hidden />
            <Rnd
              {...rndCommon}
              className="banner-rnd banner-rnd-logo"
              default={{ x: 728, y: 72, width: 280, height: 120 }}
              lockAspectRatio
              minWidth={80}
              minHeight={48}
            >
              <img src={logoSrc} alt="" crossOrigin="anonymous" />
            </Rnd>
            <Rnd
              {...rndCommon}
              dir="rtl"
              className="banner-rnd banner-rnd-text"
              default={{ x: 108, y: 220, width: 900, height: 160 }}
            >
              <div className="banner-rnd-rtl-shell">
                <EditableText
                  className="banner-text banner-headline"
                  text={headline}
                  resetKey={taskId}
                  onTextChange={setHeadline}
                />
              </div>
            </Rnd>
            <Rnd
              {...rndCommon}
              dir="rtl"
              className="banner-rnd banner-rnd-text"
              default={{ x: 108, y: 400, width: 900, height: 120 }}
            >
              <div className="banner-rnd-rtl-shell">
                <EditableText
                  className="banner-text banner-subhead"
                  text={subhead}
                  resetKey={taskId}
                  onTextChange={setSubhead}
                />
              </div>
            </Rnd>
            <Rnd
              {...rndCommon}
              dir="rtl"
              className="banner-rnd banner-rnd-text"
              default={{ x: 108, y: 540, width: 900, height: 300 }}
            >
              <div className="banner-rnd-rtl-shell">
                <ul className="banner-bullets" dir="rtl">
                  {bullets.map((b, i) => (
                    <li key={`${taskId}-b-${i}`}>
                      <EditableText
                        as="span"
                        className="banner-text"
                        text={b}
                        resetKey={`${taskId}-${i}`}
                        onTextChange={(t) => setBulletAt(i, t)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </Rnd>
            <Rnd
              {...rndCommon}
              dir="rtl"
              className="banner-rnd banner-rnd-cta"
              default={{ x: 588, y: 928, width: 420, height: 88 }}
            >
              <div className="banner-rnd-rtl-shell banner-rnd-cta-shell">
                <EditableText
                  className="banner-text banner-cta"
                  text={cta}
                  resetKey={taskId}
                  onTextChange={setCta}
                />
              </div>
            </Rnd>
          </div>
        </div>
      </div>
      <div className="banner-download-row">
        <button
          type="button"
          className="btn-download"
          onClick={handleDownload}
          disabled={exporting}
        >
          {exporting ? 'Preparing PNG…' : 'Download Banner'}
        </button>
      </div>
      {downloadError && (
        <p className="banner-download-error" role="alert">
          {downloadError}
        </p>
      )}
    </div>
  )
}
