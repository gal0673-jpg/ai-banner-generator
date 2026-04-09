import { colorInputHex } from './canvasUtils.js'

/**
 * Top-right text toolbar; hidden during PNG export via html-to-image filter on `.banner-text-controls`.
 * An inverse CSS scale is applied so the toolbar always appears at native screen size regardless
 * of how much the parent canvas element is scaled down to fit the viewport.
 */
export default function TextControls({ fontSize, onFontSize, align, onAlign, color, onColor, viewportScale = 1 }) {
  /** stopPropagation only — preventDefault on mousedown breaks <input type="color" /> picker */
  const stopDrag = (e) => {
    e.stopPropagation()
  }
  const stopBtn = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const cv = colorInputHex(color)
  const inverseScale = viewportScale > 0 ? 1 / viewportScale : 1
  return (
    <div
      className="banner-text-controls"
      style={{ transform: `scale(${inverseScale})`, transformOrigin: 'top right' }}
      onMouseDown={stopDrag}
      onClick={stopDrag}
    >
      <div className="btc-group">
        <button type="button" className="btc-btn" onMouseDown={(e) => { stopBtn(e); onFontSize(Math.max(10, fontSize - 2)) }} title="הקטן גופן">A−</button>
        <span className="btc-val">{fontSize}px</span>
        <button type="button" className="btc-btn" onMouseDown={(e) => { stopBtn(e); onFontSize(Math.min(130, fontSize + 2)) }} title="הגדל גופן">A+</button>
      </div>
      <span className="btc-sep" aria-hidden />
      <label className="btc-color-wrap" title="צבע טקסט" onMouseDown={stopDrag}>
        <span className="btc-color-swatch" style={{ backgroundColor: cv }} aria-hidden />
        <input
          type="color"
          className="btc-color-input"
          value={cv}
          onChange={(e) => onColor(e.target.value)}
          onMouseDown={stopDrag}
          aria-label="צבע טקסט"
        />
      </label>
      <span className="btc-sep" aria-hidden />
      <div className="btc-group">
        {[['right', 'ימין'], ['center', 'מרכז'], ['left', 'שמאל']].map(([a, label]) => (
          <button
            type="button"
            key={a}
            className={`btc-btn${align === a ? ' btc-btn--on' : ''}`}
            onMouseDown={(e) => { stopBtn(e); onAlign(a) }}
            title={label}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
