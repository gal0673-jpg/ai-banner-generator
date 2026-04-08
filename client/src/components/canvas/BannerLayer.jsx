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

/**
 * Framer Motion drag + re-resizable wrapper. `designSize` defaults to 1080×1080; pass another preset for 9:16 later.
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
  handleWrapperClass = 'banner-resize-handle-root',
  layerInnerClass = 'banner-layer-inner',
  designSize = BANNER_SQUARE_1_1,
}) {
  const layerRef = useRef(null)

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
      style={{ position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height }}
      onDragStart={() => setDraggingKey(layerKey)}
      onDragEnd={() => {
        commitPositionInBanner(canvasRef.current, layerRef.current, setBox, designSize)
        setDraggingKey(null)
        onUserCommit?.()
      }}
    >
      <Resizable
        size={{ width: box.width, height: box.height }}
        scale={viewportScale}
        minWidth={minWidth}
        minHeight={minHeight}
        lockAspectRatio={lockAspectRatio}
        enable={RESIZE_ENABLE}
        handleWrapperClass={handleWrapperClass}
        onResizeStop={(_e, _dir, ref) => {
          setBox((b) => ({ ...b, width: ref.offsetWidth, height: ref.offsetHeight }))
          onUserCommit?.()
        }}
        className="box-border h-full w-full"
        style={{ display: 'block', boxSizing: 'border-box' }}
      >
        <div className={`${layerInnerClass} box-border h-full w-full overflow-visible p-1`}>
          {children}
        </div>
      </Resizable>
    </Motion.div>
  )
}
