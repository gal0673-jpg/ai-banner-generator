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

// ── Concurrency / timeout config (overridable via env) ─────────────────────
/** Maximum Remotion renders that may run simultaneously. */
const MAX_CONCURRENT_RENDERS = Number(process.env.MAX_CONCURRENT_RENDERS) || 2;
/** Requests beyond this queue depth are rejected with 503 rather than queued. */
const MAX_QUEUE_DEPTH = Number(process.env.MAX_QUEUE_DEPTH) || 10;
/** Hard wall-clock deadline for a single renderMedia call (milliseconds). */
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS) || 3 * 60 * 1000;

// ── Output-file cleanup config ─────────────────────────────────────────────
const CLEANUP_INTERVAL_MS =
  Number(process.env.CLEANUP_INTERVAL_MS) || 60 * 60 * 1000; // 1 h
const MAX_OUTPUT_AGE_MS =
  Number(process.env.MAX_OUTPUT_AGE_MS) || 24 * 60 * 60 * 1000; // 24 h

// ── ConcurrencyLimiter ──────────────────────────────────────────────────────
/**
 * Promise-queue that caps the number of concurrently executing async tasks.
 * Callers beyond `maxConcurrent` wait in a FIFO queue until a slot opens.
 */
class ConcurrencyLimiter {
  constructor(maxConcurrent) {
    this._max = maxConcurrent;
    this._active = 0;
    this._queue = [];
  }

  get active() {
    return this._active;
  }

  get pending() {
    return this._queue.length;
  }

  /**
   * Schedule `fn` (a zero-argument async factory) to run when a slot is free.
   * Returns a Promise that resolves or rejects with fn's result.
   */
  run(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    while (this._active < this._max && this._queue.length > 0) {
      const { fn, resolve, reject } = this._queue.shift();
      this._active++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          this._active--;
          this._drain();
        });
    }
  }
}

const renderLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_RENDERS);

// ── withTimeout ─────────────────────────────────────────────────────────────
/**
 * Race `promise` against a hard deadline.
 * Frees the caller (and the concurrency slot via .finally in ConcurrencyLimiter)
 * even if the underlying work is still running in the background.
 */
function withTimeout(promise, ms, label = "Operation") {
  let timerId;
  const deadline = new Promise((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timerId));
}

// ── Output-file cleanup ─────────────────────────────────────────────────────
const outputDir = path.join(__dirname, "output");

/**
 * Recursively walk `outputDir`, delete files older than MAX_OUTPUT_AGE_MS,
 * and prune any task sub-directories that become empty afterwards.
 */
async function cleanupOldOutputs() {
  const now = Date.now();
  let deleted = 0;

  async function sweep(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // directory removed between readdir calls — ignore
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await sweep(fullPath);
        // Remove the sub-directory once it is completely empty.
        try {
          const remaining = await fs.promises.readdir(fullPath);
          if (remaining.length === 0) {
            await fs.promises.rmdir(fullPath);
            console.log(`[cleanup] removed empty dir ${path.relative(outputDir, fullPath)}`);
          }
        } catch { /* already gone */ }
      } else if (entry.isFile()) {
        try {
          const { mtimeMs } = await fs.promises.stat(fullPath);
          if (now - mtimeMs > MAX_OUTPUT_AGE_MS) {
            await fs.promises.unlink(fullPath);
            deleted++;
            console.log(`[cleanup] deleted ${path.relative(outputDir, fullPath)}`);
          }
        } catch { /* file removed between stat and unlink */ }
      }
    }
  }

  try {
    await sweep(outputDir);
    if (deleted > 0) {
      console.log(`[cleanup] complete — ${deleted} file(s) deleted`);
    }
  } catch (err) {
    console.error("[cleanup] unexpected error:", err);
  }
}

// ── Express app ────────────────────────────────────────────────────────────
const app = express();

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
app.use("/output", express.static(outputDir));

function normalizeDesignType(body) {
  const raw = body?.design_type ?? body?.designType;
  if (raw === undefined || raw === null) return 1;
  const n = Number(raw);
  if (n === 2) return 2;
  if (n === 3) return 3;
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
  if (
    dt !== undefined &&
    dt !== null &&
    Number(dt) !== 1 &&
    Number(dt) !== 2 &&
    Number(dt) !== 3
  ) {
    errors.push("design_type / designTemplate must be 1, 2, or 3 when provided");
  }
  const vl = body.video_layout ?? body.videoLayout;
  if (
    vl !== undefined &&
    vl !== null &&
    vl !== "split" &&
    vl !== "immersive" &&
    vl !== "minimal"
  ) {
    errors.push("video_layout must be 'split', 'immersive', or 'minimal' when provided");
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
  res.json({
    status: "ok",
    service: "video_engine",
    renders: {
      active: renderLimiter.active,
      pending: renderLimiter.pending,
      maxConcurrent: MAX_CONCURRENT_RENDERS,
      maxQueueDepth: MAX_QUEUE_DEPTH,
    },
  });
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

  // Reject early when the waiting queue is already full to avoid unbounded memory growth.
  if (renderLimiter.pending >= MAX_QUEUE_DEPTH) {
    console.warn(
      `[/render] queue full (active=${renderLimiter.active} pending=${renderLimiter.pending}) — rejecting request`,
    );
    return res.status(503).json({
      error: "Render queue is full. Please try again later.",
      details: `Queue depth limit of ${MAX_QUEUE_DEPTH} reached.`,
    });
  }

  const designType = normalizeDesignType(req.body);
  const inputProps = buildBannerInputProps(req.body);

  console.log(
    `[/render] queued — active=${renderLimiter.active} pending=${renderLimiter.pending + 1}`,
    { designType, video_layout: inputProps.video_layout },
  );

  try {
    const { fileName, outputPath, videoUrl, designTemplate } =
      await renderLimiter.run(() =>
        withTimeout(
          renderBannerVideo(inputProps, { publicBaseUrl: PUBLIC_BASE_URL }),
          RENDER_TIMEOUT_MS,
          "Remotion renderMedia",
        ),
      );

    if (!videoUrl) {
      const msg = "Render completed but videoUrl was empty";
      console.error("[/render]", msg, { fileName, outputPath });
      return res.status(500).json({ error: msg });
    }

    console.log("[/render] success", {
      videoUrl,
      fileName,
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
    const isTimeout =
      err instanceof Error && err.message.startsWith("Remotion renderMedia timed out");
    console.error(
      `[/render] ${isTimeout ? "TIMEOUT" : "render failed"}:`,
      err instanceof Error ? err.message : String(err),
    );
    if (!isTimeout && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    const status = isTimeout ? 504 : 500;
    const description = err instanceof Error ? err.message : String(err);
    return res.status(status).json({ error: description });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`video_engine listening on http://0.0.0.0:${PORT}`);
  console.log(`Public video base: ${PUBLIC_BASE_URL} (set VIDEO_ENGINE_PUBLIC_URL to override)`);
  console.log(
    `Render concurrency: max=${MAX_CONCURRENT_RENDERS} queueDepth=${MAX_QUEUE_DEPTH} timeout=${RENDER_TIMEOUT_MS / 1000}s`,
  );
  console.log(
    `Output cleanup: every ${CLEANUP_INTERVAL_MS / 3600_000}h, files older than ${MAX_OUTPUT_AGE_MS / 3600_000}h`,
  );

  // Run an initial sweep on startup to catch files left by a previous process,
  // then repeat on a recurring timer.  .unref() keeps the interval from
  // preventing a clean shutdown when the process receives SIGTERM.
  cleanupOldOutputs();
  setInterval(cleanupOldOutputs, CLEANUP_INTERVAL_MS).unref();
});
