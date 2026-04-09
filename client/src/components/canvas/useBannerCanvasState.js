import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  BANNER_VERTICAL_9_16,
  buildPersistSliceFromState,
  contrastingTextColor,
  mergePersistSliceIntoState,
  normalizeBrandHex,
} from './canvasUtils.js'
import { useDebouncedCallback } from './useDebouncedCallback.js'

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
 * Content stack starts where the headline used to be and spans down through the CTA area.
 * Using a generous height so the drag y-clamp stays permissive (~820px headroom at top).
 */
export const DESIGN1_DEFAULT_LOGO_VERTICAL         = { x: 836, y: 40,  width: 200, height: 72   }
export const DESIGN1_DEFAULT_CONTENT_STACK_VERTICAL = { x: 44,  y: 760, width: 992, height: 1050 }

export const DESIGN1_DEFAULT_BOXES_VERTICAL = {
  logo:         { ...DESIGN1_DEFAULT_LOGO_VERTICAL },
  contentStack: { ...DESIGN1_DEFAULT_CONTENT_STACK_VERTICAL },
}

// ─── 9:16 vertical layout (Design 2: full-bleed; same 40% + 6px + text band as D1) ─
// Strip H = 64 → content ends at y = 1856. textZoneTop = 774.

export const DESIGN2_DEFAULT_LOGO_VERTICAL         = { x: 806, y: 52,  width: 210, height: 78   }
export const DESIGN2_DEFAULT_CONTENT_STACK_VERTICAL = { x: 64,  y: 380, width: 952, height: 1100 }

export const DESIGN2_DEFAULT_BOXES_VERTICAL = {
  logo:         { ...DESIGN2_DEFAULT_LOGO_VERTICAL },
  contentStack: { ...DESIGN2_DEFAULT_CONTENT_STACK_VERTICAL },
}

// ─── 9:16 vertical layout (Design 3: minimalist card) ────────────────────────
// Card: x=80 y=180 w=920 h=1560 (brand-colour margins of 80px H / 180px V).
// Inner padding 72px → content starts at x=152, y=252.

export const DESIGN3_DEFAULT_BOXES_VERTICAL = {
  logo:         { x: 628, y: 220, width: 220, height: 80   },
  contentStack: { x: 152, y: 330, width: 776, height: 1300 },
}

// ─── Action type constants ────────────────────────────────────────────────────

/**
 * Exported so `BannerWorkspaceContainer` (and tests) can reference action types
 * without string literals.
 *
 * @type {{ UPDATE_TEXT: string, SET_BULLET_AT: string, UPDATE_BOX: string, UPDATE_STYLE: string, RESET: string }}
 */
export const ACTIONS = Object.freeze({
  UPDATE_TEXT:   'UPDATE_TEXT',   // { field: 'headline'|'subhead'|'cta', value: string }
  SET_BULLET_AT: 'SET_BULLET_AT', // { index: number, value: string }
  UPDATE_BOX:    'UPDATE_BOX',    // { layer: 'logo'|'contentStack', box: BoxRect }
  UPDATE_STYLE:  'UPDATE_STYLE',  // { field: styleKey, value: any }
  RESET:         'RESET',         // { state: BannerCanvasState }
})

// ─── Reducer ─────────────────────────────────────────────────────────────────

/**
 * Pure reducer for banner canvas state.
 * Exported for unit testing — do NOT use directly in components.
 *
 * @param {BannerCanvasState} state
 * @param {{ type: string, [k: string]: any }} action
 * @returns {BannerCanvasState}
 */
export function bannerReducer(state, action) {
  switch (action.type) {
    case ACTIONS.UPDATE_TEXT:
      return { ...state, [action.field]: action.value }

    case ACTIONS.SET_BULLET_AT: {
      const bullets = [...state.bullets]
      bullets[action.index] = action.value
      return { ...state, bullets }
    }

    case ACTIONS.UPDATE_BOX:
      return {
        ...state,
        boxes: { ...state.boxes, [action.layer]: action.box },
      }

    case ACTIONS.UPDATE_STYLE:
      return {
        ...state,
        style: { ...state.style, [action.field]: action.value },
      }

    case ACTIONS.RESET:
      return action.state

    default:
      return state
  }
}

// ─── Initial state builder ────────────────────────────────────────────────────

/**
 * Build the initial (or reset) reducer state from props.
 * Pure function — safe to call inside `useReducer`'s initialiser and `RESET` dispatch.
 */
function buildInitialState({ headlineInitial, subheadInitial, bulletPoints, ctaInitial, defaults, brandColor, savedCanvasSlice }) {
  const { fontSizes: DF, textColors: DC, boxes: DEFAULT_BOXES } = defaults

  const base = {
    headline: headlineInitial ?? '',
    subhead:  subheadInitial  ?? '',
    bullets:  [...(bulletPoints || [])],
    cta:      ctaInitial      ?? '',
    boxes: {
      logo:         { ...DEFAULT_BOXES.logo },
      contentStack: { ...DEFAULT_BOXES.contentStack },
    },
    style: {
      headlineFs:    DF.headline,
      headlineAlign: 'right',
      headlineColor: DC.headline,
      subheadFs:     DF.subhead,
      subheadAlign:  'right',
      subheadColor:  DC.subhead,
      bulletsFs:     DF.bullets,
      bulletsAlign:  'right',
      bulletsColor:  DC.bullets,
      ctaFs:         DF.cta,
      ctaAlign:      'center',
      ctaColor:      contrastingTextColor(normalizeBrandHex(brandColor)),
    },
  }

  return savedCanvasSlice && typeof savedCanvasSlice === 'object'
    ? mergePersistSliceIntoState(base, savedCanvasSlice)
    : base
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Shared editable-banner state manager.
 *
 * Replaces 19 individual `useState` hooks with a single `useReducer` for text,
 * boxes, and typography — enabling atomic resets (1 render instead of 20+).
 *
 * Persist scheduling uses `useDebouncedCallback` which:
 *   - always reads the latest state via a synchronised ref (no stale closures)
 *   - flushes on unmount automatically
 *   - passes an `AbortSignal` to `onPersist` so callers can cancel in-flight
 *     PATCH requests when newer edits supersede them (race-condition safety)
 *
 * @param {object} options
 * @param {string} [options.taskId]
 * @param {string} [options.brandColor]
 * @param {string} [options.headlineInitial]
 * @param {string} [options.subheadInitial]
 * @param {string[]} [options.bulletPoints]
 * @param {string} [options.ctaInitial]
 * @param {object | null} [options.savedCanvasSlice]
 * @param {(payload: object, signal?: AbortSignal) => void} [options.onPersist]
 * @param {string} options.persistDesignKey
 * @param {object} options.defaults
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
  // ── Reducer ───────────────────────────────────────────────────────────────
  const [state, dispatch] = useReducer(
    bannerReducer,
    undefined,
    () => buildInitialState({ headlineInitial, subheadInitial, bulletPoints, ctaInitial, defaults, brandColor, savedCanvasSlice }),
  )

  // ── Transient UI state (not persisted) ────────────────────────────────────
  const [draggingKey, setDraggingKey] = useState(null)

  // ── Always-fresh refs (synchronised inline, no useEffect lag) ────────────
  // Reading props via refs in the persist callback avoids closure staleness
  // and eliminates the need to list them as useCallback dependencies.
  const stateRef            = useRef(state)
  stateRef.current          = state

  const onPersistRef        = useRef(onPersist)
  onPersistRef.current      = onPersist

  const taskIdRef           = useRef(taskId)
  taskIdRef.current         = taskId

  const persistDesignKeyRef = useRef(persistDesignKey)
  persistDesignKeyRef.current = persistDesignKey

  const brandColorRef       = useRef(brandColor)
  brandColorRef.current     = brandColor

  // AbortController for the in-flight PATCH request.
  // Replaced on every flush so stale responses are automatically discarded.
  const abortControllerRef  = useRef(null)

  // ── Persist callback (stable — reads everything via refs) ────────────────
  const persistCallback = useCallback(() => {
    if (!onPersistRef.current || !taskIdRef.current) return

    // Cancel the previous in-flight PATCH before issuing a new one.
    if (abortControllerRef.current) abortControllerRef.current.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    const s = stateRef.current
    onPersistRef.current(
      {
        headline:      s.headline,
        subhead:       s.subhead,
        cta:           s.cta,
        bullet_points: s.bullets,
        canvas_state: {
          v: 1,
          [persistDesignKeyRef.current]: buildPersistSliceFromState(s, brandColorRef.current),
        },
      },
      controller.signal,
    )
  }, []) // stable — all reads go through refs

  // ── Debounced persist (1 s quiet window) ─────────────────────────────────
  const { schedule: schedulePersist } = useDebouncedCallback(persistCallback, 1000)

  // ── Combined dispatch + debounce schedule ─────────────────────────────────
  // Preferred API in BannerWorkspaceContainer — replaces the (setter + schedulePersist) pairs.
  const dispatchAndPersist = useCallback(
    (action) => {
      dispatch(action)
      schedulePersist()
    },
    [schedulePersist],
  )

  // ── Reset state when the task or its server data changes ──────────────────
  // Using derived string keys (`bulletsKey`, `savedSliceKey`) rather than the
  // raw arrays/objects prevents spurious resets when the parent re-renders
  // with a new array reference but identical content.
  const bulletsKey    = bulletPoints    ? JSON.stringify(bulletPoints)    : ''
  const savedSliceKey = useMemo(
    () => (savedCanvasSlice && typeof savedCanvasSlice === 'object' ? JSON.stringify(savedCanvasSlice) : ''),
    [savedCanvasSlice],
  )

  useEffect(() => {
    dispatch({
      type: ACTIONS.RESET,
      state: buildInitialState({
        headlineInitial,
        subheadInitial,
        bulletPoints,
        ctaInitial,
        defaults,
        brandColor,
        savedCanvasSlice,
      }),
    })
    setDraggingKey(null)
  }, [
    taskId,
    bulletsKey,
    savedSliceKey,
    headlineInitial,
    subheadInitial,
    ctaInitial,
    brandColor,
    persistDesignKey, // changes with aspect-ratio switch (e.g. 'design2' → 'design2_vertical')
    defaults,         // new box defaults when aspect-ratio changes
    // bulletPoints / savedCanvasSlice are intentionally excluded — their
    // serialised keys above are the actual change detectors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ])

  // ── Stable box setters ────────────────────────────────────────────────────
  // BannerLayer / canvasUtils call setBox with a functional-updater:
  //   setLogoBox((prev) => ({ ...prev, x: newX, y: newY }))
  // These wrappers resolve the updater synchronously via stateRef so the
  // dispatch can carry a plain value (reducers must not hold functions).
  const makeBoxSetter = useCallback(
    (layer) => (updaterOrValue) =>
      dispatch({
        type: ACTIONS.UPDATE_BOX,
        layer,
        box: typeof updaterOrValue === 'function'
          ? updaterOrValue(stateRef.current.boxes[layer])
          : updaterOrValue,
      }),
    [],
  )

  // Memoised once — stable references for the lifetime of the hook instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setLogoBox          = useMemo(() => makeBoxSetter('logo'),         [makeBoxSetter])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setContentStackBox  = useMemo(() => makeBoxSetter('contentStack'), [makeBoxSetter])

  // ── setBulletAt convenience ───────────────────────────────────────────────
  const setBulletAt = useCallback(
    (index, value) => dispatchAndPersist({ type: ACTIONS.SET_BULLET_AT, index, value }),
    [dispatchAndPersist],
  )

  // ── Return ────────────────────────────────────────────────────────────────
  return {
    // ── Text reads
    headline: state.headline,
    subhead:  state.subhead,
    bullets:  state.bullets,
    cta:      state.cta,

    // ── Box reads
    logoBox:         state.boxes.logo,
    contentStackBox: state.boxes.contentStack,

    // ── Style reads
    headlineFs:    state.style.headlineFs,
    headlineAlign: state.style.headlineAlign,
    headlineColor: state.style.headlineColor,
    subheadFs:     state.style.subheadFs,
    subheadAlign:  state.style.subheadAlign,
    subheadColor:  state.style.subheadColor,
    bulletsFs:     state.style.bulletsFs,
    bulletsAlign:  state.style.bulletsAlign,
    bulletsColor:  state.style.bulletsColor,
    ctaFs:         state.style.ctaFs,
    ctaAlign:      state.style.ctaAlign,
    ctaColor:      state.style.ctaColor,

    // ── Transient
    draggingKey,
    setDraggingKey,

    // ── Action dispatch
    dispatch,

    /**
     * Dispatch an action AND schedule a debounced persist in one call.
     * Use this instead of the legacy `setter(v); schedulePersist()` pattern.
     */
    dispatchAndPersist,

    // ── Stable box setters (support functional-updater form)
    setLogoBox,
    setContentStackBox,

    // ── Persist
    schedulePersist,

    // ── Bullet convenience
    setBulletAt,
  }
}
