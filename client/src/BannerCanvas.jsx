import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { motion as Motion, useDragControls } from 'framer-motion'
import { Resizable } from 're-resizable'
import { toPng } from 'html-to-image'
import './BannerCanvas.css'

// ─── Layout constants (all in "banner px" space, 1080×1080) ──────────────────
const BANNER_PX  = 1080
const LEFT_W     = 475   // left photo panel width  (~44%)
const DIVIDER_W  = 6     // brand-colour accent bar
const RIGHT_X    = LEFT_W + DIVIDER_W   // 481 – where right panel begins
const STRIP_H    = 70    // bottom domain strip height
const CONTENT_H  = BANNER_PX - STRIP_H // 1010 – usable vertical height
const RPAD       = 44    // horizontal padding inside right panel
const CONTENT_X  = RIGHT_X + RPAD      // 525 – left edge of text content
const CONTENT_W  = BANNER_PX - CONTENT_X - RPAD  // 511 – text column width

const DEFAULT_BRAND_HEX = '#4F46E5'

// Logo default: right-aligned in the right panel (mirroring the reference design)
const LOGO_W = 200
/** Default layer positions — all inside the right content panel. */
const DEFAULT_LOGO     = { x: BANNER_PX - RPAD - LOGO_W, y: 44,  width: LOGO_W,    height: 72  }
const DEFAULT_HEADLINE = { x: CONTENT_X,                 y: 148, width: CONTENT_W, height: 210 }
const DEFAULT_SUBHEAD  = { x: CONTENT_X,                 y: 372, width: CONTENT_W, height: 110 }
const DEFAULT_BULLETS  = { x: CONTENT_X,                 y: 500, width: CONTENT_W, height: 220 }
const DEFAULT_CTA      = { x: CONTENT_X,                 y: 748, width: CONTENT_W, height: 86  }

// ─── Utility helpers ─────────────────────────────────────────────────────────

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

function normalizeBrandHex(input) {
  if (!input || typeof input !== 'string') return DEFAULT_BRAND_HEX
  let s = input.trim()
  if (!s.startsWith('#')) s = `#${s}`
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toUpperCase()
  return DEFAULT_BRAND_HEX
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function contrastingTextColor(bgHex) {
  const h = (bgHex && bgHex.startsWith('#') ? bgHex : DEFAULT_BRAND_HEX).slice(1)
  if (h.length !== 6) return '#ffffff'
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.55 ? '#0f172a' : '#ffffff'
}

function extractDomain(url) {
  if (!url) return ''
  try {
    const u = url.includes('://') ? url : `https://${url}`
    return new URL(u).hostname
  } catch {
    return url
  }
}

function waitForImagesInNode(root) {
  const imgs = root.querySelectorAll('img')
  return Promise.all(
    [...imgs].map(
      (img) =>
        new Promise((resolve) => {
          const done = () => {
            if (typeof img.decode === 'function') {
              img.decode().then(resolve).catch(resolve)
            } else {
              resolve()
            }
          }
          if (img.complete) done()
          else {
            img.addEventListener('load', done, { once: true })
            img.addEventListener('error', () => resolve(), { once: true })
          }
        }),
    ),
  )
}

/** Normalize drag end to banner-px using the canvas root rect. */
function commitPositionInBanner(canvasEl, layerEl, setBox) {
  if (!canvasEl || !layerEl) return
  const cr = canvasEl.getBoundingClientRect()
  const lr = layerEl.getBoundingClientRect()
  if (cr.width <= 0 || cr.height <= 0) return
  const nx = ((lr.left - cr.left) / cr.width) * BANNER_PX
  const ny = ((lr.top - cr.top) / cr.height) * BANNER_PX
  setBox((b) => ({
    ...b,
    x: clamp(Math.round(nx), 0, Math.max(0, BANNER_PX - b.width)),
    y: clamp(Math.round(ny), 0, Math.max(0, BANNER_PX - b.height)),
  }))
}

// ─── EditableText ─────────────────────────────────────────────────────────────

function EditableText({ className, style, text, resetKey, onTextChange, dir = 'rtl', as = 'div' }) {
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

  return as === 'span' ? <span {...common} /> : <div {...common} />
}

// ─── Resize handle config ─────────────────────────────────────────────────────

const RESIZE_ENABLE = {
  top: false, left: false, topLeft: false, topRight: false, bottomLeft: false,
  right: true, bottom: true, bottomRight: true,
}

// ─── BannerLayer ─────────────────────────────────────────────────────────────

function BannerLayer({
  canvasRef, box, setBox, className, layerKey, setDraggingKey,
  viewportScale, minWidth, minHeight, lockAspectRatio, dragHandleOnly, dragControls, children,
}) {
  const layerRef = useRef(null)

  return (
    <Motion.div
      ref={layerRef}
      layout={false}
      className={`z-10 box-border ${className}`}
      drag
      dragElastic={0}
      dragMomentum={false}
      dragConstraints={canvasRef}
      dragListener={!dragHandleOnly}
      dragControls={dragControls}
      whileDrag={{ zIndex: 50, cursor: 'grabbing' }}
      style={{ position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height }}
      onDragStart={() => setDraggingKey(layerKey)}
      onDragEnd={() => {
        commitPositionInBanner(canvasRef.current, layerRef.current, setBox)
        setDraggingKey(null)
      }}
    >
      <Resizable
        size={{ width: box.width, height: box.height }}
        scale={viewportScale}
        minWidth={minWidth}
        minHeight={minHeight}
        lockAspectRatio={lockAspectRatio}
        enable={RESIZE_ENABLE}
        handleWrapperClass="banner-resize-handle-root"
        onResizeStop={(_e, _dir, ref) => {
          setBox((b) => ({ ...b, width: ref.offsetWidth, height: ref.offsetHeight }))
        }}
        className="box-border h-full w-full"
        style={{ display: 'block', boxSizing: 'border-box' }}
      >
        <div className="banner-layer-inner box-border h-full w-full overflow-visible p-1">
          {children}
        </div>
      </Resizable>
    </Motion.div>
  )
}

// ─── BannerCanvas ─────────────────────────────────────────────────────────────

export default function BannerCanvas({
  apiBase,
  taskId,
  backgroundUrl,
  logoUrl,
  headline: headlineInitial,
  subhead: subheadInitial,
  bulletPoints,
  cta: ctaInitial,
  brandColor,
  siteUrl,
}) {
  const viewportRef = useRef(null)
  const captureRef  = useRef(null)
  const reactSurfaceSuffix = useId().replace(/:/g, '')
  const boundsSurfaceId = taskId
    ? `banner-surface-${taskId}`
    : `banner-surface-${reactSurfaceSuffix}`

  const ctaDragControls = useDragControls()

  const [scale,         setScale]         = useState(1)
  const [exporting,     setExporting]     = useState(false)
  const [downloadError, setDownloadError] = useState(null)

  const [headline, setHeadline] = useState(headlineInitial ?? '')
  const [subhead,  setSubhead]  = useState(subheadInitial ?? '')
  const [bullets,  setBullets]  = useState(() => [...(bulletPoints || [])])
  const [cta,      setCta]      = useState(ctaInitial ?? '')

  const [logoBox,     setLogoBox]     = useState(() => ({ ...DEFAULT_LOGO     }))
  const [headlineBox, setHeadlineBox] = useState(() => ({ ...DEFAULT_HEADLINE }))
  const [subheadBox,  setSubheadBox]  = useState(() => ({ ...DEFAULT_SUBHEAD  }))
  const [bulletsBox,  setBulletsBox]  = useState(() => ({ ...DEFAULT_BULLETS  }))
  const [ctaBox,      setCtaBox]      = useState(() => ({ ...DEFAULT_CTA      }))
  const [draggingKey, setDraggingKey] = useState(null)

  useEffect(() => {
    setHeadline(headlineInitial ?? '')
    setSubhead(subheadInitial ?? '')
    setBullets([...(bulletPoints || [])])
    setCta(ctaInitial ?? '')
    setLogoBox({     ...DEFAULT_LOGO     })
    setHeadlineBox({ ...DEFAULT_HEADLINE })
    setSubheadBox({  ...DEFAULT_SUBHEAD  })
    setBulletsBox({  ...DEFAULT_BULLETS  })
    setCtaBox({      ...DEFAULT_CTA      })
    setDraggingKey(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  const setBulletAt = useCallback((index, value) => {
    setBullets((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }, [])

  const bgSrc   = backgroundUrl ? `${apiBase}${backgroundUrl}` : ''
  const logoSrc = logoUrl       ? `${apiBase}${logoUrl}`       : ''

  const ctaBgHex  = normalizeBrandHex(brandColor)
  const ctaFgHex  = contrastingTextColor(ctaBgHex)
  const [brandR, brandG, brandB] = hexToRgb(ctaBgHex)

  const leftOverlay = `linear-gradient(145deg, rgba(10,18,36,0.92) 0%, rgba(${brandR},${brandG},${brandB},0.58) 48%, rgba(10,18,36,0.82) 100%)`
  const rightPanelBg = `linear-gradient(155deg, #ffffff 0%, #f8fafc 55%, rgba(${brandR},${brandG},${brandB},0.07) 100%)`
  const domain = extractDomain(siteUrl)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (w > 0) setScale(w / BANNER_PX)
    })
    ro.observe(el)
    setScale(el.clientWidth / BANNER_PX)
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
      await waitForImagesInNode(node)
      await new Promise((r) => requestAnimationFrame(r))

      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 1,
        width: BANNER_PX,
        height: BANNER_PX,
        backgroundColor: '#ffffff',
        style: {
          transform: 'scale(1)',
          backgroundColor: '#ffffff',
          colorScheme: 'light',
        },
        filter: (el) => {
          if (el.classList?.contains('banner-resize-handle-root')) return false
          if (el.closest?.('.banner-resize-handle-root')) return false
          if (el.classList?.contains('banner-cta-drag-handle')) return false
          return true
        },
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

  const layerClass = (id) =>
    `banner-layer banner-layer--${id}${draggingKey === id ? ' banner-layer--dragging' : ''}`

  const bgImageStyle = bgSrc !== '' ? { backgroundImage: `url(${JSON.stringify(bgSrc)})` } : undefined

  return (
    <div className="banner-canvas-root w-full max-w-full">
      <div className="banner-viewport" ref={viewportRef} dir="ltr">
        <div
          className="banner-viewport-inner"
          style={{ width: BANNER_PX * scale, height: BANNER_PX * scale }}
        >
          <div
            ref={captureRef}
            id={boundsSurfaceId}
            dir="ltr"
            className={`absolute left-0 top-0 w-[1080px] h-[1080px] shrink-0 origin-top-left overflow-hidden banner-canvas${exporting ? ' capture-mode' : ''}`}
            style={{ transform: `scale(${scale})` }}
          >

            {/* ── Left photo panel ────────────────────────────────── */}
            <div
              className="absolute left-0 top-0 pointer-events-none overflow-hidden"
              style={{ width: LEFT_W, height: CONTENT_H }}
              aria-hidden
            >
              <div
                className={`absolute inset-0 bg-cover bg-center bg-no-repeat ${bgSrc ? '' : 'bg-slate-700'}`}
                style={bgImageStyle}
              />
              {bgSrc ? (
                <img
                  src={bgSrc}
                  alt=""
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                  loading="eager"
                  decoding="async"
                  className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
                  aria-hidden
                />
              ) : null}
              <div className="absolute inset-0" style={{ background: leftOverlay }} />
            </div>

            {/* ── Brand accent divider ─────────────────────────────── */}
            <div
              className="absolute top-0 pointer-events-none"
              style={{ left: LEFT_W, width: DIVIDER_W, height: CONTENT_H, backgroundColor: ctaBgHex }}
              aria-hidden
            />

            {/* ── Right content panel ──────────────────────────────── */}
            <div
              className="absolute top-0 pointer-events-none"
              style={{ left: RIGHT_X, right: 0, height: CONTENT_H, background: rightPanelBg }}
              aria-hidden
            />

            {/* ── Bottom domain strip ──────────────────────────────── */}
            <div
              className="absolute bottom-0 left-0 right-0 pointer-events-none flex items-center justify-center"
              style={{ height: STRIP_H, backgroundColor: ctaBgHex }}
              aria-hidden
            >
              {domain && (
                <span
                  style={{
                    color: ctaFgHex,
                    fontFamily: 'system-ui, Arial, sans-serif',
                    fontSize: 24,
                    fontWeight: 700,
                    direction: 'ltr',
                    letterSpacing: '0.3px',
                  }}
                >
                  {domain}
                </span>
              )}
            </div>

            {/* ── Logo layer ──────────────────────────────────────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={logoBox}
              setBox={setLogoBox}
              className={layerClass('logo')}
              layerKey="logo"
              setDraggingKey={setDraggingKey}
              viewportScale={scale}
              minWidth={80}
              minHeight={48}
              lockAspectRatio
            >
              <img
                src={logoSrc}
                alt=""
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                loading="eager"
                decoding="async"
                draggable={false}
                className="banner-layer-logo-img mx-auto block max-h-full max-w-full object-contain"
              />
            </BannerLayer>

            {/* ── Headline layer ──────────────────────────────────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={headlineBox}
              setBox={setHeadlineBox}
              className={`${layerClass('headline')} banner-layer--text`}
              layerKey="headline"
              setDraggingKey={setDraggingKey}
              viewportScale={scale}
              minWidth={280}
              minHeight={56}
            >
              <div className="banner-text-shell min-w-[280px] text-right" dir="rtl">
                <EditableText
                  className="banner-text banner-headline min-w-[260px] whitespace-normal"
                  text={headline}
                  resetKey={taskId}
                  onTextChange={setHeadline}
                />
              </div>
            </BannerLayer>

            {/* ── Subhead layer ───────────────────────────────────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={subheadBox}
              setBox={setSubheadBox}
              className={`${layerClass('subhead')} banner-layer--text`}
              layerKey="subhead"
              setDraggingKey={setDraggingKey}
              viewportScale={scale}
              minWidth={280}
              minHeight={48}
            >
              <div className="banner-text-shell min-w-[280px] text-right" dir="rtl">
                <EditableText
                  className="banner-text banner-subhead min-w-[260px] whitespace-normal"
                  text={subhead}
                  resetKey={taskId}
                  onTextChange={setSubhead}
                />
              </div>
            </BannerLayer>

            {/* ── Feature-cards layer (replaces bullet list) ──────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={bulletsBox}
              setBox={setBulletsBox}
              className={`${layerClass('bullets')} banner-layer--text`}
              layerKey="bullets"
              setDraggingKey={setDraggingKey}
              viewportScale={scale}
              minWidth={280}
              minHeight={100}
            >
              <div className="banner-feat-grid" dir="rtl">
                {bullets.map((b, i) => (
                  <div
                    key={`${taskId}-b-${i}`}
                    className="banner-feat-card"
                    style={{ borderTopColor: ctaBgHex }}
                  >
                    <div
                      className="banner-feat-icon"
                      style={{ backgroundColor: ctaBgHex, color: ctaFgHex }}
                    >
                      ✓
                    </div>
                    <EditableText
                      as="span"
                      className="banner-feat-text"
                      text={b}
                      resetKey={`${taskId}-${i}`}
                      onTextChange={(t) => setBulletAt(i, t)}
                    />
                  </div>
                ))}
              </div>
            </BannerLayer>

            {/* ── CTA layer ───────────────────────────────────────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={ctaBox}
              setBox={setCtaBox}
              className={`${layerClass('cta')} banner-layer--cta`}
              layerKey="cta"
              setDraggingKey={setDraggingKey}
              viewportScale={scale}
              minWidth={160}
              minHeight={52}
              dragHandleOnly
              dragControls={ctaDragControls}
            >
              <div className="banner-text-shell min-w-[160px]">
                <div
                  className="banner-cta-drag-handle"
                  title="גרור להזזה"
                  onPointerDown={(e) => ctaDragControls.start(e)}
                >
                  <span className="banner-cta-drag-grip" aria-hidden />
                  <span className="banner-cta-drag-label">גרור</span>
                </div>
                <div className="mt-1 text-right" dir="rtl">
                  <EditableText
                    className="banner-text banner-cta inline-block min-w-[120px] max-w-full whitespace-nowrap"
                    text={cta}
                    resetKey={taskId}
                    onTextChange={setCta}
                    style={{
                      backgroundColor: ctaBgHex,
                      color: ctaFgHex,
                      boxShadow: `0 10px 36px ${ctaBgHex}66`,
                    }}
                  />
                </div>
              </div>
            </BannerLayer>

          </div>
        </div>
      </div>

      {/* ── Download row ──────────────────────────────────────────── */}
      <div className="banner-download-row">
        <button
          type="button"
          className="btn-download"
          onClick={handleDownload}
          disabled={exporting}
        >
          {exporting ? 'מכין PNG…' : '⬇ הורד באנר PNG'}
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
