import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPOSITION_ID = "Banner";
const OUTPUT_DIR = path.join(__dirname, "output");

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
  return {
    headline: String(body.headline).trim(),
    background_url: resolveAssetUrl(body.background_url),
    subhead: typeof body.subhead === "string" ? body.subhead : "",
    cta: typeof body.cta === "string" ? body.cta : "",
    logo_url: typeof body.logo_url === "string" && body.logo_url.trim()
      ? resolveAssetUrl(body.logo_url)
      : "",
    brand_color:
      typeof body.brand_color === "string" && body.brand_color.trim()
        ? body.brand_color.trim()
        : "#2563eb",
    bullet_points: Array.isArray(body.bullet_points) ? body.bullet_points : [],
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
 * Bundles Remotion (cached), renders Banner composition to MP4.
 * @param {Record<string, unknown>} inputProps — serialized banner props
 * @param {{ publicBaseUrl?: string }} options
 */
export async function renderBannerVideo(inputProps, options = {}) {
  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });

  const serveUrl = await getBundleServeUrl();

  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
    logLevel: "warn",
  });

  const fileName = `render-${randomUUID()}.mp4`;
  const outputLocation = path.join(OUTPUT_DIR, fileName);

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps,
    logLevel: "warn",
    overwrite: true,
  });

  const publicBase =
    options.publicBaseUrl?.replace(/\/$/, "") ||
    process.env.VIDEO_ENGINE_PUBLIC_URL?.replace(/\/$/, "") ||
    "";

  return {
    fileName,
    outputPath: outputLocation,
    videoUrl: publicBase ? `${publicBase}/output/${fileName}` : `/output/${fileName}`,
  };
}
