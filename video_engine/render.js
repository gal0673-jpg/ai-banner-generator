import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

import {
  normalizeUgcAspectRatio,
  ugcCompositionDimensionsForRenderMedia,
} from "./ugcAspectRatio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPOSITION_ID = "Banner";
const UGC_COMPOSITION_ID = "Ugc";

const OUTPUT_DIR = path.join(__dirname, "output");

/**
 * When `REMOTION_CONCURRENCY` is unset or empty, returns `undefined` so Remotion
 * picks its default (parallelism across CPU cores). When set, parses a positive
 * integer; invalid values fall back to `undefined`.
 * @returns {number | undefined}
 */
function getRemotionConcurrencyFromEnv() {
  const raw = process.env.REMOTION_CONCURRENCY;
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}

/** @returns {boolean} */
function isRemotionSwiftShaderDisabledFromEnv() {
  const raw = process.env.REMOTION_DISABLE_SWIFTSHADER;
  if (raw === undefined || raw === null) return false;
  const t = String(raw).trim();
  if (t === "") return false;
  return t === "1" || t.toLowerCase() === "true";
}

function normalizeDesignTemplate(v) {
  if (v === undefined || v === null) return 1;
  const n = Number(v);
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 1;
}

function normalizeVideoLayout(body) {
  const raw = body?.video_layout ?? body?.videoLayout;
  if (raw === "immersive") return "immersive";
  if (raw === "minimal")   return "minimal";
  if (raw === "split")     return "split";
  const dt = normalizeDesignTemplate(
    body?.designTemplate ?? body?.design_type ?? body?.designType,
  );
  if (dt === 2) return "immersive";
  if (dt === 3) return "minimal";
  return "split";
}

/** Default origin for `/task-files/...` when Remotion fetches from Node (must match FastAPI, not the Vite dev port). */
const DEFAULT_API_ASSET_BASE = "http://127.0.0.1:8888";

/**
 * Resolve relative asset paths (e.g. /task-files/...) for Remotion headless render.
 * @param {string} url
 * @param {string} [baseFromApi] - Sent by the Python worker (`asset_base_url`); wins over `VIDEO_ENGINE_ASSET_BASE_URL`
 */
export function resolveAssetUrl(url, baseFromApi) {
  if (!url || typeof url !== "string") return url;
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base =
    (typeof baseFromApi === "string" && baseFromApi.trim()) ||
    process.env.VIDEO_ENGINE_ASSET_BASE_URL?.trim() ||
    DEFAULT_API_ASSET_BASE;
  try {
    return new URL(trimmed.startsWith("/") ? trimmed : `/${trimmed}`, base).href;
  } catch {
    return trimmed;
  }
}

export function buildBannerInputProps(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }
  const assetBase =
    typeof body.asset_base_url === "string" && body.asset_base_url.trim()
      ? body.asset_base_url.trim()
      : undefined;
  const designTemplate = normalizeDesignTemplate(
    body.designTemplate ?? body.design_type ?? body.designType,
  );
  const videoLayout = normalizeVideoLayout(body);
  return {
    headline: String(body.headline ?? "").trim(),
    background_url: resolveAssetUrl(body.background_url, assetBase),
    subhead: typeof body.subhead === "string" ? body.subhead : "",
    cta: typeof body.cta === "string" ? body.cta : "",
    logo_url:
      typeof body.logo_url === "string" && body.logo_url.trim()
        ? resolveAssetUrl(body.logo_url, assetBase)
        : "",
    brand_color:
      typeof body.brand_color === "string" && body.brand_color.trim()
        ? body.brand_color.trim()
        : "#2563eb",
    bullet_points: Array.isArray(body.bullet_points) ? body.bullet_points : [],
    designTemplate,
    video_layout: videoLayout,
    videoLayout,
    isVertical: body.isVertical === true || body.is_vertical === true,
    video_hook:
      typeof body.video_hook === "string" ? body.video_hook.trim() : "",
    task_id:
      typeof body.task_id === "string" && body.task_id.trim()
        ? body.task_id.trim()
        : "",
  };
}

let bundleServeUrlPromise = null;

function getBundleServeUrl() {
  if (!bundleServeUrlPromise) {
    const entryPoint = path.join(__dirname, "Root.jsx");
    bundleServeUrlPromise = bundle({ entryPoint });
  }
  return bundleServeUrlPromise;
}

// ── UGC helpers ─────────────────────────────────────────────────────────────

/**
 * Resolves /task-files/... paths under `layout_data.image_urls` for Remotion server render.
 * @param {Record<string, unknown> | null} ugcScript
 * @param {string} [baseFromApi]
 */
function resolveUgcScriptImageUrls(ugcScript, baseFromApi) {
  if (!ugcScript || typeof ugcScript !== "object" || Array.isArray(ugcScript)) {
    return ugcScript;
  }
  const scenes = Array.isArray(ugcScript.scenes) ? ugcScript.scenes : [];
  const newScenes = scenes.map((scene) => {
    if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
      return scene;
    }
    const layoutData = scene.layout_data;
    if (
      !layoutData ||
      typeof layoutData !== "object" ||
      Array.isArray(layoutData) ||
      !Array.isArray(layoutData.image_urls)
    ) {
      return scene;
    }
    return {
      ...scene,
      layout_data: {
        ...layoutData,
        image_urls: layoutData.image_urls.map((u) =>
          typeof u === "string" && u.trim() ? resolveAssetUrl(u.trim(), baseFromApi) : u,
        ),
      },
    };
  });
  return { ...ugcScript, scenes: newScenes };
}

export function buildUgcInputProps(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }
  const assetBase =
    typeof body.asset_base_url === "string" && body.asset_base_url.trim()
      ? body.asset_base_url.trim()
      : undefined;
  const script =
    body.ugc_script && typeof body.ugc_script === "object" && !Array.isArray(body.ugc_script)
      ? resolveUgcScriptImageUrls(body.ugc_script, assetBase)
      : null;
  return {
    raw_video_url:
      typeof body.raw_video_url === "string" && body.raw_video_url.trim()
        ? resolveAssetUrl(body.raw_video_url.trim(), assetBase)
        : "",
    ugc_script: script,
    bgm_url:
      typeof body.bgm_url === "string" && body.bgm_url.trim()
        ? resolveAssetUrl(body.bgm_url.trim(), assetBase)
        : "",
    task_id:
      typeof body.task_id === "string" && body.task_id.trim()
        ? body.task_id.trim()
        : "",
    website_display:
      typeof body.website_display === "string" && body.website_display.trim()
        ? body.website_display.trim().slice(0, 512)
        : "",
    logo_url:
      typeof body.logo_url === "string" && body.logo_url.trim()
        ? resolveAssetUrl(body.logo_url.trim(), assetBase)
        : "",
    product_image_url:
      typeof body.product_image_url === "string" && body.product_image_url.trim()
        ? resolveAssetUrl(body.product_image_url, assetBase)
        : "",
    aspect_ratio: normalizeUgcAspectRatio(body?.aspect_ratio),
  };
}

/**
 * @param {Record<string, unknown>} inputProps — includes designTemplate (1 | 2 | 3)
 * @param {{ publicBaseUrl?: string }} options
 */
export async function renderBannerVideo(inputProps, options = {}) {
  const taskId =
    typeof inputProps.task_id === "string" && inputProps.task_id.trim()
      ? inputProps.task_id.trim()
      : "";

  // Use a per-task sub-directory when a task_id is present; fall back to the
  // flat OUTPUT_DIR for ad-hoc / direct renders without a task_id.
  const taskDir = taskId ? path.join(OUTPUT_DIR, taskId) : OUTPUT_DIR;
  await fs.promises.mkdir(taskDir, { recursive: true });

  const serveUrl = await getBundleServeUrl();

  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
    logLevel: "warn",
  });

  const fileName = `render-${randomUUID()}.mp4`;
  const outputLocation = path.join(taskDir, fileName);

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps,
    logLevel: "warn",
    overwrite: true,
    ...(inputProps.isVertical === true
      ? { compositionWidth: 1080, compositionHeight: 1920 }
      : {}),
  });

  const publicBase =
    options.publicBaseUrl?.replace(/\/$/, "") ||
    process.env.VIDEO_ENGINE_PUBLIC_URL?.replace(/\/$/, "") ||
    "";

  const relPath = taskId ? `output/${taskId}/${fileName}` : `output/${fileName}`;

  return {
    fileName,
    outputPath: outputLocation,
    videoUrl: publicBase ? `${publicBase}/${relPath}` : `/${relPath}`,
    compositionId: COMPOSITION_ID,
    designTemplate: inputProps.designTemplate,
  };
}

/**
 * Render a UGC composition (avatar video + Hebrew caption overlays).
 *
 * @param {Record<string, unknown>} inputProps — { raw_video_url, ugc_script, bgm_url, task_id }
 * @param {{ publicBaseUrl?: string }} options
 */
export async function renderUgcVideo(inputProps, options = {}) {
  const taskId =
    typeof inputProps.task_id === "string" && inputProps.task_id.trim()
      ? inputProps.task_id.trim()
      : "";

  const taskDir = taskId ? path.join(OUTPUT_DIR, taskId) : OUTPUT_DIR;
  await fs.promises.mkdir(taskDir, { recursive: true });

  const serveUrl = await getBundleServeUrl();

  // ── Bundled BGM (public/bgm.mp3) ───────────────────────────────────────────
  // bundle() returns a *filesystem* path to the webpack output, not http://…
  // Concatenating "/bgm.mp3" produced C:\...\remotion-webpack-bundle-…\bgm.mp3
  // which Chromium cannot decode (MediaError).  The composition must use
  // staticFile("bgm.mp3") instead; we only flip bundled_bgm after fs check.
  const hasCustomBgm =
    typeof inputProps.bgm_url === "string" && inputProps.bgm_url.trim();
  let bundledBgm = false;
  if (!hasCustomBgm) {
    const bgmPublicPath = path.join(__dirname, "public", "bgm.mp3");
    bundledBgm = await fs.promises
      .access(bgmPublicPath)
      .then(() => true)
      .catch(() => false);
    if (bundledBgm) {
      console.log(
        "[renderUgcVideo] BGM: public/bgm.mp3 present — composition will use staticFile('bgm.mp3').",
      );
    } else {
      console.log("[renderUgcVideo] No bgm.mp3 in public/ — rendering without BGM.");
    }
  }

  // ── End-card padding ──────────────────────────────────────────────────────
  // After speech ends, the OffthreadVideo freezes on its last frame.  We add
  // END_CARD_SECONDS of extra duration so the composition shows an animated
  // end-card (URL pill zooms to center, dark overlay fades in).
  // This constant MUST match END_CARD_SECONDS in UgcComposition.jsx.
  const END_CARD_SECONDS = 3;
  const speechSeconds = inputProps.ugc_script?.estimated_duration_seconds;
  const totalSeconds =
    (typeof speechSeconds === "number" && speechSeconds > 0 ? speechSeconds : 30) +
    END_CARD_SECONDS;

  console.log(
    `[renderUgcVideo] speech=${speechSeconds ?? "?"}s endCard=${END_CARD_SECONDS}s total=${totalSeconds}s`,
  );

  const resolvedInputProps = {
    ...inputProps,
    bgm_url: hasCustomBgm ? String(inputProps.bgm_url).trim() : "",
    bundled_bgm: hasCustomBgm ? false : bundledBgm,
    aspect_ratio: normalizeUgcAspectRatio(inputProps?.aspect_ratio),
    // Override duration to include end-card seconds
    ugc_script: {
      ...(inputProps.ugc_script ?? {}),
      estimated_duration_seconds: totalSeconds,
    },
  };

  const { compositionWidth, compositionHeight } = ugcCompositionDimensionsForRenderMedia(
    resolvedInputProps.aspect_ratio,
  );

  const composition = await selectComposition({
    serveUrl,
    id: UGC_COMPOSITION_ID,
    inputProps: resolvedInputProps,
    logLevel: "warn",
  });

  const fileName = `ugc-${randomUUID()}.mp4`;
  const outputLocation = path.join(taskDir, fileName);

  const concurrency = getRemotionConcurrencyFromEnv();
  const useSwiftShader = !isRemotionSwiftShaderDisabledFromEnv();

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps: resolvedInputProps,
    compositionWidth,
    compositionHeight,
    logLevel: "warn",
    overwrite: true,
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(useSwiftShader
      ? {
          // SwiftShader = pure-software WebGL — no GPU memory allocated.
          // Default for local safety; omit in production via REMOTION_DISABLE_SWIFTSHADER.
          chromiumOptions: {
            gl: "swiftshader",
          },
        }
      : {}),
  });

  const publicBase =
    options.publicBaseUrl?.replace(/\/$/, "") ||
    process.env.VIDEO_ENGINE_PUBLIC_URL?.replace(/\/$/, "") ||
    "";

  const relPath = taskId ? `output/${taskId}/${fileName}` : `output/${fileName}`;

  return {
    fileName,
    outputPath: outputLocation,
    videoUrl: publicBase ? `${publicBase}/${relPath}` : `/${relPath}`,
    compositionId: UGC_COMPOSITION_ID,
  };
}
