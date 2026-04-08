/**
 * BannerCanvas2 — "Immersive Full-Canvas" design (Design 2).
 * Supports both 1:1 (square feed) and 9:16 (vertical/shorts) via the aspectRatio prop.
 */

import { useCallback, useMemo } from 'react'
import './BannerCanvas2.css'
import BannerWorkspaceContainer from './components/canvas/BannerWorkspaceContainer.jsx'
import { DESIGN2_DEFAULT_BOXES_VERTICAL } from './components/canvas/useBannerCanvasState.js'

const DF2 = { headline: 66, subhead: 26, bullets: 18, cta: 31 }
const DC2 = { headline: '#ffffff', subhead: '#e6e6e6', bullets: '#ebebeb' }

const STRIP_H = 64
const ACCENT_W = 6
const CONTENT_PAD = 64
const CONTENT_W = 1080 - CONTENT_PAD * 2

const DESIGN2_SQUARE_BOXES = {
  logo: { x: 1080 - CONTENT_PAD - 210, y: 50, width: 210, height: 78 },
  headline: { x: CONTENT_PAD, y: 210, width: CONTENT_W, height: 230 },
  subhead: { x: CONTENT_PAD, y: 456, width: CONTENT_W, height: 110 },
  bullets: { x: CONTENT_PAD, y: 580, width: CONTENT_W, height: 252 },
  cta: { x: CONTENT_PAD + 80, y: 846, width: CONTENT_W - 160, height: 88 },
}

const DESIGN2_LAYER_UI = {
  layerBase: 'bc2-layer',
  layerTextMod: 'bc2-layer--text',
  layerCtaMod: 'bc2-layer--cta',
  handleWrapperClass: 'bc2-resize-handle-root',
  layerInnerClass: 'bc2-layer-inner',
  minHeadlineHeight: 60,
  logoImgClassName: 'bc2-logo-img mx-auto block max-h-full max-w-full object-contain',
  headlineTextShellClass: 'bc2-text-shell',
  headlineEditableClass: 'bc2-text bc2-headline whitespace-normal',
  subheadTextShellClass: 'bc2-text-shell',
  subheadEditableClass: 'bc2-text bc2-subhead whitespace-normal',
  featGridBase: 'bc2-feat-grid',
  featGridVertical: 'bc2-feat-grid--vertical',
  featItemClass: 'bc2-feat-pill',
  featIconClass: 'bc2-feat-icon',
  featTextClass: 'bc2-feat-text',
  ctaTextShellClass: 'bc2-text-shell',
  ctaDragHandleClass: 'bc2-cta-drag-handle',
  ctaDragGripClass: 'bc2-cta-drag-grip',
  ctaDragLabelClass: 'bc2-cta-drag-label',
  ctaEditableClass: 'bc2-text bc2-cta inline-block min-w-[120px] max-w-full whitespace-nowrap',
  getCtaBoxShadow: ({ brandR, brandG, brandB }) =>
    `0 12px 40px rgba(${brandR},${brandG},${brandB},0.55)`,
}

const OVERLAY = [
  'radial-gradient(ellipse at 70% 40%, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.72) 90%)',
  'linear-gradient(165deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.55) 100%)',
].join(', ')

/** Full-bleed background, vignette, brand glow, left accent, domain strip. */
function renderDesign2CanvasBackground(ws) {
  const { BANNER_W, BANNER_H, bgSrc, bgImageStyle, ctaBgHex, ctaFgHex, brandR, brandG, brandB, domain } =
    ws

  return (
    <>
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

      <div className="absolute inset-0 pointer-events-none" style={{ background: OVERLAY }} aria-hidden />

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

      <div
        className="absolute top-0 left-0 pointer-events-none"
        style={{ width: ACCENT_W, height: BANNER_H - STRIP_H, backgroundColor: ctaBgHex }}
        aria-hidden
      />

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
    </>
  )
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
  const defaultBoxes = isVertical ? DESIGN2_DEFAULT_BOXES_VERTICAL : DESIGN2_SQUARE_BOXES
  const persistDesignKey = isVertical ? 'design2_vertical' : 'design2'

  const capturePngOptions = useMemo(
    () => ({
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
    }),
    [],
  )

  const downloadFilenameBase = useCallback(
    ({ taskId: tid, isVertical: vert }) =>
      `banner2-d2${vert ? '-vertical' : ''}-${(tid || 'export').slice(0, 8)}.png`,
    [],
  )

  const stateDefaults = useMemo(
    () => ({
      fontSizes: DF2,
      textColors: DC2,
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
      aspectRatio={aspectRatio}
      persistDesignKey={persistDesignKey}
      stateDefaults={stateDefaults}
      surfaceIdPrefix="bc2-surface"
      rootClassName="bc2-root"
      viewportClassName="bc2-viewport"
      viewportInnerClassName="bc2-viewport-inner"
      captureClassName={(exporting) =>
        `absolute left-0 top-0 shrink-0 origin-top-left overflow-hidden bc2-canvas${exporting ? ' bc2-capture' : ''}`
      }
      downloadRowClassName="bc2-download-row"
      downloadButtonClassName="bc2-btn-download"
      downloadErrorClassName="bc2-download-error"
      capturePngOptions={capturePngOptions}
      downloadFilenameBase={downloadFilenameBase}
      layerUi={DESIGN2_LAYER_UI}
      renderCanvasBackground={renderDesign2CanvasBackground}
    />
  )
}
