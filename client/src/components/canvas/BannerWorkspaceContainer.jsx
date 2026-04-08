import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useDragControls } from 'framer-motion'
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
import { useBannerCanvasState } from './useBannerCanvasState.js'

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
    defaults: stateDefaults,
  })

  const {
    headline,
    setHeadline,
    subhead,
    setSubhead,
    bullets,
    cta,
    setCta,
    logoBox,
    setLogoBox,
    headlineBox,
    setHeadlineBox,
    subheadBox,
    setSubheadBox,
    bulletsBox,
    setBulletsBox,
    ctaBox,
    setCtaBox,
    draggingKey,
    setDraggingKey,
    headlineFs,
    setHeadlineFs,
    headlineAlign,
    setHeadlineAlign,
    headlineColor,
    setHeadlineColor,
    subheadFs,
    setSubheadFs,
    subheadAlign,
    setSubheadAlign,
    subheadColor,
    setSubheadColor,
    bulletsFs,
    setBulletsFs,
    bulletsAlign,
    setBulletsAlign,
    bulletsColor,
    setBulletsColor,
    ctaFs,
    setCtaFs,
    ctaAlign,
    setCtaAlign,
    ctaColor,
    setCtaColor,
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

  const minHeadlineH = layerUi.minHeadlineHeight ?? 56

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
          style={{ width: BANNER_W * scale, height: BANNER_H * scale }}
        >
          <div
            ref={captureRef}
            id={boundsSurfaceId}
            dir="ltr"
            className={captureClassName(exporting)}
            style={{ width: BANNER_W, height: BANNER_H, transform: `scale(${scale})` }}
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

            <BannerLayer
              canvasRef={captureRef}
              box={headlineBox}
              setBox={setHeadlineBox}
              className={`${layerClass('headline')} ${layerUi.layerTextMod}`}
              layerKey="headline"
              setDraggingKey={setDraggingKey}
              viewportScale={scale}
              minWidth={280}
              minHeight={minHeadlineH}
              onUserCommit={schedulePersist}
              designSize={designSize}
              {...handleProps}
            >
              <TextControls
                fontSize={headlineFs}
                onFontSize={(v) => {
                  setHeadlineFs(v)
                  schedulePersist()
                }}
                align={headlineAlign}
                onAlign={(v) => {
                  setHeadlineAlign(v)
                  schedulePersist()
                }}
                color={headlineColor}
                onColor={(v) => {
                  setHeadlineColor(v)
                  schedulePersist()
                }}
              />
              <div className={layerUi.headlineTextShellClass} dir="rtl">
                <EditableText
                  className={layerUi.headlineEditableClass}
                  style={{ fontSize: headlineFs, textAlign: headlineAlign, color: headlineColor }}
                  text={headline}
                  resetKey={taskId}
                  onTextChange={(v) => {
                    setHeadline(v)
                    schedulePersist()
                  }}
                />
              </div>
            </BannerLayer>

            <BannerLayer
              canvasRef={captureRef}
              box={subheadBox}
              setBox={setSubheadBox}
              className={`${layerClass('subhead')} ${layerUi.layerTextMod}`}
              layerKey="subhead"
              setDraggingKey={setDraggingKey}
              viewportScale={scale}
              minWidth={280}
              minHeight={48}
              onUserCommit={schedulePersist}
              designSize={designSize}
              {...handleProps}
            >
              <TextControls
                fontSize={subheadFs}
                onFontSize={(v) => {
                  setSubheadFs(v)
                  schedulePersist()
                }}
                align={subheadAlign}
                onAlign={(v) => {
                  setSubheadAlign(v)
                  schedulePersist()
                }}
                color={subheadColor}
                onColor={(v) => {
                  setSubheadColor(v)
                  schedulePersist()
                }}
              />
              <div className={layerUi.subheadTextShellClass} dir="rtl">
                <EditableText
                  className={layerUi.subheadEditableClass}
                  style={{ fontSize: subheadFs, textAlign: subheadAlign, color: subheadColor }}
                  text={subhead}
                  resetKey={taskId}
                  onTextChange={(v) => {
                    setSubhead(v)
                    schedulePersist()
                  }}
                />
              </div>
            </BannerLayer>

            <BannerLayer
              canvasRef={captureRef}
              box={bulletsBox}
              setBox={setBulletsBox}
              className={`${layerClass('bullets')} ${layerUi.layerTextMod}`}
              layerKey="bullets"
              setDraggingKey={setDraggingKey}
              viewportScale={scale}
              minWidth={280}
              minHeight={200}
              onUserCommit={schedulePersist}
              designSize={designSize}
              {...handleProps}
            >
              <TextControls
                fontSize={bulletsFs}
                onFontSize={(v) => {
                  setBulletsFs(v)
                  schedulePersist()
                }}
                align={bulletsAlign}
                onAlign={(v) => {
                  setBulletsAlign(v)
                  schedulePersist()
                }}
                color={bulletsColor}
                onColor={(v) => {
                  setBulletsColor(v)
                  schedulePersist()
                }}
              />
              <div
                className={`${layerUi.featGridBase}${isVertical ? ` ${layerUi.featGridVertical}` : ''}`}
                dir="rtl"
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
            </BannerLayer>

            <BannerLayer
              canvasRef={captureRef}
              box={ctaBox}
              setBox={setCtaBox}
              className={`${layerClass('cta')} ${layerUi.layerCtaMod}`}
              layerKey="cta"
              setDraggingKey={setDraggingKey}
              viewportScale={scale}
              minWidth={160}
              minHeight={52}
              dragHandleOnly
              dragControls={ctaDragControls}
              onUserCommit={schedulePersist}
              designSize={designSize}
              {...handleProps}
            >
              <TextControls
                fontSize={ctaFs}
                onFontSize={(v) => {
                  setCtaFs(v)
                  schedulePersist()
                }}
                align={ctaAlign}
                onAlign={(v) => {
                  setCtaAlign(v)
                  schedulePersist()
                }}
                color={ctaColor}
                onColor={(v) => {
                  setCtaColor(v)
                  schedulePersist()
                }}
              />
              <div className={layerUi.ctaTextShellClass}>
                <div
                  className={layerUi.ctaDragHandleClass}
                  title="גרור להזזה"
                  onPointerDown={(e) => ctaDragControls.start(e)}
                >
                  <span className={layerUi.ctaDragGripClass} aria-hidden />
                  <span className={layerUi.ctaDragLabelClass}>גרור</span>
                </div>
                <div className="mt-1" style={{ textAlign: ctaAlign }} dir="rtl">
                  <EditableText
                    className={layerUi.ctaEditableClass}
                    text={cta}
                    resetKey={taskId}
                    onTextChange={(v) => {
                      setCta(v)
                      schedulePersist()
                    }}
                    style={{
                      fontSize: ctaFs,
                      backgroundColor: ctaBgHex,
                      color: ctaColor,
                      boxShadow: layerUi.getCtaBoxShadow({ ctaBgHex, brandR, brandG, brandB }),
                    }}
                  />
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
