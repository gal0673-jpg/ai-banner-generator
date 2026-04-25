/**
 * Shared banner canvas utilities (colors, domain, coordinates).
 * Dimensions are explicit so 9:16 (e.g. 1080×1920) can reuse the same helpers later.
 */

import { toPng } from 'html-to-image'

/** Square feed banner — current default for Design 1 & 2 */
export const BANNER_SQUARE_1_1 = { width: 1080, height: 1080 }

/** Vertical story/reels style — reserved for a future layout */
export const BANNER_VERTICAL_9_16 = { width: 1080, height: 1920 }

export const DEFAULT_BRAND_HEX = '#4F46E5'

export function colorInputHex(hex) {
  if (!hex || typeof hex !== 'string') return '#000000'
  let s = hex.trim()
  if (!s.startsWith('#')) s = `#${s}`
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase()
  return '#000000'
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

export function normalizeBrandHex(input) {
  if (!input || typeof input !== 'string') return DEFAULT_BRAND_HEX
  let s = input.trim()
  if (!s.startsWith('#')) s = `#${s}`
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toUpperCase()
  return DEFAULT_BRAND_HEX
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

export function contrastingTextColor(bgHex) {
  const h = (bgHex && bgHex.startsWith('#') ? bgHex : DEFAULT_BRAND_HEX).slice(1)
  if (h.length !== 6) return '#ffffff'
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.55 ? '#0f172a' : '#ffffff'
}

export function extractDomain(url) {
  if (!url) return ''
  try {
    const u = url.includes('://') ? url : `https://${url}`
    return new URL(u).hostname
  } catch {
    return url
  }
}

export function waitForImagesInNode(root) {
  const imgs = root.querySelectorAll('img')
  return Promise.all(
    [...imgs].map(
      (img) =>
        new Promise((resolve) => {
          const done = () => {
            if (typeof img.decode === 'function') {
              img.decode().then(resolve).catch(resolve)
            } else {
              resolve()
            }
          }
          if (img.complete) done()
          else {
            img.addEventListener('load', done, { once: true })
            img.addEventListener('error', () => resolve(), { once: true })
          }
        }),
    ),
  )
}

/**
 * Map layer DOM position to design pixel space using the canvas root rect.
 *
 * @param {HTMLElement | null} canvasEl
 * @param {HTMLElement | null} layerEl
 * @param {function} setBox - React setState for { x, y, width, height }
 * @param {{ width: number, height: number }} designSize - logical canvas size (e.g. BANNER_SQUARE_1_1)
 * @param {number} [viewportScale=1] - CSS transform scale applied to the canvas element.
 *   Used to convert the layer element's rendered offsetHeight (screen px) to canvas px for
 *   accurate y-clamping, especially important for autoHeight layers whose box.height may
 *   be a stale default rather than the real rendered height.
 */
export function commitPositionInBanner(canvasEl, layerEl, setBox, designSize, viewportScale = 1) {
  if (!canvasEl || !layerEl) return
  const w = designSize?.width ?? BANNER_SQUARE_1_1.width
  const h = designSize?.height ?? BANNER_SQUARE_1_1.height
  const cr = canvasEl.getBoundingClientRect()
  const lr = layerEl.getBoundingClientRect()
  if (cr.width <= 0 || cr.height <= 0) return
  const nx = ((lr.left - cr.left) / cr.width) * w
  const ny = ((lr.top - cr.top) / cr.height) * h
  // Use the layer's actual rendered height (screen px ÷ scale → canvas px) for clamping.
  // This is more accurate than b.height which can be stale for autoHeight layers.
  const actualH = viewportScale > 0 ? layerEl.offsetHeight / viewportScale : 0
  setBox((b) => ({
    ...b,
    x: clamp(Math.round(nx), 0, Math.max(0, w - b.width)),
    y: clamp(Math.round(ny), 0, Math.max(0, h - (actualH || b.height))),
  }))
}

/**
 * Build the persisted slice from the LEGACY flat state shape.
 * Kept for backward-compatibility — prefer `buildPersistSliceFromState` for
 * the reducer-based state shape.
 */
export function buildBannerPersistSlice(s) {
  return {
    headline: s.headline,
    subhead: s.subhead,
    cta: s.cta,
    bullets: s.bullets,
    brand_color: s.brand_color,
    logoBox: s.logoBox,
    headlineBox: s.headlineBox,
    subheadBox: s.subheadBox,
    bulletsBox: s.bulletsBox,
    ctaBox: s.ctaBox,
    headlineFs: s.headlineFs,
    headlineAlign: s.headlineAlign,
    headlineColor: s.headlineColor,
    subheadFs: s.subheadFs,
    subheadAlign: s.subheadAlign,
    subheadColor: s.subheadColor,
    bulletsFs: s.bulletsFs,
    bulletsAlign: s.bulletsAlign,
    bulletsColor: s.bulletsColor,
    ctaFs: s.ctaFs,
    ctaAlign: s.ctaAlign,
    ctaColor: s.ctaColor,
  }
}

/**
 * Build the persisted slice from the REDUCER state shape
 * `{ headline, subhead, cta, bullets, boxes: { logo, ... }, style: { headlineFs, ... } }`.
 *
 * @param {object} state  — reducer state from `useBannerCanvasState`
 * @param {string} brandColor — current brand colour prop (stored for round-trip)
 */
export function buildPersistSliceFromState(state, brandColor) {
  return {
    headline:        state.headline,
    subhead:         state.subhead,
    cta:             state.cta,
    bullets:         state.bullets,
    brand_color:     brandColor ?? '',
    logoBox:         state.boxes.logo,
    contentStackBox: state.boxes.contentStack,
    headlineFs:      state.style.headlineFs,
    headlineAlign:   state.style.headlineAlign,
    headlineColor:   state.style.headlineColor,
    subheadFs:       state.style.subheadFs,
    subheadAlign:    state.style.subheadAlign,
    subheadColor:    state.style.subheadColor,
    bulletsFs:       state.style.bulletsFs,
    bulletsAlign:    state.style.bulletsAlign,
    bulletsColor:    state.style.bulletsColor,
    ctaFs:           state.style.ctaFs,
    ctaAlign:        state.style.ctaAlign,
    ctaColor:        state.style.ctaColor,
  }
}

/**
 * Merge a persisted slice back into a reducer state object, returning a new
 * state value.  Replaces `applyBannerPersistSlice` (which required individual
 * setters) when the reducer pattern is used.
 *
 * @param {object} state  — current canvas state / `history.present` (will NOT be mutated)
 * @param {object} slice  — persisted slice (may be null / undefined)
 * @returns {object} new state with slice values applied
 */
/**
 * Deep-clone banner canvas reducer state (text, bullets, boxes, style).
 * Used for undo history snapshots.
 *
 * @param {object} state
 * @returns {object}
 */
export function cloneBannerCanvasState(state) {
  if (typeof structuredClone === 'function') {
    return structuredClone(state)
  }
  return JSON.parse(JSON.stringify(state))
}

/**
 * Stable JSON equality for undo dedupe (e.g. drag that ends at the same coords).
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function bannerCanvasStatesEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return a === b
  }
}

export function mergePersistSliceIntoState(state, slice) {
  if (!slice || typeof slice !== 'object') return state
  const boxes = { ...state.boxes }
  const style = { ...state.style }

  if (slice.logoBox) boxes.logo = { ...slice.logoBox }

  // New format: single contentStackBox
  if (slice.contentStackBox) {
    boxes.contentStack = { ...slice.contentStackBox }
  } else if (slice.headlineBox) {
    // Backward-compat: old saved slices stored individual boxes.
    // Derive contentStack position from the headline box (they shared x/y/width).
    boxes.contentStack = {
      ...boxes.contentStack,
      x:     slice.headlineBox.x,
      y:     slice.headlineBox.y,
      width: slice.headlineBox.width,
    }
  }

  if (typeof slice.headlineFs === 'number') style.headlineFs    = slice.headlineFs
  if (slice.headlineAlign)                  style.headlineAlign = slice.headlineAlign
  if (slice.headlineColor)                  style.headlineColor = slice.headlineColor
  if (typeof slice.subheadFs === 'number')  style.subheadFs     = slice.subheadFs
  if (slice.subheadAlign)                   style.subheadAlign  = slice.subheadAlign
  if (slice.subheadColor)                   style.subheadColor  = slice.subheadColor
  if (typeof slice.bulletsFs === 'number')  style.bulletsFs     = slice.bulletsFs
  if (slice.bulletsAlign)                   style.bulletsAlign  = slice.bulletsAlign
  if (slice.bulletsColor)                   style.bulletsColor  = slice.bulletsColor
  if (typeof slice.ctaFs === 'number')      style.ctaFs         = slice.ctaFs
  if (slice.ctaAlign)                       style.ctaAlign      = slice.ctaAlign
  if (slice.ctaColor)                       style.ctaColor      = slice.ctaColor
  return { ...state, boxes, style }
}

export function applyBannerPersistSlice(slice, setters) {
  const {
    setLogoBox, setHeadlineBox, setSubheadBox, setBulletsBox, setCtaBox,
    setHeadlineFs, setHeadlineAlign, setHeadlineColor,
    setSubheadFs, setSubheadAlign, setSubheadColor,
    setBulletsFs, setBulletsAlign, setBulletsColor,
    setCtaFs, setCtaAlign, setCtaColor,
  } = setters
  if (!slice || typeof slice !== 'object') return
  if (slice.logoBox) setLogoBox({ ...slice.logoBox })
  if (slice.headlineBox) setHeadlineBox({ ...slice.headlineBox })
  if (slice.subheadBox) setSubheadBox({ ...slice.subheadBox })
  if (slice.bulletsBox) setBulletsBox({ ...slice.bulletsBox })
  if (slice.ctaBox) setCtaBox({ ...slice.ctaBox })
  if (typeof slice.headlineFs === 'number') setHeadlineFs(slice.headlineFs)
  if (slice.headlineAlign) setHeadlineAlign(slice.headlineAlign)
  if (slice.headlineColor) setHeadlineColor(slice.headlineColor)
  if (typeof slice.subheadFs === 'number') setSubheadFs(slice.subheadFs)
  if (slice.subheadAlign) setSubheadAlign(slice.subheadAlign)
  if (slice.subheadColor) setSubheadColor(slice.subheadColor)
  if (typeof slice.bulletsFs === 'number') setBulletsFs(slice.bulletsFs)
  if (slice.bulletsAlign) setBulletsAlign(slice.bulletsAlign)
  if (slice.bulletsColor) setBulletsColor(slice.bulletsColor)
  if (typeof slice.ctaFs === 'number') setCtaFs(slice.ctaFs)
  if (slice.ctaAlign) setCtaAlign(slice.ctaAlign)
  if (slice.ctaColor) setCtaColor(slice.ctaColor)
}

/**
 * html-to-image capture with the same timing as the original canvases (rAF + decode images).
 */
export async function captureBannerNodeToPng(node, options) {
  const {
    width,
    height,
    backgroundColor,
    style = { transform: 'scale(1)', colorScheme: 'light' },
    filter,
    pixelRatio = 2,
  } = options
  await new Promise((r) => requestAnimationFrame(r))
  await new Promise((r) => requestAnimationFrame(r))
  await waitForImagesInNode(node)
  await new Promise((r) => requestAnimationFrame(r))
  return toPng(node, {
    cacheBust: true,
    pixelRatio,
    width,
    height,
    backgroundColor,
    style,
    filter,
  })
}
