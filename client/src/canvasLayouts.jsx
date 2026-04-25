/**
 * Layout registry for banner designs 1–3: boxes, typography, layer UI classes,
 * PNG capture options, and background renderers for BannerWorkspaceContainer.
 */

import {
  computeDesign1VerticalMetrics,
  DESIGN1_DEFAULT_BOXES_VERTICAL,
  DESIGN2_DEFAULT_BOXES_VERTICAL,
  DESIGN3_DEFAULT_BOXES_VERTICAL,
} from './components/canvas/useBannerCanvasState.js'

// ─── Design 1 — split panel / hero vertical ─────────────────────────────────
const DC1 = { headline: '#0f172a', subhead: '#475569', bullets: '#1e293b' }
const LEFT_W = 475
const DIVIDER_W = 6
const RIGHT_X = LEFT_W + DIVIDER_W
const STRIP_H_D1 = 70
const DF1_SQUARE = { headline: 54, subhead: 26, bullets: 20, cta: 30 }
const DF1_VERTICAL = { headline: 92, subhead: 42, bullets: 34, cta: 48 }
const DESIGN1_SQUARE_BOXES = {
  logo: { x: 836, y: 30, width: 200, height: 72 },
  contentStack: { x: 515, y: 120, width: 520, height: 840 },
}

const DESIGN1_LAYER_UI = {
  layerBase: 'banner-layer',
  layerTextMod: 'banner-layer--text',
  layerCtaMod: 'banner-layer--cta',
  logoImgClassName: 'banner-layer-logo-img mx-auto block max-h-full max-w-full object-contain',
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
  const CONTENT_H = BANNER_H - STRIP_H_D1
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
        style={{ height: STRIP_H_D1, backgroundColor: ctaBgHex }}
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

// ─── Design 2 — immersive full-bleed ─────────────────────────────────────────
const DF2_SQUARE = { headline: 92, subhead: 36, bullets: 28, cta: 44 }
const DF2_VERTICAL = { headline: 118, subhead: 48, bullets: 34, cta: 52 }
const DC2 = { headline: '#ffffff', subhead: '#e6e6e6', bullets: '#ebebeb' }
const STRIP_H_D2 = 64
const ACCENT_W = 6
const CONTENT_PAD = 64
const CONTENT_W = 1080 - CONTENT_PAD * 2
const DESIGN2_SQUARE_BOXES = {
  logo: { x: 1080 - CONTENT_PAD - 210, y: 50, width: 210, height: 78 },
  contentStack: { x: CONTENT_PAD, y: 198, width: CONTENT_W, height: 840 },
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

const OVERLAY_D2 = [
  'radial-gradient(ellipse at 70% 40%, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.72) 90%)',
  'linear-gradient(165deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.55) 100%)',
].join(', ')

function renderDesign2CanvasBackground(ws) {
  const { BANNER_H, bgSrc, bgImageStyle, ctaBgHex, ctaFgHex, brandR, brandG, brandB, domain } = ws

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

      <div className="absolute inset-0 pointer-events-none" style={{ background: OVERLAY_D2 }} aria-hidden />

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
        style={{ width: ACCENT_W, height: BANNER_H - STRIP_H_D2, backgroundColor: ctaBgHex }}
        aria-hidden
      />

      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-none flex items-center justify-center"
        style={{ height: STRIP_H_D2, backgroundColor: ctaBgHex }}
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

// ─── Design 3 — minimalist card ───────────────────────────────────────────────
const DF3_SQUARE = { headline: 62, subhead: 24, bullets: 18, cta: 28 }
const DF3_VERTICAL = { headline: 88, subhead: 38, bullets: 28, cta: 44 }
const DC3 = { headline: '#0f172a', subhead: '#475569', bullets: '#1e293b' }
const DESIGN3_SQUARE_BOXES = {
  logo: { x: 660, y: 168, width: 220, height: 72 },
  contentStack: { x: 196, y: 260, width: 688, height: 720 },
}
const CARD_MARGIN_SQ = 140
const CARD_MARGIN_V_X = 80
const CARD_MARGIN_V_Y = 180
const CARD_RADIUS_SQ = 28
const CARD_RADIUS_V = 36

const DESIGN3_LAYER_UI = {
  layerBase: 'bc3-layer',
  layerTextMod: 'bc3-layer--text',
  layerCtaMod: 'bc3-layer--cta',
  handleWrapperClass: 'bc3-resize-handle-root',
  layerInnerClass: 'bc3-layer-inner',
  minHeadlineHeight: 60,
  logoImgClassName: 'bc3-logo-img mx-auto block max-h-full max-w-full object-contain',
  headlineTextShellClass: 'bc3-text-shell',
  headlineEditableClass: 'bc3-text bc3-headline whitespace-normal',
  subheadTextShellClass: 'bc3-text-shell',
  subheadEditableClass: 'bc3-text bc3-subhead whitespace-normal',
  featGridBase: 'bc3-feat-grid',
  featGridVertical: 'bc3-feat-grid--vertical',
  featItemClass: 'bc3-feat-pill',
  featIconClass: 'bc3-feat-icon',
  featTextClass: 'bc3-feat-text',
  ctaTextShellClass: 'bc3-text-shell',
  ctaDragHandleClass: 'bc3-cta-drag-handle',
  ctaDragGripClass: 'bc3-cta-drag-grip',
  ctaDragLabelClass: 'bc3-cta-drag-label',
  ctaEditableClass: 'bc3-text bc3-cta inline-block min-w-[120px] max-w-full whitespace-nowrap',
  getCtaBoxShadow: ({ ctaBgHex }) => `0 10px 36px ${ctaBgHex}66`,
}

function renderDesign3CanvasBackground(ws) {
  const { BANNER_W, BANNER_H, ctaBgHex, isVertical } = ws
  const mX = isVertical ? CARD_MARGIN_V_X : CARD_MARGIN_SQ
  const mY = isVertical ? CARD_MARGIN_V_Y : CARD_MARGIN_SQ
  const radius = isVertical ? CARD_RADIUS_V : CARD_RADIUS_SQ

  return (
    <>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundColor: ctaBgHex }}
        aria-hidden
      />
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
      <div
        className="absolute pointer-events-none"
        style={{
          left: mX,
          top: mY,
          width: BANNER_W - mX * 2,
          height: BANNER_H - mY * 2,
          borderRadius: radius,
          backgroundColor: '#ffffff',
          boxShadow: '0 32px 80px rgba(0,0,0,0.22), 0 8px 24px rgba(0,0,0,0.14)',
        }}
        aria-hidden
      />
    </>
  )
}

/** @param {string} handleRootClass e.g. bc2-resize-handle-root */
export function buildCapturePngFilter(handleRootClass) {
  return (el) => {
    if (el.classList?.contains('banner-resize-handle-root')) return false
    if (el.closest?.('.banner-resize-handle-root')) return false
    if (handleRootClass) {
      if (el.classList?.contains(handleRootClass)) return false
      if (el.closest?.(`.${handleRootClass}`)) return false
    }
    if (el.classList?.contains('banner-text-controls')) return false
    if (el.closest?.('.banner-text-controls')) return false
    return true
  }
}

/**
 * @typedef {object} CanvasLayoutDefinition
 * @property {string} persistKeySquare
 * @property {string} persistKeyVertical
 * @property {object} defaultBoxesSquare
 * @property {object} defaultBoxesVertical
 * @property {object} fontSizesSquare
 * @property {object} fontSizesVertical
 * @property {object} textColors
 * @property {object} layerUi
 * @property {(ws: object) => React.ReactNode} renderCanvasBackground
 * @property {string} captureBackgroundColor
 * @property {Record<string, unknown>} [captureStyleExtra]
 * @property {string} downloadPrefix
 * @property {string} surfaceIdPrefix
 * @property {string} rootClassName
 * @property {string} viewportBaseClass
 * @property {string} viewportVerticalModClass
 * @property {string} viewportInnerClassName
 * @property {(exporting: boolean) => string} captureClassName
 * @property {string} downloadRowClassName
 * @property {string} downloadButtonClassName
 * @property {string} downloadErrorClassName
 * @property {string} [resizeHandleRootClass] — extra class for html-to-image filter (design 2/3)
 */

/** @type {Record<1 | 2 | 3, CanvasLayoutDefinition>} */
export const CANVAS_LAYOUTS = {
  1: {
    persistKeySquare: 'design1',
    persistKeyVertical: 'design1_vertical',
    defaultBoxesSquare: DESIGN1_SQUARE_BOXES,
    defaultBoxesVertical: DESIGN1_DEFAULT_BOXES_VERTICAL,
    fontSizesSquare: DF1_SQUARE,
    fontSizesVertical: DF1_VERTICAL,
    textColors: DC1,
    layerUi: DESIGN1_LAYER_UI,
    renderCanvasBackground: renderDesign1CanvasBackground,
    captureBackgroundColor: '#ffffff',
    captureStyleExtra: { backgroundColor: '#ffffff', colorScheme: 'light' },
    downloadPrefix: 'banner-d1',
    surfaceIdPrefix: 'banner-surface',
    rootClassName: 'banner-canvas-root',
    viewportBaseClass: 'banner-viewport',
    viewportVerticalModClass: 'banner-viewport--9-16',
    viewportInnerClassName: 'banner-viewport-inner',
    captureClassName: (exporting) =>
      `absolute left-0 top-0 shrink-0 origin-top-left overflow-hidden banner-canvas${exporting ? ' capture-mode' : ''}`,
    downloadRowClassName: 'banner-download-row',
    downloadButtonClassName: 'btn-download',
    downloadErrorClassName: 'banner-download-error',
    resizeHandleRootClass: '',
  },
  2: {
    persistKeySquare: 'design2',
    persistKeyVertical: 'design2_vertical',
    defaultBoxesSquare: DESIGN2_SQUARE_BOXES,
    defaultBoxesVertical: DESIGN2_DEFAULT_BOXES_VERTICAL,
    fontSizesSquare: DF2_SQUARE,
    fontSizesVertical: DF2_VERTICAL,
    textColors: DC2,
    layerUi: DESIGN2_LAYER_UI,
    renderCanvasBackground: renderDesign2CanvasBackground,
    captureBackgroundColor: '#0f172a',
    captureStyleExtra: { colorScheme: 'light' },
    downloadPrefix: 'banner2-d2',
    surfaceIdPrefix: 'bc2-surface',
    rootClassName: 'bc2-root',
    viewportBaseClass: 'bc2-viewport',
    viewportVerticalModClass: 'bc2-viewport--9-16',
    viewportInnerClassName: 'bc2-viewport-inner',
    captureClassName: (exporting) =>
      `absolute left-0 top-0 shrink-0 origin-top-left overflow-hidden bc2-canvas${exporting ? ' bc2-capture' : ''}`,
    downloadRowClassName: 'bc2-download-row',
    downloadButtonClassName: 'bc2-btn-download',
    downloadErrorClassName: 'bc2-download-error',
    resizeHandleRootClass: 'bc2-resize-handle-root',
  },
  3: {
    persistKeySquare: 'design3',
    persistKeyVertical: 'design3_vertical',
    defaultBoxesSquare: DESIGN3_SQUARE_BOXES,
    defaultBoxesVertical: DESIGN3_DEFAULT_BOXES_VERTICAL,
    fontSizesSquare: DF3_SQUARE,
    fontSizesVertical: DF3_VERTICAL,
    textColors: DC3,
    layerUi: DESIGN3_LAYER_UI,
    renderCanvasBackground: renderDesign3CanvasBackground,
    captureBackgroundColor: '#ffffff',
    captureStyleExtra: { colorScheme: 'light' },
    downloadPrefix: 'banner3-d3',
    surfaceIdPrefix: 'bc3-surface',
    rootClassName: 'bc3-root',
    viewportBaseClass: 'bc3-viewport',
    viewportVerticalModClass: 'bc3-viewport--9-16',
    viewportInnerClassName: 'bc3-viewport-inner',
    captureClassName: (exporting) =>
      `absolute left-0 top-0 shrink-0 origin-top-left overflow-hidden bc3-canvas${exporting ? ' bc3-capture' : ''}`,
    downloadRowClassName: 'bc3-download-row',
    downloadButtonClassName: 'bc3-btn-download',
    downloadErrorClassName: 'bc3-download-error',
    resizeHandleRootClass: 'bc3-resize-handle-root',
  },
}

export function resolveCanvasLayout(designType) {
  const n = Number(designType)
  if (n === 2) return CANVAS_LAYOUTS[2]
  if (n === 3) return CANVAS_LAYOUTS[3]
  return CANVAS_LAYOUTS[1]
}
