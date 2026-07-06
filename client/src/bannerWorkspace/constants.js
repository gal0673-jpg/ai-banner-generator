/**
 * Constants for BannerWorkspace and its sub-components.
 * Extracted so the main file stays focused on composition.
 */

export const VIDEO_RENDERING_HINT =
  'הווידאו מיוצר ברקע — אפשר להמשיך לערוך את הבאנר. · Video is rendering in the background; you can keep editing.'

/** After "נתק מהמשימה", do not auto-load /banners/latest on refresh (stuck pending would return forever). */
export const SKIP_LATEST_RESTORE_KEY = 'banner_workspace_skip_latest_restore'

/** D-ID sample portrait; stable for tests (see test_ugc.py). */
export const UGC_DEFAULT_AVATAR_URL =
  'https://d-id-public-bucket.s3.us-west-2.amazonaws.com/alice.jpg'

/** Default ElevenLabs voice used server-side when voice_id is omitted (services/ugc_service.py). */
export const UGC_DEFAULT_VOICE_ID_HINT = 'Wuv1s5YTNCjL9mFJTqo4'
