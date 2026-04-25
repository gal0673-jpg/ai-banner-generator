import { useCallback, useMemo } from 'react'
import BannerWorkspaceContainer from './components/canvas/BannerWorkspaceContainer.jsx'
import { buildCapturePngFilter, resolveCanvasLayout } from './canvasLayouts.jsx'
import './BannerCanvas.css'
import './BannerCanvas2.css'
import './BannerCanvas3.css'

/**
 * Single entry for banner designs 1–3; picks layout registry entry from `designType`.
 * @param {object} props
 * @param {1 | 2 | 3} [props.designType=1]
 */
export default function DynamicBannerCanvas({
  designType = 1,
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
  const layout = useMemo(() => resolveCanvasLayout(designType), [designType])
  const isVertical = aspectRatio === '9:16'
  const defaultBoxes = isVertical ? layout.defaultBoxesVertical : layout.defaultBoxesSquare
  const persistDesignKey = isVertical ? layout.persistKeyVertical : layout.persistKeySquare

  const capturePngOptions = useMemo(
    () => ({
      backgroundColor: layout.captureBackgroundColor,
      style: {
        transform: 'scale(1)',
        ...layout.captureStyleExtra,
      },
      filter: buildCapturePngFilter(layout.resizeHandleRootClass || ''),
    }),
    [layout],
  )

  const downloadFilenameBase = useCallback(
    ({ taskId: tid, isVertical: vert }) =>
      `${layout.downloadPrefix}${vert ? '-vertical' : ''}-${(tid || 'export').slice(0, 8)}.png`,
    [layout.downloadPrefix],
  )

  const stateDefaults = useMemo(
    () => ({
      fontSizes: isVertical ? layout.fontSizesVertical : layout.fontSizesSquare,
      textColors: layout.textColors,
      boxes: defaultBoxes,
    }),
    [defaultBoxes, isVertical, layout.fontSizesSquare, layout.fontSizesVertical, layout.textColors],
  )

  const viewportClassName = `${layout.viewportBaseClass}${isVertical ? ` ${layout.viewportVerticalModClass}` : ''}`

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
      surfaceIdPrefix={layout.surfaceIdPrefix}
      rootClassName={layout.rootClassName}
      viewportClassName={viewportClassName}
      viewportInnerClassName={layout.viewportInnerClassName}
      captureClassName={layout.captureClassName}
      downloadRowClassName={layout.downloadRowClassName}
      downloadButtonClassName={layout.downloadButtonClassName}
      downloadErrorClassName={layout.downloadErrorClassName}
      capturePngOptions={capturePngOptions}
      downloadFilenameBase={downloadFilenameBase}
      layerUi={layout.layerUi}
      renderCanvasBackground={layout.renderCanvasBackground}
    />
  )
}
