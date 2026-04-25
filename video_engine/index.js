import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildBannerInputProps, renderBannerVideo, buildUgcInputProps, renderUgcVideo } from "./render.js";

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
/**
 * Separate deadline for UGC renders: long clips + OffthreadVideo decode is slower than
 * a banner render.
 * Defaults to 25 min; override via UGC_RENDER_TIMEOUT_MS in .env.
 */
const UGC_RENDER_TIMEOUT_MS = Number(process.env.UGC_RENDER_TIMEOUT_MS) || 25 * 60 * 1000;
/**
 * If an active slot is still held longer than this (wall clock), the limiter rejects
 * the outer job promise so the slot frees even when Remotion/Node never settles
 * (orphaned render). Must exceed the longest per-render `withTimeout` (UGC).
 */
const ACTIVE_RENDER_HUNG_MS =
  Number(process.env.ACTIVE_RENDER_HUNG_MS) ||
  UGC_RENDER_TIMEOUT_MS + 10 * 60 * 1000;

/** Max time to wait for active renders after SIGTERM/SIGINT before exit. */
const SHUTDOWN_GRACE_MS =
  Number(process.env.VIDEO_ENGINE_SHUTDOWN_GRACE_MS) ||
  UGC_RENDER_TIMEOUT_MS + 2 * 60 * 1000;

// ── Output-file cleanup config ─────────────────────────────────────────────
const CLEANUP_INTERVAL_MS =
  Number(process.env.CLEANUP_INTERVAL_MS) || 60 * 60 * 1000; // 1 h
const MAX_OUTPUT_AGE_MS =
  Number(process.env.MAX_OUTPUT_AGE_MS) || 24 * 60 * 60 * 1000; // 24 h

// ── Structured logging ───────────────────────────────────────────────────────
function logJson(level, msg, fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "video_engine",
    msg,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

// ── ConcurrencyLimiter ──────────────────────────────────────────────────────
/**
 * Promise-queue that caps the number of concurrently executing async tasks.
 * Callers beyond `maxConcurrent` wait in a FIFO queue until a slot opens.
 *
 * Each running job is also raced against `activeHangMs`: if the worker promise
 * never settles (orphaned Remotion, etc.), the slot is released by rejecting the
 * outer promise returned from `run()`.
 */
class ConcurrencyLimiter {
  constructor(maxConcurrent, options = {}) {
    this._max = maxConcurrent;
    this._active = 0;
    this._queue = [];
    this._activeHangMs = options.activeHangMs ?? ACTIVE_RENDER_HUNG_MS;
  }

  get active() {
    return this._active;
  }

  get pending() {
    return this._queue.length;
  }

  /**
   * Reject all jobs still waiting for a slot (not yet started).
   * @param {Error} reason
   */
  rejectQueued(reason) {
    while (this._queue.length > 0) {
      const { resolve, reject, fn: _fn } = this._queue.shift();
      void _fn;
      reject(reason);
    }
  }

  /**
   * Resolves when `active === 0` or after `timeoutMs`.
   * @returns {Promise<{ drained: boolean, active: number }>}
   */
  waitForActiveDrain(timeoutMs) {
    if (this._active === 0) {
      return Promise.resolve({ drained: true, active: 0 });
    }
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const id = setInterval(() => {
        if (this._active === 0) {
          clearInterval(id);
          resolve({ drained: true, active: 0 });
        } else if (Date.now() >= deadline) {
          clearInterval(id);
          resolve({ drained: false, active: this._active });
        }
      }, 300);
    });
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

  /**
   * Race `fn()` against a hung-job watchdog so `_active` always decrements.
   */
  _runWithHungGuard(fn, resolve, reject) {
    this._active++;
    let hungTimer = null;
    const hungPromise = new Promise((_, rej) => {
      hungTimer = setTimeout(() => {
        logJson("error", "render_hung_slot_reclaimed", {
          activeHangMs: this._activeHangMs,
          activeSlots: this._active,
        });
        rej(
          new Error(
            `[ConcurrencyLimiter] Render hung — no settlement after ${this._activeHangMs}ms (orphaned worker?)`,
          ),
        );
      }, this._activeHangMs);
    });

    const workPromise = Promise.resolve().then(() => fn());
    Promise.race([workPromise, hungPromise])
      .then(resolve, reject)
      .finally(() => {
        if (hungTimer) clearTimeout(hungTimer);
        this._active--;
        this._drain();
      });
  }

  _drain() {
    while (this._active < this._max && this._queue.length > 0) {
      const { fn, resolve, reject } = this._queue.shift();
      this._runWithHungGuard(fn, resolve, reject);
    }
  }
}

const renderLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_RENDERS, {
  activeHangMs: ACTIVE_RENDER_HUNG_MS,
});

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

/** When true, new render jobs receive 503; in-flight work is allowed to finish until grace timeout. */
let shuttingDown = false;
/** @type {import('http').Server | null} */
let server = null;

function serializeErr(err) {
  if (!(err instanceof Error)) {
    return { name: "Error", message: String(err) };
  }
  return { name: err.name, message: err.message, stack: err.stack };
}

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  if (
    shuttingDown &&
    req.method === "POST" &&
    (req.path === "/render" || req.path === "/render-ugc")
  ) {
    return res.status(503).json({
      error: "Server is shutting down; try again later.",
      code: "SHUTTING_DOWN",
    });
  }
  next();
});

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
    status: shuttingDown ? "draining" : "ok",
    service: "video_engine",
    shuttingDown,
    renders: {
      active: renderLimiter.active,
      pending: renderLimiter.pending,
      maxConcurrent: MAX_CONCURRENT_RENDERS,
      maxQueueDepth: MAX_QUEUE_DEPTH,
      activeRenderHungMs: ACTIVE_RENDER_HUNG_MS,
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

  if (shuttingDown) {
    return res.status(503).json({ error: "Server is shutting down; try again later.", code: "SHUTTING_DOWN" });
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
    const errObj = err instanceof Error ? err : new Error(String(err));
    const isTimeout = errObj.message.startsWith("Remotion renderMedia timed out");
    const isHung =
      errObj.message.includes("[ConcurrencyLimiter]") ||
      errObj.message.includes("Render hung");
    const kind = isTimeout ? "timeout" : isHung ? "hung_slot" : "render_error";
    logJson("error", "render_route_failed", {
      route: "/render",
      kind,
      error: serializeErr(errObj),
      task_id: req.body?.task_id ?? null,
      designType,
    });
    const status = isTimeout ? 504 : isHung ? 503 : 500;
    return res.status(status).json({ error: errObj.message, code: kind });
  }
});

// ── UGC render ─────────────────────────────────────────────────────────────

function validateUgcRenderPayload(body) {
  const errors = [];

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["Body must be a JSON object"] };
  }

  const rawVideoUrl = body.raw_video_url;
  if (!rawVideoUrl || typeof rawVideoUrl !== "string" || !rawVideoUrl.trim()) {
    errors.push("Missing required field: raw_video_url (non-empty string)");
  }

  const ugcScript = body.ugc_script;
  if (!ugcScript || typeof ugcScript !== "object" || Array.isArray(ugcScript)) {
    errors.push("Missing required field: ugc_script (must be an object)");
  } else {
    if (!Array.isArray(ugcScript.scenes) || ugcScript.scenes.length === 0) {
      errors.push("ugc_script.scenes must be a non-empty array");
    }
    if (
      typeof ugcScript.estimated_duration_seconds !== "number" ||
      ugcScript.estimated_duration_seconds <= 0
    ) {
      errors.push("ugc_script.estimated_duration_seconds must be a positive number");
    }
  }

  if (
    body.bgm_url !== undefined &&
    body.bgm_url !== null &&
    body.bgm_url !== "" &&
    typeof body.bgm_url !== "string"
  ) {
    errors.push("bgm_url must be a string when provided");
  }

  if (
    body.website_display !== undefined &&
    body.website_display !== null &&
    body.website_display !== "" &&
    typeof body.website_display !== "string"
  ) {
    errors.push("website_display must be a string when provided");
  }
  if (typeof body.website_display === "string" && body.website_display.length > 512) {
    errors.push("website_display must be at most 512 characters");
  }

  if (
    body.logo_url !== undefined &&
    body.logo_url !== null &&
    body.logo_url !== "" &&
    typeof body.logo_url !== "string"
  ) {
    errors.push("logo_url must be a string when provided");
  }
  if (typeof body.logo_url === "string" && body.logo_url.length > 1024) {
    errors.push("logo_url must be at most 1024 characters");
  }

  if (
    body.product_image_url !== undefined &&
    body.product_image_url !== null &&
    body.product_image_url !== "" &&
    typeof body.product_image_url !== "string"
  ) {
    errors.push("product_image_url must be a string when provided");
  }
  if (typeof body.product_image_url === "string" && body.product_image_url.length > 1024) {
    errors.push("product_image_url must be at most 1024 characters");
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

app.post("/render-ugc", async (req, res) => {
  console.log("[/render-ugc] incoming body:", JSON.stringify(req.body));

  const { ok, errors } = validateUgcRenderPayload(req.body);
  if (!ok) {
    return res.status(400).json({ error: "Validation failed", details: errors });
  }

  if (shuttingDown) {
    return res.status(503).json({ error: "Server is shutting down; try again later.", code: "SHUTTING_DOWN" });
  }

  if (renderLimiter.pending >= MAX_QUEUE_DEPTH) {
    console.warn(
      `[/render-ugc] queue full (active=${renderLimiter.active} pending=${renderLimiter.pending}) — rejecting request`,
    );
    return res.status(503).json({
      error: "Render queue is full. Please try again later.",
      details: `Queue depth limit of ${MAX_QUEUE_DEPTH} reached.`,
    });
  }

  const inputProps = buildUgcInputProps(req.body);

  console.log(
    `[/render-ugc] queued — active=${renderLimiter.active} pending=${renderLimiter.pending + 1}`,
    {
      scenes: inputProps.ugc_script?.scenes?.length ?? 0,
      duration: inputProps.ugc_script?.estimated_duration_seconds ?? "?",
    },
  );

  try {
    const { fileName, outputPath, videoUrl } = await renderLimiter.run(() =>
      withTimeout(
        renderUgcVideo(inputProps, { publicBaseUrl: PUBLIC_BASE_URL }),
        UGC_RENDER_TIMEOUT_MS,
        "Remotion renderMedia",
      ),
    );

    if (!videoUrl) {
      const msg = "Render completed but videoUrl was empty";
      console.error("[/render-ugc]", msg, { fileName, outputPath });
      return res.status(500).json({ error: msg });
    }

    console.log("[/render-ugc] success", { videoUrl, fileName });
    return res.status(200).json({ success: true, videoUrl, fileName, outputPath });
  } catch (err) {
    const errObj = err instanceof Error ? err : new Error(String(err));
    const isTimeout = errObj.message.startsWith("Remotion renderMedia timed out");
    const isHung =
      errObj.message.includes("[ConcurrencyLimiter]") ||
      errObj.message.includes("Render hung");
    const kind = isTimeout ? "timeout" : isHung ? "hung_slot" : "render_error";
    logJson("error", "render_ugc_route_failed", {
      route: "/render-ugc",
      kind,
      error: serializeErr(errObj),
      task_id: req.body?.task_id ?? null,
      scenes: inputProps?.ugc_script?.scenes?.length ?? null,
    });
    const status = isTimeout ? 504 : isHung ? 503 : 500;
    return res.status(status).json({ error: errObj.message, code: kind });
  }
});

/**
 * Stop accepting connections and queued renders; wait for active slots to drain.
 * @param {NodeJS.Signals} signal
 */
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logJson("warn", "graceful_shutdown_started", {
    signal,
    active: renderLimiter.active,
    pending: renderLimiter.pending,
    graceMs: SHUTDOWN_GRACE_MS,
  });

  await new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((closeErr) => {
      if (closeErr) {
        logJson("error", "server_close_error", { error: serializeErr(closeErr) });
      }
      resolve();
    });
  });

  const qErr = Object.assign(new Error("Server shutting down"), { code: "SHUTTING_DOWN" });
  const queued = renderLimiter.pending;
  renderLimiter.rejectQueued(qErr);
  if (queued > 0) {
    logJson("warn", "shutdown_queued_renders_rejected", { count: queued });
  }

  const { drained, active } = await renderLimiter.waitForActiveDrain(SHUTDOWN_GRACE_MS);
  if (!drained) {
    logJson("error", "shutdown_grace_exceeded", {
      active,
      graceMs: SHUTDOWN_GRACE_MS,
      signal,
    });
    process.exit(1);
    return;
  }

  logJson("info", "graceful_shutdown_complete", { signal });
  process.exit(0);
}

server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`video_engine listening on http://0.0.0.0:${PORT}`);
  console.log(`Public video base: ${PUBLIC_BASE_URL} (set VIDEO_ENGINE_PUBLIC_URL to override)`);
  console.log(
    `Render concurrency: max=${MAX_CONCURRENT_RENDERS} queueDepth=${MAX_QUEUE_DEPTH} ` +
    `timeout_banner=${RENDER_TIMEOUT_MS / 1000}s timeout_ugc=${UGC_RENDER_TIMEOUT_MS / 1000}s ` +
    `hung_detect=${ACTIVE_RENDER_HUNG_MS / 1000}s shutdown_grace=${SHUTDOWN_GRACE_MS / 1000}s`,
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

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.once(sig, () => {
    gracefulShutdown(sig).catch((e) => {
      logJson("error", "graceful_shutdown_failed", { error: serializeErr(e) });
      process.exit(1);
    });
  });
}
