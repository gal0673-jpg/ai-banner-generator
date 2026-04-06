/**
 * BannerCanvas2 — "Immersive Full-Canvas" design (Design 2).
 *
 * Layout philosophy
 * ─────────────────
 *  • Background image fills the entire 1080×1080 canvas.
 *  • A rich dark vignette overlay creates readability without hiding the image.
 *  • Thin brand-colour accent bar on the left edge.
 *  • Brand-colour glow in top-right corner adds depth.
 *  • Logo — top right, white drop-shadow for contrast.
 *  • Headline — very large, white, right-aligned (RTL).
 *  • Subhead  — white/85%, slightly smaller.
 *  • Feature pills — 3 dark-glass horizontal cards (no backdrop-filter
 *    dependency so html-to-image export renders correctly).
 *  • CTA button — brand colour, full width of content area.
 *  • Bottom strip — brand colour with domain URL.
 *
 * All layers are independently draggable and text-editable, identical to Design 1.
 * This file is intentionally self-contained — it copies necessary utilities so
 * BannerCanvas.jsx is never touched.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { motion as Motion, useDragControls } from 'framer-motion'
import { Resizable } from 're-resizable'
import { toPng } from 'html-to-image'
import './BannerCanvas2.css'

// ─── Default font sizes for Design 2 (+10% over original CSS) ────────────────
const DF2 = { headline: 66, subhead: 26, bullets: 18, cta: 31 }

function colorInputHex(hex) {
  if (!hex || typeof hex !== 'string') return '#000000'
  let s = hex.trim()
  if (!s.startsWith('#')) s = `#${s}`
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase()
  return '#000000'
}

// ─── Default text colours (Design 2 — dark / immersive) ──────────────────────
const DC2 = { headline: '#ffffff', subhead: '#e6e6e6', bullets: '#ebebeb' }

// ─── TextControls — top-right corner (hidden during PNG export) ────────────
function TextControls2({ fontSize, onFontSize, align, onAlign, color, onColor }) {
  const stopDrag = (e) => { e.stopPropagation() }
  const stopBtn = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const cv = colorInputHex(color)
  return (
    <div className="banner-text-controls" onMouseDown={stopDrag} onClick={stopDrag}>
      <div className="btc-group">
        <button type="button" className="btc-btn" onMouseDown={(e) => { stopBtn(e); onFontSize(Math.max(10, fontSize - 2)) }} title="הקטן גופן">A−</button>
        <span className="btc-val">{fontSize}px</span>
        <button type="button" className="btc-btn" onMouseDown={(e) => { stopBtn(e); onFontSize(Math.min(130, fontSize + 2)) }} title="הגדל גופן">A+</button>
      </div>
      <span className="btc-sep" aria-hidden />
      <label className="btc-color-wrap" title="צבע טקסט" onMouseDown={stopDrag}>
        <span className="btc-color-swatch" style={{ backgroundColor: cv }} aria-hidden />
        <input
          type="color"
          className="btc-color-input"
          value={cv}
          onChange={(e) => onColor(e.target.value)}
          onMouseDown={stopDrag}
          aria-label="צבע טקסט"
        />
      </label>
      <span className="btc-sep" aria-hidden />
      <div className="btc-group">
        {[['right','ימין'],['center','מרכז'],['left','שמאל']].map(([a, label]) => (
          <button
            type="button"
            key={a}
            className={`btc-btn${align === a ? ' btc-btn--on' : ''}`}
            onMouseDown={(e) => { stopBtn(e); onAlign(a) }}
            title={label}
          >{label}</button>
        ))}
      </div>
    </div>
  )
}

// ─── Layout constants ─────────────────────────────────────────────────────────
const BANNER_PX   = 1080
const STRIP_H     = 64
const ACCENT_W    = 6      // brand-colour left bar
const CONTENT_PAD = 64     // horizontal padding for text content
const CONTENT_W   = BANNER_PX - CONTENT_PAD * 2   // 952

const DEFAULT_BRAND_HEX = '#4F46E5'

// Default layer positions — elements spread across the full canvas
const DEFAULT_LOGO     = { x: BANNER_PX - CONTENT_PAD - 210, y: 50,  width: 210, height: 78  }
const DEFAULT_HEADLINE = { x: CONTENT_PAD,                   y: 210, width: CONTENT_W, height: 230 }
const DEFAULT_SUBHEAD  = { x: CONTENT_PAD,                   y: 456, width: CONTENT_W, height: 110 }
const DEFAULT_BULLETS  = { x: CONTENT_PAD,                   y: 580, width: CONTENT_W, height: 252 }
const DEFAULT_CTA      = { x: CONTENT_PAD + 80,              y: 846, width: CONTENT_W - 160, height: 88 }

// ─── Utility helpers (self-contained copy) ────────────────────────────────────

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
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function contrastingTextColor(bgHex) {
  const h = (bgHex?.startsWith('#') ? bgHex : DEFAULT_BRAND_HEX).slice(1)
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
            if (typeof img.decode === 'function') img.decode().then(resolve).catch(resolve)
            else resolve()
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
    const next = text ?? ''
    if (el.textContent !== next) el.textContent = next
  }, [text, resetKey])
  const emit = (el) => {
    onTextChange?.(el.textContent ?? '')
  }
  const common = {
    ref, dir, className, style,
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    onMouseDown: (e) => e.stopPropagation(),
    onInput: (e) => emit(e.currentTarget),
    onBlur: (e) => emit(e.currentTarget),
  }
  return as === 'span' ? <span {...common} /> : <div {...common} />
}

// ─── Resize config ────────────────────────────────────────────────────────────

const RESIZE_ENABLE = {
  top: false, left: false, topLeft: false, topRight: false, bottomLeft: false,
  right: true, bottom: true, bottomRight: true,
}

// ─── BannerLayer2 ─────────────────────────────────────────────────────────────

function BannerLayer2({
  canvasRef, box, setBox, className, layerKey, setDraggingKey,
  viewportScale, minWidth, minHeight, lockAspectRatio, dragHandleOnly, dragControls, children,
  onUserCommit,
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
        onUserCommit?.()
      }}
    >
      <Resizable
        size={{ width: box.width, height: box.height }}
        scale={viewportScale}
        minWidth={minWidth}
        minHeight={minHeight}
        lockAspectRatio={lockAspectRatio}
        enable={RESIZE_ENABLE}
        handleWrapperClass="bc2-resize-handle-root"
        onResizeStop={(_e, _dir, ref) => {
          setBox((b) => ({ ...b, width: ref.offsetWidth, height: ref.offsetHeight }))
          onUserCommit?.()
        }}
        className="box-border h-full w-full"
        style={{ display: 'block', boxSizing: 'border-box' }}
      >
        <div className="bc2-layer-inner box-border h-full w-full overflow-visible p-1">
          {children}
        </div>
      </Resizable>
    </Motion.div>
  )
}

function buildDesign2CanvasSlice(s) {
  return {
    headline: s.headline,
    subhead: s.subhead,
    cta: s.cta,
    bullets: s.bullets,
    brand_color: s.brand_color,
    logoBox: s.logoBox,
    headlineBox: s.headlineBox,
    subheadBox: s.subheadBox,
    bulletsBox: s.bulletsBox,
    ctaBox: s.ctaBox,
    headlineFs: s.headlineFs,
    headlineAlign: s.headlineAlign,
    headlineColor: s.headlineColor,
    subheadFs: s.subheadFs,
    subheadAlign: s.subheadAlign,
    subheadColor: s.subheadColor,
    bulletsFs: s.bulletsFs,
    bulletsAlign: s.bulletsAlign,
    bulletsColor: s.bulletsColor,
    ctaFs: s.ctaFs,
    ctaAlign: s.ctaAlign,
    ctaColor: s.ctaColor,
  }
}

function applyDesign2Slice(slice, setters) {
  const {
    setLogoBox, setHeadlineBox, setSubheadBox, setBulletsBox, setCtaBox,
    setHeadlineFs, setHeadlineAlign, setHeadlineColor,
    setSubheadFs, setSubheadAlign, setSubheadColor,
    setBulletsFs, setBulletsAlign, setBulletsColor,
    setCtaFs, setCtaAlign, setCtaColor,
  } = setters
  if (!slice || typeof slice !== 'object') return
  if (slice.logoBox) setLogoBox({ ...slice.logoBox })
  if (slice.headlineBox) setHeadlineBox({ ...slice.headlineBox })
  if (slice.subheadBox) setSubheadBox({ ...slice.subheadBox })
  if (slice.bulletsBox) setBulletsBox({ ...slice.bulletsBox })
  if (slice.ctaBox) setCtaBox({ ...slice.ctaBox })
  if (typeof slice.headlineFs === 'number') setHeadlineFs(slice.headlineFs)
  if (slice.headlineAlign) setHeadlineAlign(slice.headlineAlign)
  if (slice.headlineColor) setHeadlineColor(slice.headlineColor)
  if (typeof slice.subheadFs === 'number') setSubheadFs(slice.subheadFs)
  if (slice.subheadAlign) setSubheadAlign(slice.subheadAlign)
  if (slice.subheadColor) setSubheadColor(slice.subheadColor)
  if (typeof slice.bulletsFs === 'number') setBulletsFs(slice.bulletsFs)
  if (slice.bulletsAlign) setBulletsAlign(slice.bulletsAlign)
  if (slice.bulletsColor) setBulletsColor(slice.bulletsColor)
  if (typeof slice.ctaFs === 'number') setCtaFs(slice.ctaFs)
  if (slice.ctaAlign) setCtaAlign(slice.ctaAlign)
  if (slice.ctaColor) setCtaColor(slice.ctaColor)
}

// ─── BannerCanvas2 ───────────────────────────────────────────────────────────

export default function BannerCanvas2({
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
  savedCanvasSlice,
  onPersist,
  onRenderVideo,
  isRenderingVideo = false,
}) {
  const viewportRef = useRef(null)
  const captureRef  = useRef(null)
  const reactSuffix = useId().replace(/:/g, '')
  const surfaceId   = taskId ? `bc2-surface-${taskId}` : `bc2-surface-${reactSuffix}`

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

  // ── Typography controls state ────────────────────────────────────────────
  const [headlineFs,    setHeadlineFs]    = useState(DF2.headline)
  const [headlineAlign, setHeadlineAlign] = useState('right')
  const [subheadFs,     setSubheadFs]     = useState(DF2.subhead)
  const [subheadAlign,  setSubheadAlign]  = useState('right')
  const [bulletsFs,     setBulletsFs]     = useState(DF2.bullets)
  const [bulletsAlign,  setBulletsAlign]  = useState('right')
  const [ctaFs,         setCtaFs]         = useState(DF2.cta)
  const [ctaAlign,      setCtaAlign]      = useState('center')
  const [headlineColor, setHeadlineColor] = useState(DC2.headline)
  const [subheadColor,  setSubheadColor]  = useState(DC2.subhead)
  const [bulletsColor,  setBulletsColor]  = useState(DC2.bullets)
  const [ctaColor,      setCtaColor]      = useState('#ffffff')

  const persistTimerRef = useRef(null)
  const stateRef = useRef({})

  const flushPersist = useCallback(() => {
    if (!onPersist || !taskId) return
    const s = stateRef.current
    onPersist({
      headline: s.headline,
      subhead: s.subhead,
      cta: s.cta,
      bullet_points: s.bullets,
      canvas_state: { v: 1, design2: buildDesign2CanvasSlice(s) },
    })
  }, [onPersist, taskId])

  const flushPersistRef = useRef(flushPersist)
  flushPersistRef.current = flushPersist

  const schedulePersist = useCallback(() => {
    if (!onPersist || !taskId) return
    clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      flushPersist()
    }, 1000)
  }, [onPersist, taskId, flushPersist])

  useEffect(
    () => () => {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
      flushPersistRef.current()
    },
    [],
  )

  useEffect(() => {
    stateRef.current = {
      headline,
      subhead,
      bullets,
      cta,
      brand_color: brandColor,
      logoBox,
      headlineBox,
      subheadBox,
      bulletsBox,
      ctaBox,
      headlineFs,
      headlineAlign,
      headlineColor,
      subheadFs,
      subheadAlign,
      subheadColor,
      bulletsFs,
      bulletsAlign,
      bulletsColor,
      ctaFs,
      ctaAlign,
      ctaColor,
    }
  }, [
    headline, subhead, bullets, cta,
    logoBox, headlineBox, subheadBox, bulletsBox, ctaBox,
    headlineFs, headlineAlign, headlineColor,
    subheadFs, subheadAlign, subheadColor,
    bulletsFs, bulletsAlign, bulletsColor,
    ctaFs, ctaAlign, ctaColor,
    brandColor,
  ])

  const bulletsKey = bulletPoints ? JSON.stringify(bulletPoints) : ''
  const savedSliceKey = useMemo(
    () => (savedCanvasSlice && typeof savedCanvasSlice === 'object' ? JSON.stringify(savedCanvasSlice) : ''),
    [savedCanvasSlice],
  )

  useEffect(() => {
    setHeadline(headlineInitial ?? '')
    setSubhead(subheadInitial ?? '')
    setBullets([...(bulletPoints || [])])
    setCta(ctaInitial ?? '')
    setLogoBox({ ...DEFAULT_LOGO })
    setHeadlineBox({ ...DEFAULT_HEADLINE })
    setSubheadBox({ ...DEFAULT_SUBHEAD })
    setBulletsBox({ ...DEFAULT_BULLETS })
    setCtaBox({ ...DEFAULT_CTA })
    setDraggingKey(null)
    setHeadlineFs(DF2.headline)
    setHeadlineAlign('right')
    setSubheadFs(DF2.subhead)
    setSubheadAlign('right')
    setBulletsFs(DF2.bullets)
    setBulletsAlign('right')
    setCtaFs(DF2.cta)
    setCtaAlign('center')
    setHeadlineColor(DC2.headline)
    setSubheadColor(DC2.subhead)
    setBulletsColor(DC2.bullets)
    const bg = normalizeBrandHex(brandColor)
    setCtaColor(contrastingTextColor(bg))
    if (savedCanvasSlice && typeof savedCanvasSlice === 'object') {
      applyDesign2Slice(savedCanvasSlice, {
        setLogoBox,
        setHeadlineBox,
        setSubheadBox,
        setBulletsBox,
        setCtaBox,
        setHeadlineFs,
        setHeadlineAlign,
        setHeadlineColor,
        setSubheadFs,
        setSubheadAlign,
        setSubheadColor,
        setBulletsFs,
        setBulletsAlign,
        setBulletsColor,
        setCtaFs,
        setCtaAlign,
        setCtaColor,
      })
    }
  }, [
    taskId,
    bulletsKey,
    bulletPoints,
    savedSliceKey,
    headlineInitial,
    subheadInitial,
    ctaInitial,
    brandColor,
    savedCanvasSlice,
  ])

  const setBulletAt = useCallback((index, value) => {
    setBullets((prev) => {
      const n = [...prev]
      n[index] = value
      return n
    })
    schedulePersist()
  }, [schedulePersist])

  const bgSrc    = backgroundUrl ? `${apiBase}${backgroundUrl}` : ''
  const logoSrc  = logoUrl       ? `${apiBase}${logoUrl}`       : ''
  const ctaBgHex = normalizeBrandHex(brandColor)
  const ctaFgHex = contrastingTextColor(ctaBgHex)
  const [brandR, brandG, brandB] = hexToRgb(ctaBgHex)
  const domain = extractDomain(siteUrl)

  // Deep cinematic vignette — darker at edges, lighter in the center-left area
  const overlay = [
    `radial-gradient(ellipse at 70% 40%, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.72) 90%)`,
    `linear-gradient(165deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.55) 100%)`,
  ].join(', ')

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
        backgroundColor: '#0f172a',
        style: { transform: 'scale(1)', colorScheme: 'light' },
        filter: (el) => {
          if (el.classList?.contains('bc2-resize-handle-root')) return false
          if (el.closest?.('.bc2-resize-handle-root')) return false
          if (el.classList?.contains('bc2-cta-drag-handle')) return false
          if (el.classList?.contains('banner-text-controls')) return false
          if (el.closest?.('.banner-text-controls')) return false
          return true
        },
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `banner2-${(taskId || 'export').slice(0, 8)}.png`
      a.click()
    } catch (e) {
      setDownloadError(e.message || String(e))
    } finally {
      setExporting(false)
    }
  }, [taskId])

  const layerClass = (id) =>
    `bc2-layer bc2-layer--${id}${draggingKey === id ? ' bc2-layer--dragging' : ''}`

  const bgImageStyle = bgSrc ? { backgroundImage: `url(${JSON.stringify(bgSrc)})` } : undefined

  return (
    <div className="bc2-root w-full max-w-full">
      <div className="bc2-viewport" ref={viewportRef} dir="ltr">
        <div
          className="bc2-viewport-inner"
          style={{ width: BANNER_PX * scale, height: BANNER_PX * scale }}
        >
          <div
            ref={captureRef}
            id={surfaceId}
            dir="ltr"
            className={`absolute left-0 top-0 w-[1080px] h-[1080px] shrink-0 origin-top-left overflow-hidden bc2-canvas${exporting ? ' bc2-capture' : ''}`}
            style={{ transform: `scale(${scale})` }}
          >

            {/* ── Full-bleed background ────────────────────────────── */}
            <div
              className={`absolute inset-0 bg-cover bg-center bg-no-repeat pointer-events-none ${bgSrc ? '' : 'bg-slate-900'}`}
              style={bgImageStyle}
              aria-hidden
            />
            {bgSrc && (
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
            )}

            {/* ── Dark vignette overlay ─────────────────────────────── */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: overlay }}
              aria-hidden
            />

            {/* ── Brand-colour glow (top-right accent) ─────────────── */}
            <div
              className="absolute pointer-events-none"
              style={{
                width: 500,
                height: 500,
                borderRadius: '50%',
                top: -150,
                right: -100,
                background: `radial-gradient(circle, rgba(${brandR},${brandG},${brandB},0.28) 0%, transparent 70%)`,
              }}
              aria-hidden
            />

            {/* ── Thin brand accent bar (left edge) ────────────────── */}
            <div
              className="absolute top-0 left-0 pointer-events-none"
              style={{ width: ACCENT_W, height: BANNER_PX - STRIP_H, backgroundColor: ctaBgHex }}
              aria-hidden
            />

            {/* ── Bottom strip ─────────────────────────────────────── */}
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
                    fontSize: 22,
                    fontWeight: 700,
                    direction: 'ltr',
                    letterSpacing: '0.4px',
                  }}
                >
                  {domain}
                </span>
              )}
            </div>

            {/* ── Logo ─────────────────────────────────────────────── */}
            <BannerLayer2
              canvasRef={captureRef}
              box={logoBox} setBox={setLogoBox}
              className={layerClass('logo')} layerKey="logo"
              setDraggingKey={setDraggingKey} viewportScale={scale}
              minWidth={80} minHeight={48} lockAspectRatio
              onUserCommit={schedulePersist}
            >
              <img
                src={logoSrc}
                alt=""
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                loading="eager"
                decoding="async"
                draggable={false}
                className="bc2-logo-img mx-auto block max-h-full max-w-full object-contain"
              />
            </BannerLayer2>

            {/* ── Headline ─────────────────────────────────────────── */}
            <BannerLayer2
              canvasRef={captureRef}
              box={headlineBox} setBox={setHeadlineBox}
              className={`${layerClass('headline')} bc2-layer--text`} layerKey="headline"
              setDraggingKey={setDraggingKey} viewportScale={scale}
              minWidth={280} minHeight={60}
              onUserCommit={schedulePersist}
            >
              <TextControls2
                fontSize={headlineFs}
                onFontSize={(v) => { setHeadlineFs(v); schedulePersist() }}
                align={headlineAlign}
                onAlign={(v) => { setHeadlineAlign(v); schedulePersist() }}
                color={headlineColor}
                onColor={(v) => { setHeadlineColor(v); schedulePersist() }}
              />
              <div className="bc2-text-shell" dir="rtl">
                <EditableText
                  className="bc2-text bc2-headline whitespace-normal"
                  style={{ fontSize: headlineFs, textAlign: headlineAlign, color: headlineColor }}
                  text={headline} resetKey={taskId}
                  onTextChange={(v) => { setHeadline(v); schedulePersist() }}
                />
              </div>
            </BannerLayer2>

            {/* ── Subhead ──────────────────────────────────────────── */}
            <BannerLayer2
              canvasRef={captureRef}
              box={subheadBox} setBox={setSubheadBox}
              className={`${layerClass('subhead')} bc2-layer--text`} layerKey="subhead"
              setDraggingKey={setDraggingKey} viewportScale={scale}
              minWidth={280} minHeight={48}
              onUserCommit={schedulePersist}
            >
              <TextControls2
                fontSize={subheadFs}
                onFontSize={(v) => { setSubheadFs(v); schedulePersist() }}
                align={subheadAlign}
                onAlign={(v) => { setSubheadAlign(v); schedulePersist() }}
                color={subheadColor}
                onColor={(v) => { setSubheadColor(v); schedulePersist() }}
              />
              <div className="bc2-text-shell" dir="rtl">
                <EditableText
                  className="bc2-text bc2-subhead whitespace-normal"
                  style={{ fontSize: subheadFs, textAlign: subheadAlign, color: subheadColor }}
                  text={subhead} resetKey={taskId}
                  onTextChange={(v) => { setSubhead(v); schedulePersist() }}
                />
              </div>
            </BannerLayer2>

            {/* ── Feature glass-pills ───────────────────────────────── */}
            <BannerLayer2
              canvasRef={captureRef}
              box={bulletsBox} setBox={setBulletsBox}
              className={`${layerClass('bullets')} bc2-layer--text`} layerKey="bullets"
              setDraggingKey={setDraggingKey} viewportScale={scale}
              minWidth={280} minHeight={200}
              onUserCommit={schedulePersist}
            >
              <TextControls2
                fontSize={bulletsFs}
                onFontSize={(v) => { setBulletsFs(v); schedulePersist() }}
                align={bulletsAlign}
                onAlign={(v) => { setBulletsAlign(v); schedulePersist() }}
                color={bulletsColor}
                onColor={(v) => { setBulletsColor(v); schedulePersist() }}
              />
              <div className="bc2-feat-grid" dir="rtl">
                {bullets.map((b, i) => (
                  <div
                    key={`${taskId}-b-${i}`}
                    className="bc2-feat-pill"
                    style={{ borderTopColor: ctaBgHex }}
                  >
                    <div
                      className="bc2-feat-icon"
                      style={{ backgroundColor: ctaBgHex, color: ctaFgHex }}
                    >
                      ✓
                    </div>
                    <EditableText
                      as="span"
                      className="bc2-feat-text"
                      style={{ fontSize: bulletsFs, textAlign: bulletsAlign, color: bulletsColor }}
                      text={b}
                      resetKey={`${taskId}-${i}`}
                      onTextChange={(t) => setBulletAt(i, t)}
                    />
                  </div>
                ))}
              </div>
            </BannerLayer2>

            {/* ── CTA ──────────────────────────────────────────────── */}
            <BannerLayer2
              canvasRef={captureRef}
              box={ctaBox} setBox={setCtaBox}
              className={`${layerClass('cta')} bc2-layer--cta`} layerKey="cta"
              setDraggingKey={setDraggingKey} viewportScale={scale}
              minWidth={160} minHeight={52}
              dragHandleOnly dragControls={ctaDragControls}
              onUserCommit={schedulePersist}
            >
              <TextControls2
                fontSize={ctaFs}
                onFontSize={(v) => { setCtaFs(v); schedulePersist() }}
                align={ctaAlign}
                onAlign={(v) => { setCtaAlign(v); schedulePersist() }}
                color={ctaColor}
                onColor={(v) => { setCtaColor(v); schedulePersist() }}
              />
              <div className="bc2-text-shell">
                <div
                  className="bc2-cta-drag-handle"
                  title="גרור להזזה"
                  onPointerDown={(e) => ctaDragControls.start(e)}
                >
                  <span className="bc2-cta-drag-grip" aria-hidden />
                  <span className="bc2-cta-drag-label">גרור</span>
                </div>
                <div className="mt-1" style={{ textAlign: ctaAlign }} dir="rtl">
                  <EditableText
                    className="bc2-text bc2-cta inline-block min-w-[120px] max-w-full whitespace-nowrap"
                    text={cta} resetKey={taskId}
                    onTextChange={(v) => { setCta(v); schedulePersist() }}
                    style={{
                      fontSize: ctaFs,
                      backgroundColor: ctaBgHex,
                      color: ctaColor,
                      boxShadow: `0 12px 40px rgba(${brandR},${brandG},${brandB},0.55)`,
                    }}
                  />
                </div>
              </div>
            </BannerLayer2>

          </div>
        </div>
      </div>

      {/* ── Download row ─────────────────────────────────────────── */}
      <div className="bc2-download-row">
        <button
          type="button"
          className="bc2-btn-download"
          onClick={handleDownload}
          disabled={exporting}
        >
          {exporting ? 'מכין PNG…' : '⬇ הורד באנר PNG'}
        </button>
        {typeof onRenderVideo === 'function' && (
          <button
            type="button"
            className="bc2-btn-download"
            onClick={onRenderVideo}
            disabled={isRenderingVideo}
          >
            {isRenderingVideo ? 'מייצר וידאו…' : '🎬 ייצר סרטון אנימציה'}
          </button>
        )}
      </div>
      {downloadError && (
        <p className="bc2-download-error" role="alert">{downloadError}</p>
      )}
    </div>
  )
}
