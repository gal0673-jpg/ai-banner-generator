import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildBannerInputProps, renderBannerVideo } from "./render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 9000;
const PUBLIC_BASE_URL =
  process.env.VIDEO_ENGINE_PUBLIC_URL?.replace(/\/$/, "") ||
  `http://127.0.0.1:${PORT}`;

const app = express();

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const outputDir = path.join(__dirname, "output");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
app.use("/output", express.static(outputDir));

function normalizeDesignType(body) {
  const raw = body?.design_type ?? body?.designType;
  if (raw === undefined || raw === null) return 1;
  const n = Number(raw);
  if (n === 2) return 2;
  return 1;
}

/**
 * Expected payload shape from the Python FastAPI banner pipeline (subset).
 */
function validateRenderPayload(body) {
  const errors = [];

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["Body must be a JSON object"] };
  }

  const headline = body.headline;
  if (headline === undefined || headline === null) {
    errors.push("Missing required field: headline");
  } else if (typeof headline !== "string") {
    errors.push("headline must be a string");
  } else if (headline.trim().length === 0) {
    errors.push("headline must not be empty");
  } else if (headline.length > 512) {
    errors.push("headline exceeds max length 512");
  }

  const backgroundUrl = body.background_url;
  if (backgroundUrl === undefined || backgroundUrl === null) {
    errors.push("Missing required field: background_url");
  } else if (typeof backgroundUrl !== "string") {
    errors.push("background_url must be a string");
  } else if (backgroundUrl.trim().length === 0) {
    errors.push("background_url must not be empty");
  }

  if (body.subhead !== undefined && body.subhead !== null && typeof body.subhead !== "string") {
    errors.push("subhead must be a string when provided");
  }
  if (body.cta !== undefined && body.cta !== null && typeof body.cta !== "string") {
    errors.push("cta must be a string when provided");
  }
  if (body.logo_url !== undefined && body.logo_url !== null && typeof body.logo_url !== "string") {
    errors.push("logo_url must be a string when provided");
  }
  if (body.brand_color !== undefined && body.brand_color !== null && typeof body.brand_color !== "string") {
    errors.push("brand_color must be a string when provided");
  }
  if (body.bullet_points !== undefined && body.bullet_points !== null) {
    if (!Array.isArray(body.bullet_points)) {
      errors.push("bullet_points must be an array when provided");
    } else if (!body.bullet_points.every((b) => typeof b === "string")) {
      errors.push("bullet_points must contain only strings");
    }
  }

  const dt = body.design_type ?? body.designType ?? body.designTemplate;
  if (dt !== undefined && dt !== null && Number(dt) !== 1 && Number(dt) !== 2) {
    errors.push("design_type / designTemplate must be 1 or 2 when provided");
  }
  const vl = body.video_layout ?? body.videoLayout;
  if (
    vl !== undefined &&
    vl !== null &&
    vl !== "split" &&
    vl !== "immersive"
  ) {
    errors.push("video_layout must be 'split' or 'immersive' when provided");
  }
  if (
    body.task_id !== undefined &&
    body.task_id !== null &&
    (typeof body.task_id !== "string" || !body.task_id.trim())
  ) {
    errors.push("task_id must be a non-empty string when provided");
  }

  return { ok: errors.length === 0, errors };
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "video_engine" });
});

app.post("/render", async (req, res) => {
  console.log("[/render] incoming body:", JSON.stringify(req.body));

  const { ok, errors } = validateRenderPayload(req.body);
  if (!ok) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors,
    });
  }

  const designType = normalizeDesignType(req.body);

  try {
    const inputProps = buildBannerInputProps(req.body);
    console.log("[/render] starting Remotion bundle + renderMedia…", {
      designType,
      video_layout: inputProps.video_layout,
      composition: designType === 2 ? "Design2" : "Design1",
    });

    const { fileName, outputPath, videoUrl, designTemplate } = await renderBannerVideo(
      inputProps,
      { publicBaseUrl: PUBLIC_BASE_URL },
    );

    if (!videoUrl) {
      const msg = "Render completed but videoUrl was empty";
      console.error("[/render]", msg, { fileName, outputPath });
      return res.status(500).json({ error: msg });
    }

    console.log("Video rendered successfully", {
      videoUrl,
      fileName,
      outputPath,
      designType,
      designTemplate: designTemplate ?? inputProps.designTemplate,
    });
    return res.status(200).json({
      success: true,
      videoUrl,
      designType,
      designTemplate: designTemplate ?? inputProps.designTemplate,
      fileName,
      outputPath,
    });
  } catch (err) {
    console.error("[/render] Remotion render failed:", err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    const description = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: description });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`video_engine listening on http://0.0.0.0:${PORT}`);
  console.log(`Public video base: ${PUBLIC_BASE_URL} (set VIDEO_ENGINE_PUBLIC_URL to override)`);
});
