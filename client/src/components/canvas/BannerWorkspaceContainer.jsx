import { useCallback, useEffect, useId, useRef, useState } from 'react'
import BannerLayer from './BannerLayer.jsx'
import EditableText from './EditableText.jsx'
import TextControls from './TextControls.jsx'
import {
  BANNER_SQUARE_1_1,
  BANNER_VERTICAL_9_16,
  captureBannerNodeToPng,
  contrastingTextColor,
  extractDomain,
  hexToRgb,
  normalizeBrandHex,
} from './canvasUtils.js'
import { ACTIONS, useBannerCanvasState } from './useBannerCanvasState.js'

/**
 * @typedef {object} BannerLayerUiConfig
 * @property {string} layerBase — e.g. 'banner-layer' | 'bc2-layer'
 * @property {string} [handleWrapperClass]
 * @property {string} [layerInnerClass]
 * @property {string} layerTextMod — e.g. 'banner-layer--text'
 * @property {string} layerCtaMod — e.g. 'banner-layer--cta'
 * @property {string} logoImgClassName
 * @property {number} [minHeadlineHeight]
 * @property {string} headlineTextShellClass
 * @property {string} headlineEditableClass
 * @property {string} subheadTextShellClass
 * @property {string} subheadEditableClass
 * @property {string} featGridBase
 * @property {string} featGridVertical
 * @property {string} featItemClass
 * @property {string} featIconClass
 * @property {string} featTextClass
 * @property {string} ctaTextShellClass
 * @property {string} ctaDragHandleClass
 * @property {string} ctaDragGripClass
 * @property {string} ctaDragLabelClass
 * @property {string} ctaEditableClass
 * @property {(ctx: { ctaBgHex: string, brandR: number, brandG: number, brandB: number }) => string} getCtaBoxShadow
 */

/**
 * Shared shell: viewport scaling, capture ref, useBannerCanvasState, draggable layers, download / video row.
 * Pass design-specific background via `renderCanvasBackground` and styling via `layerUi`.
 *
 * @param {object} props
 * @param {(workspace: BannerWorkspaceContext) => React.ReactNode} props.renderCanvasBackground
 * @param {BannerLayerUiConfig} props.layerUi
 */
export default function BannerWorkspaceContainer({
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
  /** Shown under the action row while async video render runs (non-blocking). */
  videoRenderingHint = '',
  aspectRatio = '1:1',
  persistDesignKey,
  stateDefaults,
  surfaceIdPrefix,
  rootClassName,
  viewportClassName,
  viewportInnerClassName,
  captureClassName,
  downloadRowClassName,
  downloadButtonClassName,
  downloadErrorClassName,
  capturePngOptions,
  downloadFilenameBase,
  renderCanvasBackground,
  layerUi,
}) {
  const isVertical = aspectRatio === '9:16'
  const designSize = isVertical ? BANNER_VERTICAL_9_16 : BANNER_SQUARE_1_1
  const BANNER_W = designSize.width
  const BANNER_H = designSize.height

  const viewportRef = useRef(null)
  const captureRef = useRef(null)
  const reactSurfaceSuffix = useId().replace(/:/g, '')
  const boundsSurfaceId = taskId
    ? `${surfaceIdPrefix}-${taskId}`
    : `${surfaceIdPrefix}-${reactSurfaceSuffix}`

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
    defaults: stateDefaults,
  })

  const {
    // Text
    headline,
    subhead,
    bullets,
    cta,
    // Boxes (stable setters — support functional-updater form)
    logoBox,          setLogoBox,
    contentStackBox,  setContentStackBox,
    // Style reads
    headlineFs,    headlineAlign,    headlineColor,
    subheadFs,     subheadAlign,     subheadColor,
    bulletsFs,     bulletsAlign,     bulletsColor,
    ctaFs,         ctaAlign,         ctaColor,
    // Dragging
    draggingKey,   setDraggingKey,
    // Actions
    dispatchAndPersist,
    schedulePersist,
    setBulletAt,
  } = canvasState

  const bgSrc = backgroundUrl ? `${apiBase}${backgroundUrl}` : ''
  const logoSrc = logoUrl ? `${apiBase}${logoUrl}` : ''
  const ctaBgHex = normalizeBrandHex(brandColor)
  const ctaFgHex = contrastingTextColor(ctaBgHex)
  const [brandR, brandG, brandB] = hexToRgb(ctaBgHex)
  const domain = extractDomain(siteUrl)

  const bgImageStyle = bgSrc !== '' ? { backgroundImage: `url(${JSON.stringify(bgSrc)})` } : undefined

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      if (w <= 0) return
      // Drive scale from the width axis only.  The viewport CSS enforces the correct
      // aspect-ratio, so BANNER_H * (w / BANNER_W) always equals the viewport height.
      // Reading clientHeight as well introduces a race when aspect-ratio + max-height
      // interact: clientHeight can be clamped while clientWidth is not, causing the
      // canvas visual height to exceed the outer viewport and clip the bottom strip.
      setScale(w / BANNER_W)
    }
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(update)
    })
    ro.observe(el)
    requestAnimationFrame(update)
    return () => ro.disconnect()
  }, [BANNER_W, BANNER_H])

  const handleDownload = useCallback(async () => {
    const node = captureRef.current
    if (!node) return
    setDownloadError(null)
    setExporting(true)
    try {
      const dataUrl = await captureBannerNodeToPng(node, {
        width: BANNER_W,
        height: BANNER_H,
        ...capturePngOptions,
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = downloadFilenameBase({ taskId, isVertical })
      a.click()
    } catch (e) {
      setDownloadError(e.message || String(e))
    } finally {
      setExporting(false)
    }
  }, [taskId, BANNER_W, BANNER_H, isVertical, capturePngOptions, downloadFilenameBase])

  const layerClass = (id) =>
    `${layerUi.layerBase} ${layerUi.layerBase}--${id}${
      draggingKey === id ? ` ${layerUi.layerBase}--dragging` : ''
    }`

  const workspace = {
    BANNER_W,
    BANNER_H,
    designSize,
    isVertical,
    scale,
    exporting,
    bgSrc,
    logoSrc,
    bgImageStyle,
    ctaBgHex,
    ctaFgHex,
    brandR,
    brandG,
    brandB,
    domain,
  }

  const handleProps = {}
  if (layerUi.handleWrapperClass != null) handleProps.handleWrapperClass = layerUi.handleWrapperClass
  if (layerUi.layerInnerClass != null) handleProps.layerInnerClass = layerUi.layerInnerClass

  return (
    <div className={`${rootClassName} w-full max-w-full`}>
      <div className={viewportClassName} ref={viewportRef} dir="ltr">
        <div
          className={viewportInnerClassName}
          style={{
            // CSS provides `position: absolute; inset: 0` so this inner div fills the
            // outer viewport exactly.  Do NOT set an explicit width/height or override
            // position here — that would break the inset-0 sizing and re-introduce the
            // height-mismatch clipping bug on 9:16 layouts.
            overflow: 'hidden',
          }}
        >
          <div
            ref={captureRef}
            id={boundsSurfaceId}
            dir="ltr"
            className={captureClassName(exporting)}
            style={{
              width: BANNER_W,
              height: BANNER_H,
              transform: `scale(${scale})`,
              overflow: 'hidden',
            }}
          >
            {renderCanvasBackground(workspace)}

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
              onUserCommit={schedulePersist}
              designSize={designSize}
              {...handleProps}
            >
              <img
                src={logoSrc}
                alt=""
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                loading="eager"
                decoding="async"
                draggable={false}
                className={layerUi.logoImgClassName}
              />
            </BannerLayer>

            {/*
             * ── Content stack — single draggable/resizable layer for all text ──────────
             * Headline, subhead, bullets, and CTA live in a flex-col so long content
             * never overlaps.  Each section owns its own TextControls (shown on
             * section-hover via CSS) so typography for each element is still editable.
             * Horizontal resize is allowed; vertical size is driven by content (autoHeight).
             */}
            <BannerLayer
              canvasRef={captureRef}
              box={contentStackBox}
              setBox={setContentStackBox}
              className={layerClass('stack')}
              layerKey="stack"
              setDraggingKey={setDraggingKey}
              viewportScale={scale}
              minWidth={200}
              autoHeight
              onUserCommit={schedulePersist}
              designSize={designSize}
              {...handleProps}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                  width: '100%',
                }}
              >
                {/* ── Headline ───────────────────────────────────────────────────── */}
                <div className="banner-content-section">
                  <TextControls
                    fontSize={headlineFs}
                    onFontSize={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_STYLE, field: 'headlineFs', value: v })}
                    align={headlineAlign}
                    onAlign={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_STYLE, field: 'headlineAlign', value: v })}
                    color={headlineColor}
                    onColor={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_STYLE, field: 'headlineColor', value: v })}
                    viewportScale={scale}
                  />
                  <div className={layerUi.headlineTextShellClass} dir="rtl" style={{ height: 'auto' }}>
                    <EditableText
                      className={layerUi.headlineEditableClass}
                      style={{ fontSize: headlineFs, textAlign: headlineAlign, color: headlineColor }}
                      text={headline}
                      resetKey={taskId}
                      onTextChange={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_TEXT, field: 'headline', value: v })}
                    />
                  </div>
                </div>

                {/* ── Subhead ────────────────────────────────────────────────────── */}
                <div className="banner-content-section">
                  <TextControls
                    fontSize={subheadFs}
                    onFontSize={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_STYLE, field: 'subheadFs', value: v })}
                    align={subheadAlign}
                    onAlign={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_STYLE, field: 'subheadAlign', value: v })}
                    color={subheadColor}
                    onColor={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_STYLE, field: 'subheadColor', value: v })}
                    viewportScale={scale}
                  />
                  <div className={layerUi.subheadTextShellClass} dir="rtl" style={{ height: 'auto' }}>
                    <EditableText
                      className={layerUi.subheadEditableClass}
                      style={{ fontSize: subheadFs, textAlign: subheadAlign, color: subheadColor }}
                      text={subhead}
                      resetKey={taskId}
                      onTextChange={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_TEXT, field: 'subhead', value: v })}
                    />
                  </div>
                </div>

                {/* ── Bullets / feature cards ────────────────────────────────────── */}
                <div className="banner-content-section">
                  <TextControls
                    fontSize={bulletsFs}
                    onFontSize={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_STYLE, field: 'bulletsFs', value: v })}
                    align={bulletsAlign}
                    onAlign={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_STYLE, field: 'bulletsAlign', value: v })}
                    color={bulletsColor}
                    onColor={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_STYLE, field: 'bulletsColor', value: v })}
                    viewportScale={scale}
                  />
                  <div
                    className={`${layerUi.featGridBase}${isVertical ? ` ${layerUi.featGridVertical}` : ''}`}
                    dir="rtl"
                    style={{ height: 'auto' }}
                  >
                    {bullets.map((b, i) => (
                      <div
                        key={`${taskId}-b-${i}`}
                        className={layerUi.featItemClass}
                        style={{ borderTopColor: ctaBgHex }}
                      >
                        <div
                          className={layerUi.featIconClass}
                          style={{ backgroundColor: ctaBgHex, color: ctaFgHex }}
                        >
                          ✓
                        </div>
                        <EditableText
                          as="span"
                          className={layerUi.featTextClass}
                          style={{ fontSize: bulletsFs, textAlign: bulletsAlign, color: bulletsColor }}
                          text={b}
                          resetKey={`${taskId}-${i}`}
                          onTextChange={(t) => setBulletAt(i, t)}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── CTA ───────────────────────────────────────────────────────── */}
                <div className="banner-content-section">
                  <TextControls
                    fontSize={ctaFs}
                    onFontSize={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_STYLE, field: 'ctaFs', value: v })}
                    align={ctaAlign}
                    onAlign={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_STYLE, field: 'ctaAlign', value: v })}
                    color={ctaColor}
                    onColor={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_STYLE, field: 'ctaColor', value: v })}
                    viewportScale={scale}
                  />
                  <div style={{ textAlign: ctaAlign }} dir="rtl">
                    <EditableText
                      className={layerUi.ctaEditableClass}
                      text={cta}
                      resetKey={taskId}
                      onTextChange={(v) => dispatchAndPersist({ type: ACTIONS.UPDATE_TEXT, field: 'cta', value: v })}
                      style={{
                        fontSize: ctaFs,
                        backgroundColor: ctaBgHex,
                        color: ctaColor,
                        boxShadow: layerUi.getCtaBoxShadow({ ctaBgHex, brandR, brandG, brandB }),
                      }}
                    />
                  </div>
                </div>
              </div>
            </BannerLayer>
          </div>
        </div>
      </div>

      <div className={downloadRowClassName}>
        <button type="button" className={downloadButtonClassName} onClick={handleDownload} disabled={exporting}>
          {exporting ? 'מכין PNG…' : '⬇ הורד באנר PNG'}
        </button>
        {typeof onRenderVideo === 'function' && (
          <button
            type="button"
            className={downloadButtonClassName}
            onClick={onRenderVideo}
            disabled={isRenderingVideo}
          >
            {isRenderingVideo ? 'מייצר וידאו ברקע…' : '🎬 ייצר סרטון אנימציה'}
          </button>
        )}
      </div>
      {isRenderingVideo && videoRenderingHint ? (
        <p
          className="mt-2 text-center text-sm text-slate-600 dark:text-slate-400 px-2"
          role="status"
          aria-live="polite"
        >
          {videoRenderingHint}
        </p>
      ) : null}
      {downloadError && (
        <p className={downloadErrorClassName} role="alert">
          {downloadError}
        </p>
      )}
    </div>
  )
}
