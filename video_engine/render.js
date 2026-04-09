import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPOSITION_ID = "Banner";

const OUTPUT_DIR = path.join(__dirname, "output");

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

/** Resolve relative asset paths (e.g. /task-files/...) when VIDEO_ENGINE_ASSET_BASE_URL is set. */
export function resolveAssetUrl(url) {
  if (!url || typeof url !== "string") return url;
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = process.env.VIDEO_ENGINE_ASSET_BASE_URL?.trim();
  if (!base) return trimmed;
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
  const designTemplate = normalizeDesignTemplate(
    body.designTemplate ?? body.design_type ?? body.designType,
  );
  const videoLayout = normalizeVideoLayout(body);
  return {
    headline: String(body.headline ?? "").trim(),
    background_url: resolveAssetUrl(body.background_url),
    subhead: typeof body.subhead === "string" ? body.subhead : "",
    cta: typeof body.cta === "string" ? body.cta : "",
    logo_url:
      typeof body.logo_url === "string" && body.logo_url.trim()
        ? resolveAssetUrl(body.logo_url)
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
