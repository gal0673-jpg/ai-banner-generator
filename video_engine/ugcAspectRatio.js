/**
 * Single source of truth for UGC output aspect (Python FFmpeg + Remotion must match).
 *
 * Whitelist only: "1:1" | "16:9" | "9:16". Anything else (undefined, "", typo) → "9:16".
 */

/** @param {unknown} raw */
export function normalizeUgcAspectRatio(raw) {
  if (raw == null) {
    return "9:16";
  }
  if (typeof raw !== "string") {
    return "9:16";
  }
  const s = raw.trim();
  if (s === "1:1") {
    return "1:1";
  }
  if (s === "16:9") {
    return "16:9";
  }
  if (s === "9:16") {
    return "9:16";
  }
  return "9:16";
}

/** @param {unknown} raw @returns {{ width: number, height: number }} */
export function ugcPixelDimensions(raw) {
  const a = normalizeUgcAspectRatio(raw);
  if (a === "1:1") {
    return { width: 1080, height: 1080 };
  }
  if (a === "16:9") {
    return { width: 1920, height: 1080 };
  }
  return { width: 1080, height: 1920 };
}

/** @param {unknown} raw */
export function ugcCompositionDimensionsForRenderMedia(raw) {
  const { width, height } = ugcPixelDimensions(raw);
  return { compositionWidth: width, compositionHeight: height };
}
