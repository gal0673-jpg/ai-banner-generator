export const UGC_STATUS_PROGRESS = {
  pending: 5,
  scraped: 10,
  generating_script: 15,
  generating_video: 50,
  processing_video: 75,
  rendering_captions: 95,
  completed: 100,
}

/** Total job estimate (minutes) by target video length — used for ETA copy only. */
export const VIDEO_LENGTH_TOTAL_MINUTES = {
  '15s': 3,
  '30s': 5,
  '50s': 8,
}

export const UGC_RERENDER_SPEEDS = [
  { value: 1, label: '1.0× (רגיל)' },
  { value: 1.15, label: '1.15×' },
  { value: 1.25, label: '1.25×' },
]

export const UGC_RERENDER_ANIMATIONS = [
  { value: 'pop', label: 'פופ טיקטוק' },
  { value: 'fade', label: 'כניסה חלקה' },
  { value: 'typewriter', label: 'מכונת כתיבה' },
]

export const UGC_RERENDER_POSITIONS = [
  { value: 'bottom', label: 'תחתון' },
  { value: 'center', label: 'מרכז' },
  { value: 'top', label: 'עליון' },
]

export const UGC_RERENDER_FONTS = [
  { value: 'heebo', label: 'Heebo' },
  { value: 'rubik', label: 'Rubik' },
  { value: 'assistant', label: 'Assistant' },
]

export const ALLOWED_RERENDER_ANIM = new Set(['pop', 'fade', 'typewriter'])
export const ALLOWED_RERENDER_POS = new Set(['bottom', 'center', 'top'])
export const ALLOWED_RERENDER_FONT = new Set(['heebo', 'rubik', 'assistant'])

/** Must match api.SUPERUSER_EMAIL (primary admin only). */
export const PRIMARY_ADMIN_EMAIL = 'gal0673@gmail.com'

export const TONE_TAGS = ['[אנרגטי]', '[דרמטי]', '[אמפתי]', '[דחוף]', '[מקצועי]']

export const VIDEO_LAYOUTS = [
  { id: 'classic', label: 'קלאסי (בולטים)', requiredImages: 0 },
  { id: 'split_gallery', label: 'גלריית תמונות (חצוי)', requiredImages: 3 },
]

/** Max `requiredImages` across layouts — bounds dynamic upload UI and state arrays. */
export const MAX_LAYOUT_REQUIRED_IMAGES = VIDEO_LAYOUTS.reduce(
  (m, layout) => Math.max(m, typeof layout.requiredImages === 'number' ? layout.requiredImages : 0),
  0,
)

export function requiredImagesForLayout(layoutId) {
  const layout = VIDEO_LAYOUTS.find((l) => l.id === layoutId)
  return typeof layout?.requiredImages === 'number' ? layout.requiredImages : 0
}

/**
 * Layout ids that depend on AI / structured scenes — not offered when the user
 * chooses "spoken_only". Add future AI-only layouts here.
 */
export const VIDEO_LAYOUT_IDS_EXCLUDED_WHEN_SPOKEN_ONLY = new Set(['split_gallery'])

/** Default layout when the current selection is invalid for the script source. */
export const VIDEO_LAYOUT_FALLBACK_ID = 'classic'

/**
 * Layout options to show for a given script source (single place for UI + validation).
 */
export function videoLayoutsVisibleForScriptSource(scriptSource) {
  if (scriptSource === 'spoken_only') {
    return VIDEO_LAYOUTS.filter((l) => !VIDEO_LAYOUT_IDS_EXCLUDED_WHEN_SPOKEN_ONLY.has(l.id))
  }
  return VIDEO_LAYOUTS
}
