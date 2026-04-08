import { useCallback, useMemo } from 'react'
import './BannerCanvas.css'
import BannerWorkspaceContainer from './components/canvas/BannerWorkspaceContainer.jsx'
import {
  computeDesign1VerticalMetrics,
  DESIGN1_DEFAULT_BOXES_VERTICAL,
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
const CONTENT_W = 1080 - CONTENT_X - RPAD
const LOGO_W = 200

const DESIGN1_SQUARE_BOXES = {
  logo: { x: 1080 - RPAD - LOGO_W, y: 44, width: LOGO_W, height: 72 },
  headline: { x: CONTENT_X, y: 148, width: CONTENT_W, height: 210 },
  subhead: { x: CONTENT_X, y: 372, width: CONTENT_W, height: 110 },
  bullets: { x: CONTENT_X, y: 494, width: CONTENT_W, height: 292 },
  cta: { x: CONTENT_X, y: 802, width: CONTENT_W, height: 86 },
}

const DESIGN1_LAYER_UI = {
  layerBase: 'banner-layer',
  layerTextMod: 'banner-layer--text',
  layerCtaMod: 'banner-layer--cta',
  logoImgClassName:
    'banner-layer-logo-img mx-auto block max-h-full max-w-full object-contain',
  headlineTextShellClass: 'banner-text-shell min-w-[280px]',
  headlineEditableClass: 'banner-text banner-headline min-w-[260px] whitespace-normal',
  subheadTextShellClass: 'banner-text-shell min-w-[280px]',
  subheadEditableClass: 'banner-text banner-subhead min-w-[260px] whitespace-normal',
  featGridBase: 'banner-feat-grid',
  featGridVertical: 'banner-feat-grid--vertical',
  featItemClass: 'banner-feat-card',
  featIconClass: 'banner-feat-icon',
  featTextClass: 'banner-feat-text',
  ctaTextShellClass: 'banner-text-shell min-w-[160px]',
  ctaDragHandleClass: 'banner-cta-drag-handle',
  ctaDragGripClass: 'banner-cta-drag-grip',
  ctaDragLabelClass: 'banner-cta-drag-label',
  ctaEditableClass: 'banner-text banner-cta inline-block min-w-[120px] max-w-full whitespace-nowrap',
  getCtaBoxShadow: ({ ctaBgHex }) => `0 10px 36px ${ctaBgHex}66`,
}

/** Design 1 — split photo / content panel (1:1) or hero + text stack (9:16). */
function renderDesign1CanvasBackground(ws) {
  const {
    BANNER_W,
    BANNER_H,
    isVertical,
    bgSrc,
    bgImageStyle,
    ctaBgHex,
    ctaFgHex,
    brandR,
    brandG,
    brandB,
    domain,
  } = ws
  const CONTENT_H = BANNER_H - STRIP_H
  const verticalMetrics = isVertical ? computeDesign1VerticalMetrics(BANNER_H) : null
  const leftOverlay = `linear-gradient(145deg, rgba(10,18,36,0.92) 0%, rgba(${brandR},${brandG},${brandB},0.58) 48%, rgba(10,18,36,0.82) 100%)`
  const rightPanelBg = `linear-gradient(155deg, #ffffff 0%, #f8fafc 55%, rgba(${brandR},${brandG},${brandB},0.07) 100%)`

  const heroBg = (
    <>
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
    </>
  )

  return (
    <>
      {isVertical && verticalMetrics ? (
        <>
          <div
            className="absolute left-0 top-0 pointer-events-none overflow-hidden"
            style={{ width: BANNER_W, height: verticalMetrics.imageZoneH }}
            aria-hidden
          >
            {heroBg}
          </div>
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
          <div
            className="absolute left-0 top-0 pointer-events-none overflow-hidden"
            style={{ width: LEFT_W, height: CONTENT_H }}
            aria-hidden
          >
            {heroBg}
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
    </>
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
  brandColor,
  siteUrl,
  savedCanvasSlice,
  onPersist,
  onRenderVideo,
  isRenderingVideo = false,
  videoRenderingHint = 'הווידאו מיוצר ברקע — אפשר להמשיך לערוך את הבאנר.',
  aspectRatio = '1:1',
}) {
  const isVertical = aspectRatio === '9:16'
  const defaultBoxes = isVertical ? DESIGN1_DEFAULT_BOXES_VERTICAL : DESIGN1_SQUARE_BOXES
  const persistDesignKey = isVertical ? 'design1_vertical' : 'design1'

  const capturePngOptions = useMemo(
    () => ({
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
    }),
    [],
  )

  const downloadFilenameBase = useCallback(
    ({ taskId: tid, isVertical: vert }) =>
      `banner-d1${vert ? '-vertical' : ''}-${(tid || 'export').slice(0, 8)}.png`,
    [],
  )

  const stateDefaults = useMemo(
    () => ({
      fontSizes: DF,
      textColors: DC,
      boxes: defaultBoxes,
    }),
    [defaultBoxes],
  )

  return (
    <BannerWorkspaceContainer
      apiBase={apiBase}
      taskId={taskId}
      backgroundUrl={backgroundUrl}
      logoUrl={logoUrl}
      headline={headlineInitial}
      subhead={subheadInitial}
      bulletPoints={bulletPoints}
      cta={ctaInitial}
      brandColor={brandColor}
      siteUrl={siteUrl}
      savedCanvasSlice={savedCanvasSlice}
      onPersist={onPersist}
      onRenderVideo={onRenderVideo}
      isRenderingVideo={isRenderingVideo}
      videoRenderingHint={videoRenderingHint}
      aspectRatio={aspectRatio}
      persistDesignKey={persistDesignKey}
      stateDefaults={stateDefaults}
      surfaceIdPrefix="banner-surface"
      rootClassName="banner-canvas-root"
      viewportClassName="banner-viewport"
      viewportInnerClassName="banner-viewport-inner"
      captureClassName={(exporting) =>
        `absolute left-0 top-0 shrink-0 origin-top-left overflow-hidden banner-canvas${exporting ? ' capture-mode' : ''}`
      }
      downloadRowClassName="banner-download-row"
      downloadButtonClassName="btn-download"
      downloadErrorClassName="banner-download-error"
      capturePngOptions={capturePngOptions}
      downloadFilenameBase={downloadFilenameBase}
      layerUi={DESIGN1_LAYER_UI}
      renderCanvasBackground={renderDesign1CanvasBackground}
    />
  )
}
