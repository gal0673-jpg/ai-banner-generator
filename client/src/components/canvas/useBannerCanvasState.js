import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyBannerPersistSlice,
  BANNER_VERTICAL_9_16,
  buildBannerPersistSlice,
  contrastingTextColor,
  normalizeBrandHex,
} from './canvasUtils.js'

// ─── 9:16 vertical layout metrics (Design 1: top/bottom split) ───────────────
// Image = exactly 40% of full canvas height (e.g. 1920 × 0.4 = 768px), then 6px divider,
// then text panel fills the space down to the domain strip (not counted in the 40%).

/** @param {number} bannerHeight logical canvas height (e.g. 1920) */
export function computeDesign1VerticalMetrics(bannerHeight = BANNER_VERTICAL_9_16.height) {
  const stripH = 70
  const contentH = bannerHeight - stripH
  const imageZoneH = Math.round(bannerHeight * 0.4)
  const dividerH = 6
  const textZoneTop = imageZoneH + dividerH
  const textZoneH = contentH - textZoneTop
  return { stripH, contentH, imageZoneH, dividerH, textZoneTop, textZoneH }
}

/**
 * Default layer boxes for Design 1 @ 9:16 (1080×1920).
 * Logo in top 40% hero; headline → CTA spaced in the text band below the divider (TikTok/Reels style).
 * Coordinates assume textZoneTop = 774, strip starts at y = 1850.
 */
export const DESIGN1_DEFAULT_LOGO_VERTICAL = { x: 836, y: 40, width: 200, height: 72 }
export const DESIGN1_DEFAULT_HEADLINE_VERTICAL = { x: 44, y: 800, width: 992, height: 228 }
export const DESIGN1_DEFAULT_SUBHEAD_VERTICAL = { x: 44, y: 1062, width: 992, height: 132 }
export const DESIGN1_DEFAULT_BULLETS_VERTICAL = { x: 44, y: 1228, width: 992, height: 468 }
export const DESIGN1_DEFAULT_CTA_VERTICAL = { x: 120, y: 1730, width: 840, height: 96 }

export const DESIGN1_DEFAULT_BOXES_VERTICAL = {
  logo: { ...DESIGN1_DEFAULT_LOGO_VERTICAL },
  headline: { ...DESIGN1_DEFAULT_HEADLINE_VERTICAL },
  subhead: { ...DESIGN1_DEFAULT_SUBHEAD_VERTICAL },
  bullets: { ...DESIGN1_DEFAULT_BULLETS_VERTICAL },
  cta: { ...DESIGN1_DEFAULT_CTA_VERTICAL },
}

// ─── 9:16 vertical layout (Design 2: full-bleed; same 40% + 6px + text band as D1) ─
// Strip H = 64 → content ends at y = 1856. textZoneTop = 774.

export const DESIGN2_DEFAULT_LOGO_VERTICAL = { x: 806, y: 52, width: 210, height: 78 }
export const DESIGN2_DEFAULT_HEADLINE_VERTICAL = { x: 64, y: 802, width: 952, height: 272 }
export const DESIGN2_DEFAULT_SUBHEAD_VERTICAL = { x: 64, y: 1098, width: 952, height: 140 }
export const DESIGN2_DEFAULT_BULLETS_VERTICAL = { x: 64, y: 1266, width: 952, height: 456 }
export const DESIGN2_DEFAULT_CTA_VERTICAL = { x: 144, y: 1746, width: 792, height: 96 }

export const DESIGN2_DEFAULT_BOXES_VERTICAL = {
  logo: { ...DESIGN2_DEFAULT_LOGO_VERTICAL },
  headline: { ...DESIGN2_DEFAULT_HEADLINE_VERTICAL },
  subhead: { ...DESIGN2_DEFAULT_SUBHEAD_VERTICAL },
  bullets: { ...DESIGN2_DEFAULT_BULLETS_VERTICAL },
  cta: { ...DESIGN2_DEFAULT_CTA_VERTICAL },
}

/**
 * Shared editable-banner state: text, layer boxes, typography, debounced persist.
 *
 * @param {object} options
 * @param {string} [options.taskId]
 * @param {string} [options.brandColor]
 * @param {string} [options.headlineInitial]
 * @param {string} [options.subheadInitial]
 * @param {string[]} [options.bulletPoints]
 * @param {string} [options.ctaInitial]
 * @param {object | null} [options.savedCanvasSlice]
 * @param {function} [options.onPersist]
 * @param {string} options.persistDesignKey — canvas_state key (e.g. design1, design1_vertical, design2_vertical)
 * @param {object} options.defaults
 * @param {{ headline: number, subhead: number, bullets: number, cta: number }} options.defaults.fontSizes
 * @param {{ headline: string, subhead: string, bullets: string }} options.defaults.textColors
 * @param {{ logo: object, headline: object, subhead: object, bullets: object, cta: object }} options.defaults.boxes
 */
export function useBannerCanvasState({
  taskId,
  brandColor,
  headlineInitial,
  subheadInitial,
  bulletPoints,
  ctaInitial,
  savedCanvasSlice,
  onPersist,
  persistDesignKey,
  defaults,
}) {
  const { fontSizes: DF, textColors: DC, boxes: DEFAULT_BOXES } = defaults

  const [headline, setHeadline] = useState(headlineInitial ?? '')
  const [subhead, setSubhead] = useState(subheadInitial ?? '')
  const [bullets, setBullets] = useState(() => [...(bulletPoints || [])])
  const [cta, setCta] = useState(ctaInitial ?? '')

  const [logoBox, setLogoBox] = useState(() => ({ ...DEFAULT_BOXES.logo }))
  const [headlineBox, setHeadlineBox] = useState(() => ({ ...DEFAULT_BOXES.headline }))
  const [subheadBox, setSubheadBox] = useState(() => ({ ...DEFAULT_BOXES.subhead }))
  const [bulletsBox, setBulletsBox] = useState(() => ({ ...DEFAULT_BOXES.bullets }))
  const [ctaBox, setCtaBox] = useState(() => ({ ...DEFAULT_BOXES.cta }))
  const [draggingKey, setDraggingKey] = useState(null)

  const [headlineFs, setHeadlineFs] = useState(DF.headline)
  const [headlineAlign, setHeadlineAlign] = useState('right')
  const [subheadFs, setSubheadFs] = useState(DF.subhead)
  const [subheadAlign, setSubheadAlign] = useState('right')
  const [bulletsFs, setBulletsFs] = useState(DF.bullets)
  const [bulletsAlign, setBulletsAlign] = useState('right')
  const [ctaFs, setCtaFs] = useState(DF.cta)
  const [ctaAlign, setCtaAlign] = useState('center')
  const [headlineColor, setHeadlineColor] = useState(DC.headline)
  const [subheadColor, setSubheadColor] = useState(DC.subhead)
  const [bulletsColor, setBulletsColor] = useState(DC.bullets)
  const [ctaColor, setCtaColor] = useState('#ffffff')

  const persistTimerRef = useRef(null)
  const stateRef = useRef({})

  const flushPersist = useCallback(() => {
    if (!onPersist || !taskId) return
    const s = stateRef.current
    onPersist({
      headline: s.headline,
      subhead: s.subhead,
      cta: s.cta,
      bullet_points: s.bullets,
      canvas_state: { v: 1, [persistDesignKey]: buildBannerPersistSlice(s) },
    })
  }, [onPersist, taskId, persistDesignKey])

  const flushPersistRef = useRef(flushPersist)
  flushPersistRef.current = flushPersist

  const schedulePersist = useCallback(() => {
    if (!onPersist || !taskId) return
    clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      flushPersist()
    }, 1000)
  }, [onPersist, taskId, flushPersist])

  useEffect(
    () => () => {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
      flushPersistRef.current()
    },
    [],
  )

  useEffect(() => {
    stateRef.current = {
      headline,
      subhead,
      bullets,
      cta,
      brand_color: brandColor,
      logoBox,
      headlineBox,
      subheadBox,
      bulletsBox,
      ctaBox,
      headlineFs,
      headlineAlign,
      headlineColor,
      subheadFs,
      subheadAlign,
      subheadColor,
      bulletsFs,
      bulletsAlign,
      bulletsColor,
      ctaFs,
      ctaAlign,
      ctaColor,
    }
  }, [
    headline,
    subhead,
    bullets,
    cta,
    logoBox,
    headlineBox,
    subheadBox,
    bulletsBox,
    ctaBox,
    headlineFs,
    headlineAlign,
    headlineColor,
    subheadFs,
    subheadAlign,
    subheadColor,
    bulletsFs,
    bulletsAlign,
    bulletsColor,
    ctaFs,
    ctaAlign,
    ctaColor,
    brandColor,
  ])

  const bulletsKey = bulletPoints ? JSON.stringify(bulletPoints) : ''
  const savedSliceKey = useMemo(
    () => (savedCanvasSlice && typeof savedCanvasSlice === 'object' ? JSON.stringify(savedCanvasSlice) : ''),
    [savedCanvasSlice],
  )

  useEffect(() => {
    setHeadline(headlineInitial ?? '')
    setSubhead(subheadInitial ?? '')
    setBullets([...(bulletPoints || [])])
    setCta(ctaInitial ?? '')
    setLogoBox({ ...DEFAULT_BOXES.logo })
    setHeadlineBox({ ...DEFAULT_BOXES.headline })
    setSubheadBox({ ...DEFAULT_BOXES.subhead })
    setBulletsBox({ ...DEFAULT_BOXES.bullets })
    setCtaBox({ ...DEFAULT_BOXES.cta })
    setDraggingKey(null)
    setHeadlineFs(DF.headline)
    setHeadlineAlign('right')
    setSubheadFs(DF.subhead)
    setSubheadAlign('right')
    setBulletsFs(DF.bullets)
    setBulletsAlign('right')
    setCtaFs(DF.cta)
    setCtaAlign('center')
    setHeadlineColor(DC.headline)
    setSubheadColor(DC.subhead)
    setBulletsColor(DC.bullets)
    const bg = normalizeBrandHex(brandColor)
    setCtaColor(contrastingTextColor(bg))
    if (savedCanvasSlice && typeof savedCanvasSlice === 'object') {
      applyBannerPersistSlice(savedCanvasSlice, {
        setLogoBox,
        setHeadlineBox,
        setSubheadBox,
        setBulletsBox,
        setCtaBox,
        setHeadlineFs,
        setHeadlineAlign,
        setHeadlineColor,
        setSubheadFs,
        setSubheadAlign,
        setSubheadColor,
        setBulletsFs,
        setBulletsAlign,
        setBulletsColor,
        setCtaFs,
        setCtaAlign,
        setCtaColor,
      })
    }
  }, [
    taskId,
    bulletsKey,
    bulletPoints,
    savedSliceKey,
    headlineInitial,
    subheadInitial,
    ctaInitial,
    brandColor,
    savedCanvasSlice,
    persistDesignKey,
    defaults,
  ])

  const setBulletAt = useCallback(
    (index, value) => {
      setBullets((prev) => {
        const next = [...prev]
        next[index] = value
        return next
      })
      schedulePersist()
    },
    [schedulePersist],
  )

  return {
    headline,
    setHeadline,
    subhead,
    setSubhead,
    bullets,
    setBullets,
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
  }
}
