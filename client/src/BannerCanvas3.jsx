/**
 * BannerCanvas3 — "Minimalist Card" design (Design 3).
 * Solid brand-colour background with all content inside a white floating card.
 * Supports both 1:1 (square feed) and 9:16 (vertical/shorts) via aspectRatio prop.
 */

import { useCallback, useMemo } from 'react'
import './BannerCanvas3.css'
import BannerWorkspaceContainer from './components/canvas/BannerWorkspaceContainer.jsx'
import { DESIGN3_DEFAULT_BOXES_VERTICAL } from './components/canvas/useBannerCanvasState.js'

// ─── Font sizes ───────────────────────────────────────────────────────────────
const DF3_SQUARE   = { headline: 62, subhead: 24, bullets: 18, cta: 28 }
const DF3_VERTICAL = { headline: 88, subhead: 38, bullets: 28, cta: 44 }

// ─── Default text colours (dark on white card) ────────────────────────────────
const DC3 = { headline: '#0f172a', subhead: '#475569', bullets: '#1e293b' }

// ─── Default layer boxes for 1:1 (1080×1080) ─────────────────────────────────
// Card sits at x=140 y=140 w=800 h=800 (140px brand-colour margin each side).
// Inner padding 56px → content starts at x=196.
const DESIGN3_SQUARE_BOXES = {
  logo:         { x: 660, y: 168, width: 220, height: 72  },
  // Flex content stack: headline top (y=260) through cta bottom (y≈932).
  // height is used only for drag y-clamping; visual height is auto.
  contentStack: { x: 196, y: 260, width: 688, height: 720 },
}

// ─── Layer UI config ──────────────────────────────────────────────────────────
const DESIGN3_LAYER_UI = {
  layerBase:            'bc3-layer',
  layerTextMod:         'bc3-layer--text',
  layerCtaMod:          'bc3-layer--cta',
  handleWrapperClass:   'bc3-resize-handle-root',
  layerInnerClass:      'bc3-layer-inner',
  minHeadlineHeight:    60,
  logoImgClassName:     'bc3-logo-img mx-auto block max-h-full max-w-full object-contain',
  headlineTextShellClass: 'bc3-text-shell',
  headlineEditableClass:  'bc3-text bc3-headline whitespace-normal',
  subheadTextShellClass:  'bc3-text-shell',
  subheadEditableClass:   'bc3-text bc3-subhead whitespace-normal',
  featGridBase:         'bc3-feat-grid',
  featGridVertical:     'bc3-feat-grid--vertical',
  featItemClass:        'bc3-feat-pill',
  featIconClass:        'bc3-feat-icon',
  featTextClass:        'bc3-feat-text',
  ctaTextShellClass:    'bc3-text-shell',
  ctaDragHandleClass:   'bc3-cta-drag-handle',
  ctaDragGripClass:     'bc3-cta-drag-grip',
  ctaDragLabelClass:    'bc3-cta-drag-label',
  ctaEditableClass:     'bc3-text bc3-cta inline-block min-w-[120px] max-w-full whitespace-nowrap',
  getCtaBoxShadow: ({ ctaBgHex }) => `0 10px 36px ${ctaBgHex}66`,
}

// ─── Card geometry constants ──────────────────────────────────────────────────
const CARD_MARGIN_SQ = 140  // brand-colour margin each side (1:1)
const CARD_MARGIN_V_X = 80  // horizontal margin (9:16)
const CARD_MARGIN_V_Y = 180 // vertical margin (9:16)
const CARD_RADIUS_SQ = 28
const CARD_RADIUS_V  = 36

/** Solid brand background + centred white floating card. No background image used. */
function renderDesign3CanvasBackground(ws) {
  const { BANNER_W, BANNER_H, ctaBgHex, isVertical } = ws

  const mX     = isVertical ? CARD_MARGIN_V_X : CARD_MARGIN_SQ
  const mY     = isVertical ? CARD_MARGIN_V_Y : CARD_MARGIN_SQ
  const radius = isVertical ? CARD_RADIUS_V   : CARD_RADIUS_SQ

  return (
    <>
      {/* Solid brand-colour background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundColor: ctaBgHex }}
        aria-hidden
      />

      {/* Subtle radial gradient for depth — avoids a flat, painted look */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: [
            'radial-gradient(ellipse 70% 60% at 18% 18%, rgba(255,255,255,0.18) 0%, transparent 55%)',
            'radial-gradient(ellipse 60% 50% at 82% 82%, rgba(0,0,0,0.14) 0%, transparent 52%)',
          ].join(', '),
        }}
        aria-hidden
      />

      {/* White floating card */}
      <div
        className="absolute pointer-events-none"
        style={{
          left:         mX,
          top:          mY,
          width:        BANNER_W - mX * 2,
          height:       BANNER_H - mY * 2,
          borderRadius: radius,
          backgroundColor: '#ffffff',
          boxShadow:    '0 32px 80px rgba(0,0,0,0.22), 0 8px 24px rgba(0,0,0,0.14)',
        }}
        aria-hidden
      />
    </>
  )
}

export default function BannerCanvas3({
  apiBase,
  taskId,
  backgroundUrl,
  logoUrl,
  headline: headlineInitial,
  subhead:  subheadInitial,
  bulletPoints,
  cta: ctaInitial,
  brandColor,
  siteUrl,
  savedCanvasSlice,
  onPersist,
  onRenderVideo,
  isRenderingVideo    = false,
  videoRenderingHint  = 'הווידאו מיוצר ברקע — אפשר להמשיך לערוך את הבאנר.',
  aspectRatio         = '1:1',
}) {
  const isVertical      = aspectRatio === '9:16'
  const defaultBoxes    = isVertical ? DESIGN3_DEFAULT_BOXES_VERTICAL : DESIGN3_SQUARE_BOXES
  const persistDesignKey = isVertical ? 'design3_vertical' : 'design3'

  const capturePngOptions = useMemo(
    () => ({
      backgroundColor: '#ffffff',
      style: { transform: 'scale(1)', colorScheme: 'light' },
      filter: (el) => {
        if (el.classList?.contains('bc3-resize-handle-root')) return false
        if (el.closest?.('.bc3-resize-handle-root')) return false
        if (el.classList?.contains('banner-text-controls')) return false
        if (el.closest?.('.banner-text-controls')) return false
        return true
      },
    }),
    [],
  )

  const downloadFilenameBase = useCallback(
    ({ taskId: tid, isVertical: vert }) =>
      `banner3-d3${vert ? '-vertical' : ''}-${(tid || 'export').slice(0, 8)}.png`,
    [],
  )

  const stateDefaults = useMemo(
    () => ({
      fontSizes:  isVertical ? DF3_VERTICAL : DF3_SQUARE,
      textColors: DC3,
      boxes:      defaultBoxes,
    }),
    [defaultBoxes, isVertical],
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
      surfaceIdPrefix="bc3-surface"
      rootClassName="bc3-root"
      viewportClassName={`bc3-viewport${isVertical ? ' bc3-viewport--9-16' : ''}`}
      viewportInnerClassName="bc3-viewport-inner"
      captureClassName={(exporting) =>
        `absolute left-0 top-0 shrink-0 origin-top-left overflow-hidden bc3-canvas${exporting ? ' bc3-capture' : ''}`
      }
      downloadRowClassName="bc3-download-row"
      downloadButtonClassName="bc3-btn-download"
      downloadErrorClassName="bc3-download-error"
      capturePngOptions={capturePngOptions}
      downloadFilenameBase={downloadFilenameBase}
      layerUi={DESIGN3_LAYER_UI}
      renderCanvasBackground={renderDesign3CanvasBackground}
    />
  )
}
