import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useDragControls } from 'framer-motion'
import './BannerCanvas.css'
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
import {
  computeDesign1VerticalMetrics,
  DESIGN1_DEFAULT_BOXES_VERTICAL,
  useBannerCanvasState,
} from './components/canvas/useBannerCanvasState.js'

// ─── Design 1 shared horizontal layout constants ──────────────────────────────
const DF = { headline: 51, subhead: 22, bullets: 18, cta: 26 }
const DC = { headline: '#0f172a', subhead: '#475569', bullets: '#1e293b' }

const LEFT_W = 475
const DIVIDER_W = 6
const RIGHT_X = LEFT_W + DIVIDER_W
const STRIP_H = 70
const RPAD = 44
const CONTENT_X = RIGHT_X + RPAD
const CONTENT_W = 1080 - CONTENT_X - RPAD  // 511
const LOGO_W = 200

// ─── Default layer boxes — two variants ──────────────────────────────────────
const DESIGN1_SQUARE_BOXES = {
  logo:     { x: 1080 - RPAD - LOGO_W, y: 44,  width: LOGO_W,    height: 72  },
  headline: { x: CONTENT_X,            y: 148, width: CONTENT_W, height: 210 },
  subhead:  { x: CONTENT_X,            y: 372, width: CONTENT_W, height: 110 },
  bullets:  { x: CONTENT_X,            y: 494, width: CONTENT_W, height: 292 },
  cta:      { x: CONTENT_X,            y: 802, width: CONTENT_W, height: 86  },
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
  const CONTENT_H = BANNER_H - STRIP_H

  const defaultBoxes = isVertical ? DESIGN1_DEFAULT_BOXES_VERTICAL : DESIGN1_SQUARE_BOXES
  const persistDesignKey = isVertical ? 'design1_vertical' : 'design1'
  const verticalMetrics = isVertical ? computeDesign1VerticalMetrics(BANNER_H) : null

  const viewportRef = useRef(null)
  const captureRef = useRef(null)
  const reactSurfaceSuffix = useId().replace(/:/g, '')
  const boundsSurfaceId = taskId
    ? `banner-surface-${taskId}`
    : `banner-surface-${reactSurfaceSuffix}`

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
      fontSizes: DF,
      textColors: DC,
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

  const leftOverlay = `linear-gradient(145deg, rgba(10,18,36,0.92) 0%, rgba(${brandR},${brandG},${brandB},0.58) 48%, rgba(10,18,36,0.82) 100%)`
  const rightPanelBg = `linear-gradient(155deg, #ffffff 0%, #f8fafc 55%, rgba(${brandR},${brandG},${brandB},0.07) 100%)`
  const domain = extractDomain(siteUrl)

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
          if (el.classList?.contains('banner-text-controls')) return false
          if (el.closest?.('.banner-text-controls')) return false
          return true
        },
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `banner-d1${isVertical ? '-vertical' : ''}-${(taskId || 'export').slice(0, 8)}.png`
      a.click()
    } catch (e) {
      setDownloadError(e.message || String(e))
    } finally {
      setExporting(false)
    }
  }, [taskId, BANNER_W, BANNER_H, isVertical])

  const layerClass = (id) =>
    `banner-layer banner-layer--${id}${draggingKey === id ? ' banner-layer--dragging' : ''}`

  const bgImageStyle = bgSrc !== '' ? { backgroundImage: `url(${JSON.stringify(bgSrc)})` } : undefined

  return (
    <div className="banner-canvas-root w-full max-w-full">
      <div className="banner-viewport" ref={viewportRef} dir="ltr">
        <div
          className="banner-viewport-inner"
          style={{ width: BANNER_W * scale, height: BANNER_H * scale }}
        >
          <div
            ref={captureRef}
            id={boundsSurfaceId}
            dir="ltr"
            className={`absolute left-0 top-0 shrink-0 origin-top-left overflow-hidden banner-canvas${exporting ? ' capture-mode' : ''}`}
            style={{ width: BANNER_W, height: BANNER_H, transform: `scale(${scale})` }}
          >

            {isVertical && verticalMetrics ? (
              <>
                {/* ── 9:16: top 40% — full-width image hero ───────────── */}
                <div
                  className="absolute left-0 top-0 pointer-events-none overflow-hidden"
                  style={{ width: BANNER_W, height: verticalMetrics.imageZoneH }}
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
                {/* ── Horizontal brand accent between zones ───────────── */}
                <div
                  className="absolute left-0 pointer-events-none"
                  style={{
                    top: verticalMetrics.imageZoneH,
                    width: BANNER_W,
                    height: verticalMetrics.dividerH,
                    backgroundColor: ctaBgHex,
                  }}
                  aria-hidden
                />
                {/* ── Bottom ~60% — text content panel ───────────────── */}
                <div
                  className="absolute left-0 pointer-events-none"
                  style={{
                    top: verticalMetrics.textZoneTop,
                    width: BANNER_W,
                    height: verticalMetrics.textZoneH,
                    background: rightPanelBg,
                  }}
                  aria-hidden
                />
              </>
            ) : (
              <>
                {/* ── 1:1: left photo panel ──────────────────────────── */}
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
                <div
                  className="absolute top-0 pointer-events-none"
                  style={{ left: LEFT_W, width: DIVIDER_W, height: CONTENT_H, backgroundColor: ctaBgHex }}
                  aria-hidden
                />
                <div
                  className="absolute top-0 pointer-events-none"
                  style={{ left: RIGHT_X, right: 0, height: CONTENT_H, background: rightPanelBg }}
                  aria-hidden
                />
              </>
            )}

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
              box={logoBox} setBox={setLogoBox}
              className={layerClass('logo')}
              layerKey="logo" setDraggingKey={setDraggingKey}
              viewportScale={scale} minWidth={80} minHeight={48}
              lockAspectRatio onUserCommit={schedulePersist}
              designSize={designSize}
            >
              <img
                src={logoSrc} alt=""
                crossOrigin="anonymous" referrerPolicy="no-referrer"
                loading="eager" decoding="async" draggable={false}
                className="banner-layer-logo-img mx-auto block max-h-full max-w-full object-contain"
              />
            </BannerLayer>

            {/* ── Headline layer ──────────────────────────────────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={headlineBox} setBox={setHeadlineBox}
              className={`${layerClass('headline')} banner-layer--text`}
              layerKey="headline" setDraggingKey={setDraggingKey}
              viewportScale={scale} minWidth={280} minHeight={56}
              onUserCommit={schedulePersist} designSize={designSize}
            >
              <TextControls
                fontSize={headlineFs} onFontSize={(v) => { setHeadlineFs(v); schedulePersist() }}
                align={headlineAlign} onAlign={(v) => { setHeadlineAlign(v); schedulePersist() }}
                color={headlineColor} onColor={(v) => { setHeadlineColor(v); schedulePersist() }}
              />
              <div className="banner-text-shell min-w-[280px]" dir="rtl">
                <EditableText
                  className="banner-text banner-headline min-w-[260px] whitespace-normal"
                  style={{ fontSize: headlineFs, textAlign: headlineAlign, color: headlineColor }}
                  text={headline} resetKey={taskId}
                  onTextChange={(v) => { setHeadline(v); schedulePersist() }}
                />
              </div>
            </BannerLayer>

            {/* ── Subhead layer ───────────────────────────────────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={subheadBox} setBox={setSubheadBox}
              className={`${layerClass('subhead')} banner-layer--text`}
              layerKey="subhead" setDraggingKey={setDraggingKey}
              viewportScale={scale} minWidth={280} minHeight={48}
              onUserCommit={schedulePersist} designSize={designSize}
            >
              <TextControls
                fontSize={subheadFs} onFontSize={(v) => { setSubheadFs(v); schedulePersist() }}
                align={subheadAlign} onAlign={(v) => { setSubheadAlign(v); schedulePersist() }}
                color={subheadColor} onColor={(v) => { setSubheadColor(v); schedulePersist() }}
              />
              <div className="banner-text-shell min-w-[280px]" dir="rtl">
                <EditableText
                  className="banner-text banner-subhead min-w-[260px] whitespace-normal"
                  style={{ fontSize: subheadFs, textAlign: subheadAlign, color: subheadColor }}
                  text={subhead} resetKey={taskId}
                  onTextChange={(v) => { setSubhead(v); schedulePersist() }}
                />
              </div>
            </BannerLayer>

            {/* ── Feature-cards layer ─────────────────────────────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={bulletsBox} setBox={setBulletsBox}
              className={`${layerClass('bullets')} banner-layer--text`}
              layerKey="bullets" setDraggingKey={setDraggingKey}
              viewportScale={scale} minWidth={280} minHeight={200}
              onUserCommit={schedulePersist} designSize={designSize}
            >
              <TextControls
                fontSize={bulletsFs} onFontSize={(v) => { setBulletsFs(v); schedulePersist() }}
                align={bulletsAlign} onAlign={(v) => { setBulletsAlign(v); schedulePersist() }}
                color={bulletsColor} onColor={(v) => { setBulletsColor(v); schedulePersist() }}
              />
              <div
                className={`banner-feat-grid${isVertical ? ' banner-feat-grid--vertical' : ''}`}
                dir="rtl"
              >
                {bullets.map((b, i) => (
                  <div
                    key={`${taskId}-b-${i}`}
                    className="banner-feat-card"
                    style={{ borderTopColor: ctaBgHex }}
                  >
                    <div className="banner-feat-icon" style={{ backgroundColor: ctaBgHex, color: ctaFgHex }}>✓</div>
                    <EditableText
                      as="span"
                      className="banner-feat-text"
                      style={{ fontSize: bulletsFs, textAlign: bulletsAlign, color: bulletsColor }}
                      text={b} resetKey={`${taskId}-${i}`}
                      onTextChange={(t) => setBulletAt(i, t)}
                    />
                  </div>
                ))}
              </div>
            </BannerLayer>

            {/* ── CTA layer ───────────────────────────────────────── */}
            <BannerLayer
              canvasRef={captureRef}
              box={ctaBox} setBox={setCtaBox}
              className={`${layerClass('cta')} banner-layer--cta`}
              layerKey="cta" setDraggingKey={setDraggingKey}
              viewportScale={scale} minWidth={160} minHeight={52}
              dragHandleOnly dragControls={ctaDragControls}
              onUserCommit={schedulePersist} designSize={designSize}
            >
              <TextControls
                fontSize={ctaFs} onFontSize={(v) => { setCtaFs(v); schedulePersist() }}
                align={ctaAlign} onAlign={(v) => { setCtaAlign(v); schedulePersist() }}
                color={ctaColor} onColor={(v) => { setCtaColor(v); schedulePersist() }}
              />
              <div className="banner-text-shell min-w-[160px]">
                <div
                  className="banner-cta-drag-handle"
                  title="גרור להזזה"
                  onPointerDown={(e) => ctaDragControls.start(e)}
                >
                  <span className="banner-cta-drag-grip" aria-hidden />
                  <span className="banner-cta-drag-label">גרור</span>
                </div>
                <div className="mt-1" style={{ textAlign: ctaAlign }} dir="rtl">
                  <EditableText
                    className="banner-text banner-cta inline-block min-w-[120px] max-w-full whitespace-nowrap"
                    text={cta} resetKey={taskId}
                    onTextChange={(v) => { setCta(v); schedulePersist() }}
                    style={{
                      fontSize: ctaFs,
                      backgroundColor: ctaBgHex,
                      color: ctaColor,
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
        <button type="button" className="btn-download" onClick={handleDownload} disabled={exporting}>
          {exporting ? 'מכין PNG…' : '⬇ הורד באנר PNG'}
        </button>
        {typeof onRenderVideo === 'function' && (
          <button type="button" className="btn-download" onClick={onRenderVideo} disabled={isRenderingVideo}>
            {isRenderingVideo ? 'מייצר וידאו…' : '🎬 ייצר סרטון אנימציה'}
          </button>
        )}
      </div>
      {downloadError && (
        <p className="banner-download-error" role="alert">{downloadError}</p>
      )}
    </div>
  )
}
