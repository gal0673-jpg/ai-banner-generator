/**
 * BannerCanvas2 — "Immersive Full-Canvas" design (Design 2).
 * Supports both 1:1 (square feed) and 9:16 (vertical/shorts) via the aspectRatio prop.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useDragControls } from 'framer-motion'
import './BannerCanvas2.css'
import BannerLayer from './components/canvas/BannerLayer.jsx'
import EditableText from './components/canvas/EditableText.jsx'
import TextControls from './components/canvas/TextControls.jsx'
import {
  BANNER_SQUARE_1_1,
  BANNER_VERTICAL_9_16,
  captureBannerNodeToPng,
  contrastingTextColor,
  extractDomain,
  hexToRgb,
  normalizeBrandHex,
} from './components/canvas/canvasUtils.js'
import { DESIGN2_DEFAULT_BOXES_VERTICAL, useBannerCanvasState } from './components/canvas/useBannerCanvasState.js'

// ─── Design 2 typography defaults ────────────────────────────────────────────
const DF2 = { headline: 66, subhead: 26, bullets: 18, cta: 31 }
const DC2 = { headline: '#ffffff', subhead: '#e6e6e6', bullets: '#ebebeb' }

// ─── Shared layout constants ─────────────────────────────────────────────────
const STRIP_H = 64
const ACCENT_W = 6
const CONTENT_PAD = 64
const CONTENT_W = 1080 - CONTENT_PAD * 2   // 952

// ─── Default layer boxes — square vs vertical ─────────────────────────────────
const DESIGN2_SQUARE_BOXES = {
  logo:     { x: 1080 - CONTENT_PAD - 210, y: 50,  width: 210,            height: 78  },
  headline: { x: CONTENT_PAD,              y: 210, width: CONTENT_W,      height: 230 },
  subhead:  { x: CONTENT_PAD,              y: 456, width: CONTENT_W,      height: 110 },
  bullets:  { x: CONTENT_PAD,              y: 580, width: CONTENT_W,      height: 252 },
  cta:      { x: CONTENT_PAD + 80,         y: 846, width: CONTENT_W - 160, height: 88  },
}

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
  aspectRatio = '1:1',
}) {
  const isVertical = aspectRatio === '9:16'
  const designSize = isVertical ? BANNER_VERTICAL_9_16 : BANNER_SQUARE_1_1
  const BANNER_W = designSize.width   // always 1080
  const BANNER_H = designSize.height  // 1080 or 1920

  const defaultBoxes = isVertical ? DESIGN2_DEFAULT_BOXES_VERTICAL : DESIGN2_SQUARE_BOXES
  const persistDesignKey = isVertical ? 'design2_vertical' : 'design2'

  const viewportRef = useRef(null)
  const captureRef = useRef(null)
  const reactSuffix = useId().replace(/:/g, '')
  const surfaceId = taskId ? `bc2-surface-${taskId}` : `bc2-surface-${reactSuffix}`

  const ctaDragControls = useDragControls()

  const [scale, setScale] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [downloadError, setDownloadError] = useState(null)

  const canvasState = useBannerCanvasState({
    taskId,
    brandColor,
    headlineInitial,
    subheadInitial,
    bulletPoints,
    ctaInitial,
    savedCanvasSlice,
    onPersist,
    persistDesignKey,
    defaults: {
      fontSizes: DF2,
      textColors: DC2,
      boxes: defaultBoxes,
    },
  })

  const {
    headline, setHeadline,
    subhead, setSubhead,
    bullets,
    cta, setCta,
    logoBox, setLogoBox,
    headlineBox, setHeadlineBox,
    subheadBox, setSubheadBox,
    bulletsBox, setBulletsBox,
    ctaBox, setCtaBox,
    draggingKey, setDraggingKey,
    headlineFs, setHeadlineFs,
    headlineAlign, setHeadlineAlign,
    headlineColor, setHeadlineColor,
    subheadFs, setSubheadFs,
    subheadAlign, setSubheadAlign,
    subheadColor, setSubheadColor,
    bulletsFs, setBulletsFs,
    bulletsAlign, setBulletsAlign,
    bulletsColor, setBulletsColor,
    ctaFs, setCtaFs,
    ctaAlign, setCtaAlign,
    ctaColor, setCtaColor,
    schedulePersist,
    setBulletAt,
  } = canvasState

  const bgSrc   = backgroundUrl ? `${apiBase}${backgroundUrl}` : ''
  const logoSrc = logoUrl       ? `${apiBase}${logoUrl}`       : ''
  const ctaBgHex = normalizeBrandHex(brandColor)
  const ctaFgHex = contrastingTextColor(ctaBgHex)
  const [brandR, brandG, brandB] = hexToRgb(ctaBgHex)
  const domain = extractDomain(siteUrl)

  const overlay = [
    'radial-gradient(ellipse at 70% 40%, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.72) 90%)',
    'linear-gradient(165deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.55) 100%)',
  ].join(', ')

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (w > 0) setScale(w / BANNER_W)
    })
    ro.observe(el)
    setScale(el.clientWidth / BANNER_W)
    return () => ro.disconnect()
  }, [BANNER_W])

  const handleDownload = useCallback(async () => {
    const node = captureRef.current
    if (!node) return
    setDownloadError(null)
    setExporting(true)
    try {
      const dataUrl = await captureBannerNodeToPng(node, {
        width: BANNER_W,
        height: BANNER_H,
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
      a.download = `banner2-d2${isVertical ? '-vertical' : ''}-${(taskId || 'export').slice(0, 8)}.png`
      a.click()
    } catch (e) {
      setDownloadError(e.message || String(e))
    } finally {
      setExporting(false)
    }
  }, [taskId, BANNER_W, BANNER_H, isVertical])

  const layerClass = (id) =>
    `bc2-layer bc2-layer--${id}${draggingKey === id ? ' bc2-layer--dragging' : ''}`

  const bgImageStyle = bgSrc ? { backgroundImage: `url(${JSON.stringify(bgSrc)})` } : undefined

  return (
    <div className="bc2-root w-full max-w-full">
      <div className="bc2-viewport" ref={viewportRef} dir="ltr">
        <div
          className="bc2-viewport-inner"
          style={{ width: BANNER_W * scale, height: BANNER_H * scale }}
        >
          <div
            ref={captureRef}
            id={surfaceId}
            dir="ltr"
            className={`absolute left-0 top-0 shrink-0 origin-top-left overflow-hidden bc2-canvas${exporting ? ' bc2-capture' : ''}`}
            style={{ width: BANNER_W, height: BANNER_H, transform: `scale(${scale})` }}
          >

            {/* ── Full-bleed background ────────────────────────────── */}
            <div
              className={`absolute inset-0 bg-cover bg-center bg-no-repeat pointer-events-none ${bgSrc ? '' : 'bg-slate-900'}`}
              style={bgImageStyle}
              aria-hidden
            />
            {bgSrc && (
              <img
                src={bgSrc} alt=""
                crossOrigin="anonymous" referrerPolicy="no-referrer"
                loading="eager" decoding="async"
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
                width: 500, height: 500, borderRadius: '50%',
                top: -150, right: -100,
                background: `radial-gradient(circle, rgba(${brandR},${brandG},${brandB},0.28) 0%, transparent 70%)`,
              }}
              aria-hidden
            />

            {/* ── Thin brand accent bar (left edge) ────────────────── */}
            <div
              className="absolute top-0 left-0 pointer-events-none"
              style={{ width: ACCENT_W, height: BANNER_H - STRIP_H, backgroundColor: ctaBgHex }}
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
            <BannerLayer
              canvasRef={captureRef}
              box={logoBox} setBox={setLogoBox}
              className={layerClass('logo')} layerKey="logo"
              setDraggingKey={setDraggingKey} viewportScale={scale}
              minWidth={80} minHeight={48} lockAspectRatio
              onUserCommit={schedulePersist}
              handleWrapperClass="bc2-resize-handle-root"
              layerInnerClass="bc2-layer-inner"
              designSize={designSize}
            >
              <img
                src={logoSrc} alt=""
                crossOrigin="anonymous" referrerPolicy="no-referrer"
                loading="eager" decoding="async" draggable={false}
                className="bc2-logo-img mx-auto block max-h-full max-w-full object-contain"
              />
            </BannerLayer>

            {/* ── Headline ─────────────────────────────────────────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={headlineBox} setBox={setHeadlineBox}
              className={`${layerClass('headline')} bc2-layer--text`} layerKey="headline"
              setDraggingKey={setDraggingKey} viewportScale={scale}
              minWidth={280} minHeight={60}
              onUserCommit={schedulePersist}
              handleWrapperClass="bc2-resize-handle-root"
              layerInnerClass="bc2-layer-inner"
              designSize={designSize}
            >
              <TextControls
                fontSize={headlineFs} onFontSize={(v) => { setHeadlineFs(v); schedulePersist() }}
                align={headlineAlign} onAlign={(v) => { setHeadlineAlign(v); schedulePersist() }}
                color={headlineColor} onColor={(v) => { setHeadlineColor(v); schedulePersist() }}
              />
              <div className="bc2-text-shell" dir="rtl">
                <EditableText
                  className="bc2-text bc2-headline whitespace-normal"
                  style={{ fontSize: headlineFs, textAlign: headlineAlign, color: headlineColor }}
                  text={headline} resetKey={taskId}
                  onTextChange={(v) => { setHeadline(v); schedulePersist() }}
                />
              </div>
            </BannerLayer>

            {/* ── Subhead ──────────────────────────────────────────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={subheadBox} setBox={setSubheadBox}
              className={`${layerClass('subhead')} bc2-layer--text`} layerKey="subhead"
              setDraggingKey={setDraggingKey} viewportScale={scale}
              minWidth={280} minHeight={48}
              onUserCommit={schedulePersist}
              handleWrapperClass="bc2-resize-handle-root"
              layerInnerClass="bc2-layer-inner"
              designSize={designSize}
            >
              <TextControls
                fontSize={subheadFs} onFontSize={(v) => { setSubheadFs(v); schedulePersist() }}
                align={subheadAlign} onAlign={(v) => { setSubheadAlign(v); schedulePersist() }}
                color={subheadColor} onColor={(v) => { setSubheadColor(v); schedulePersist() }}
              />
              <div className="bc2-text-shell" dir="rtl">
                <EditableText
                  className="bc2-text bc2-subhead whitespace-normal"
                  style={{ fontSize: subheadFs, textAlign: subheadAlign, color: subheadColor }}
                  text={subhead} resetKey={taskId}
                  onTextChange={(v) => { setSubhead(v); schedulePersist() }}
                />
              </div>
            </BannerLayer>

            {/* ── Feature glass-pills ───────────────────────────────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={bulletsBox} setBox={setBulletsBox}
              className={`${layerClass('bullets')} bc2-layer--text`} layerKey="bullets"
              setDraggingKey={setDraggingKey} viewportScale={scale}
              minWidth={280} minHeight={200}
              onUserCommit={schedulePersist}
              handleWrapperClass="bc2-resize-handle-root"
              layerInnerClass="bc2-layer-inner"
              designSize={designSize}
            >
              <TextControls
                fontSize={bulletsFs} onFontSize={(v) => { setBulletsFs(v); schedulePersist() }}
                align={bulletsAlign} onAlign={(v) => { setBulletsAlign(v); schedulePersist() }}
                color={bulletsColor} onColor={(v) => { setBulletsColor(v); schedulePersist() }}
              />
              <div
                className={`bc2-feat-grid${isVertical ? ' bc2-feat-grid--vertical' : ''}`}
                dir="rtl"
              >
                {bullets.map((b, i) => (
                  <div
                    key={`${taskId}-b-${i}`}
                    className="bc2-feat-pill"
                    style={{ borderTopColor: ctaBgHex }}
                  >
                    <div className="bc2-feat-icon" style={{ backgroundColor: ctaBgHex, color: ctaFgHex }}>✓</div>
                    <EditableText
                      as="span"
                      className="bc2-feat-text"
                      style={{ fontSize: bulletsFs, textAlign: bulletsAlign, color: bulletsColor }}
                      text={b} resetKey={`${taskId}-${i}`}
                      onTextChange={(t) => setBulletAt(i, t)}
                    />
                  </div>
                ))}
              </div>
            </BannerLayer>

            {/* ── CTA ──────────────────────────────────────────────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={ctaBox} setBox={setCtaBox}
              className={`${layerClass('cta')} bc2-layer--cta`} layerKey="cta"
              setDraggingKey={setDraggingKey} viewportScale={scale}
              minWidth={160} minHeight={52}
              dragHandleOnly dragControls={ctaDragControls}
              onUserCommit={schedulePersist}
              handleWrapperClass="bc2-resize-handle-root"
              layerInnerClass="bc2-layer-inner"
              designSize={designSize}
            >
              <TextControls
                fontSize={ctaFs} onFontSize={(v) => { setCtaFs(v); schedulePersist() }}
                align={ctaAlign} onAlign={(v) => { setCtaAlign(v); schedulePersist() }}
                color={ctaColor} onColor={(v) => { setCtaColor(v); schedulePersist() }}
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
            </BannerLayer>

          </div>
        </div>
      </div>

      {/* ── Download row ─────────────────────────────────────────── */}
      <div className="bc2-download-row">
        <button type="button" className="bc2-btn-download" onClick={handleDownload} disabled={exporting}>
          {exporting ? 'מכין PNG…' : '⬇ הורד באנר PNG'}
        </button>
        {typeof onRenderVideo === 'function' && (
          <button type="button" className="bc2-btn-download" onClick={onRenderVideo} disabled={isRenderingVideo}>
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
