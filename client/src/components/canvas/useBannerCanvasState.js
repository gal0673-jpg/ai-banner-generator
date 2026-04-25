import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  BANNER_VERTICAL_9_16,
  bannerCanvasStatesEqual,
  buildPersistSliceFromState,
  cloneBannerCanvasState,
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

/** Max snapshots kept in `past` (memory bound). */
const MAX_UNDO_STACK = 80

/**
 * @type {{
 *   UPDATE_TEXT: string,
 *   SET_BULLET_AT: string,
 *   UPDATE_BOX: string,
 *   UPDATE_STYLE: string,
 *   RESET: string,
 *   UNDO: string,
 *   REDO: string,
 *   COMMIT_BOX_HISTORY_BURST: string,
 * }}
 */
export const ACTIONS = Object.freeze({
  UPDATE_TEXT:   'UPDATE_TEXT',
  SET_BULLET_AT: 'SET_BULLET_AT',
  UPDATE_BOX:    'UPDATE_BOX',
  UPDATE_STYLE:  'UPDATE_STYLE',
  RESET:         'RESET',
  UNDO:          'UNDO',
  REDO:          'REDO',
  /** @internal — hook only: commit a debounced box-move burst into `past` */
  COMMIT_BOX_HISTORY_BURST: 'COMMIT_BOX_HISTORY_BURST',
})

/**
 * @typedef {object} BannerCanvasState
 * @property {string} headline
 * @property {string} subhead
 * @property {string[]} bullets
 * @property {string} cta
 * @property {{ logo: object, contentStack: object }} boxes
 * @property {Record<string, unknown>} style
 */

/**
 * @typedef {{ past: BannerCanvasState[], present: BannerCanvasState, future: BannerCanvasState[] }} BannerCanvasHistory
 */

function capPast(past) {
  if (past.length <= MAX_UNDO_STACK) return past
  return past.slice(past.length - MAX_UNDO_STACK)
}

// ─── Reducer (present slice only) ─────────────────────────────────────────────

/**
 * Pure reducer for banner canvas **present** state (no undo stack).
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

// ─── History wrapper reducer ──────────────────────────────────────────────────

/**
 * Undo/redo history around {@link bannerReducer}.
 *
 * @param {BannerCanvasHistory} history
 * @param {{ type: string, [k: string]: any }} action
 * @returns {BannerCanvasHistory}
 */
export function bannerHistoryReducer(history, action) {
  const { past, present, future } = history

  switch (action.type) {
    case ACTIONS.UNDO: {
      if (!past.length) return history
      const previous = past[past.length - 1]
      return {
        past: past.slice(0, -1),
        present: previous,
        future: [cloneBannerCanvasState(present), ...future],
      }
    }
    case ACTIONS.REDO: {
      if (!future.length) return history
      const [next, ...restFuture] = future
      return {
        past: capPast([...past, cloneBannerCanvasState(present)]),
        present: next,
        future: restFuture,
      }
    }
    case ACTIONS.RESET:
      return {
        past: [],
        present: action.state,
        future: [],
      }

    case ACTIONS.COMMIT_BOX_HISTORY_BURST: {
      const snap = action.snapshot
      if (!snap) return history
      if (bannerCanvasStatesEqual(snap, present)) {
        return { ...history, future: [] }
      }
      return {
        past: capPast([...past, cloneBannerCanvasState(snap)]),
        present,
        future: [],
      }
    }

    case ACTIONS.UPDATE_BOX:
      if (action.skipPast) {
        return {
          past,
          present: bannerReducer(present, action),
          future: [],
        }
      }
      return {
        past: capPast([...past, cloneBannerCanvasState(present)]),
        present: bannerReducer(present, action),
        future: [],
      }

    default: {
      const nextPresent = bannerReducer(present, action)
      if (nextPresent === present) return history
      return {
        past: capPast([...past, cloneBannerCanvasState(present)]),
        present: nextPresent,
        future: [],
      }
    }
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

/** Quiet period after the last `UPDATE_BOX` before a burst is committed to `past`. */
const BOX_HISTORY_DEBOUNCE_MS = 400

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
  const [historyState, dispatch] = useReducer(
    bannerHistoryReducer,
    undefined,
    () => ({
      past: [],
      present: buildInitialState({
        headlineInitial,
        subheadInitial,
        bulletPoints,
        ctaInitial,
        defaults,
        brandColor,
        savedCanvasSlice,
      }),
      future: [],
    }),
  )

  const [draggingKey, setDraggingKey] = useState(null)

  const historyRef = useRef(historyState)
  historyRef.current = historyState

  const stateRef = useRef(historyState.present)
  stateRef.current = historyState.present

  const onPersistRef        = useRef(onPersist)
  onPersistRef.current      = onPersist

  const taskIdRef           = useRef(taskId)
  taskIdRef.current         = taskId

  const persistDesignKeyRef = useRef(persistDesignKey)
  persistDesignKeyRef.current = persistDesignKey

  const brandColorRef       = useRef(brandColor)
  brandColorRef.current     = brandColor

  const abortControllerRef  = useRef(null)

  /** Snapshot of `present` at the start of a rapid `UPDATE_BOX` burst (debounced into one undo step). */
  const pendingBoxBurstSnapshotRef = useRef(null)

  const persistCallback = useCallback(() => {
    if (!onPersistRef.current || !taskIdRef.current) return

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
  }, [])

  const { schedule: schedulePersist } = useDebouncedCallback(persistCallback, 1000)

  const flushPendingBoxBurstToPast = useCallback(() => {
    const snap = pendingBoxBurstSnapshotRef.current
    if (snap === null) return
    pendingBoxBurstSnapshotRef.current = null
    dispatch({ type: ACTIONS.COMMIT_BOX_HISTORY_BURST, snapshot: snap })
  }, [dispatch])

  const {
    schedule: scheduleBoxHistoryCommit,
    flush: flushBoxHistoryDebounce,
    cancel: cancelBoxHistoryCommit,
  } = useDebouncedCallback(flushPendingBoxBurstToPast, BOX_HISTORY_DEBOUNCE_MS)

  const dispatchAndPersist = useCallback(
    (action) => {
      flushBoxHistoryDebounce()
      dispatch(action)
      schedulePersist()
    },
    [dispatch, flushBoxHistoryDebounce, schedulePersist],
  )

  const undo = useCallback(() => {
    flushBoxHistoryDebounce()
    dispatch({ type: ACTIONS.UNDO })
  }, [dispatch, flushBoxHistoryDebounce])

  const redo = useCallback(() => {
    flushBoxHistoryDebounce()
    dispatch({ type: ACTIONS.REDO })
  }, [dispatch, flushBoxHistoryDebounce])

  const bulletsKey    = bulletPoints    ? JSON.stringify(bulletPoints)    : ''
  const savedSliceKey = useMemo(
    () => (savedCanvasSlice && typeof savedCanvasSlice === 'object' ? JSON.stringify(savedCanvasSlice) : ''),
    [savedCanvasSlice],
  )

  useEffect(() => {
    cancelBoxHistoryCommit()
    pendingBoxBurstSnapshotRef.current = null
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
    persistDesignKey,
    defaults,
    cancelBoxHistoryCommit,
    dispatch,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ])

  const makeBoxSetter = useCallback(
    (layer) => (updaterOrValue) => {
      const present = historyRef.current.present
      if (pendingBoxBurstSnapshotRef.current === null) {
        pendingBoxBurstSnapshotRef.current = cloneBannerCanvasState(present)
      }
      const box =
        typeof updaterOrValue === 'function'
          ? updaterOrValue(present.boxes[layer])
          : updaterOrValue
      dispatch({
        type: ACTIONS.UPDATE_BOX,
        layer,
        box,
        skipPast: true,
      })
      scheduleBoxHistoryCommit()
    },
    [dispatch, scheduleBoxHistoryCommit],
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setLogoBox          = useMemo(() => makeBoxSetter('logo'),         [makeBoxSetter])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setContentStackBox  = useMemo(() => makeBoxSetter('contentStack'), [makeBoxSetter])

  const setBulletAt = useCallback(
    (index, value) => dispatchAndPersist({ type: ACTIONS.SET_BULLET_AT, index, value }),
    [dispatchAndPersist],
  )

  const state = historyState.present

  return {
    headline: state.headline,
    subhead:  state.subhead,
    bullets:  state.bullets,
    cta:      state.cta,

    logoBox:         state.boxes.logo,
    contentStackBox: state.boxes.contentStack,

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

    draggingKey,
    setDraggingKey,

    dispatch,

    dispatchAndPersist,

    setLogoBox,
    setContentStackBox,

    schedulePersist,

    /** Flush debounced box history immediately (call on drag/resize end before persist). */
    flushBoxGestureHistory: flushBoxHistoryDebounce,

    setBulletAt,

    undo,
    redo,

    /** Whether undo is available (for UI affordances). */
    canUndo: historyState.past.length > 0,
    /** Whether redo is available. */
    canRedo: historyState.future.length > 0,
  }
}
