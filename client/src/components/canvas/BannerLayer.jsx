import { useRef } from 'react'
import { motion as Motion } from 'framer-motion'
import { Resizable } from 're-resizable'
import { BANNER_SQUARE_1_1, commitPositionInBanner } from './canvasUtils.js'

const RESIZE_ENABLE = {
  top: false,
  left: false,
  topLeft: false,
  topRight: false,
  bottomLeft: false,
  right: true,
  bottom: true,
  bottomRight: true,
}

/** Width-only handles: used when autoHeight=true so height grows with content. */
const RESIZE_ENABLE_WIDTH_ONLY = {
  top: false,
  left: false,
  topLeft: false,
  topRight: false,
  bottomLeft: false,
  right: true,
  bottom: false,
  bottomRight: false,
}

/**
 * Framer Motion drag + re-resizable wrapper. `designSize` defaults to 1080×1080; pass another preset for 9:16 later.
 *
 * When `autoHeight` is true the layer grows with its content instead of being
 * constrained to `box.height`. Vertical resize handles are disabled and height
 * is never written back to state from `onResizeStop`.
 */
export default function BannerLayer({
  canvasRef,
  box,
  setBox,
  className,
  layerKey,
  setDraggingKey,
  viewportScale,
  minWidth,
  minHeight,
  lockAspectRatio,
  dragHandleOnly,
  dragControls,
  children,
  onUserCommit,
  autoHeight = false,
  handleWrapperClass = 'banner-resize-handle-root',
  layerInnerClass = 'banner-layer-inner',
  designSize = BANNER_SQUARE_1_1,
}) {
  const layerRef = useRef(null)

  const motionHeight = autoHeight ? 'auto' : box.height
  const resizableSize = { width: box.width, height: autoHeight ? 'auto' : box.height }
  const resizableEnable = autoHeight ? RESIZE_ENABLE_WIDTH_ONLY : RESIZE_ENABLE

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
      style={{ position: 'absolute', left: box.x, top: box.y, width: box.width, height: motionHeight }}
      onDragStart={() => setDraggingKey(layerKey)}
      onDragEnd={() => {
        commitPositionInBanner(canvasRef.current, layerRef.current, setBox, designSize, viewportScale)
        setDraggingKey(null)
        onUserCommit?.()
      }}
    >
      <Resizable
        size={resizableSize}
        scale={viewportScale}
        minWidth={minWidth}
        minHeight={minHeight}
        lockAspectRatio={lockAspectRatio}
        enable={resizableEnable}
        handleWrapperClass={handleWrapperClass}
        onResizeStop={(_e, _dir, ref) => {
          setBox((b) => ({
            ...b,
            width: ref.offsetWidth,
            ...(autoHeight ? {} : { height: ref.offsetHeight }),
          }))
          onUserCommit?.()
        }}
        className="box-border w-full"
        style={{ display: 'block', boxSizing: 'border-box', height: autoHeight ? 'auto' : '100%' }}
      >
        {/* Inline height:auto overrides the CSS `height:100%` rule on banner-layer-inner / bc2-layer-inner
            so the div expands with its text content instead of collapsing or overflowing. */}
        <div
          className={`${layerInnerClass} box-border w-full overflow-visible p-1`}
          style={{ height: autoHeight ? 'auto' : '100%' }}
        >
          {children}
        </div>
      </Resizable>
    </Motion.div>
  )
}
