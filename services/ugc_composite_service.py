"""Optional FFmpeg post-step + Remotion caption render for the UGC pipeline.

Triggered from Celery after HeyGen/D-ID returns a CDN URL.

FFmpeg step (try_composite_pip_blur):
  Converts the raw provider video to the target aspect (e.g. 9:16) using a blurred
  full-frame background (scale+crop+blur) plus a letterbox-fit foreground centered on top.
  On failure, callers keep ``ugc_raw_video_url`` only.

Remotion step (call_video_engine_render_ugc):
  Sends the raw CDN video + ugc_script to the Node.js video engine's /render-ugc
  endpoint.  Remotion overlays animated Hebrew captions and returns a final MP4 URL
  stored in ``ugc_final_video_url``.  On failure the pipeline falls back gracefully.

Env:
  UGC_FFMPEG_COMPOSITE      — set to ``0`` / ``false`` / ``no`` to disable FFmpeg step
                               (default: enabled when ffmpeg exists).
  UGC_FFMPEG_BINARY         — override executable name/path (default: ``ffmpeg``).
  VIDEO_ENGINE_URL          — base URL of the Remotion video engine
                               (default: ``http://127.0.0.1:9000``).
  VIDEO_ENGINE_RENDER_UGC_TIMEOUT — HTTP timeout in seconds for /render-ugc
                               (default: 600; set to 960 in .env for long UGC renders).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_DOWNLOAD_FILENAME = "ugc_provider_source.mp4"


def normalize_ugc_aspect_ratio(aspect_ratio: str | None) -> str:
    """Whitelist ``1:1`` / ``16:9`` / ``9:16``; anything else → ``9:16`` (vertical default)."""
    if not isinstance(aspect_ratio, str):
        return "9:16"
    a = aspect_ratio.strip()
    if a in ("1:1", "16:9", "9:16"):
        return a
    return "9:16"


def composited_filename_for_aspect_ratio(aspect_ratio: str = "9:16") -> str:
    """Local FFmpeg output name under the task work dir (9:16 keeps legacy ``ugc_composited.mp4``)."""
    ar = normalize_ugc_aspect_ratio(aspect_ratio)
    if ar == "1:1":
        return "ugc_composited_1_1.mp4"
    if ar == "16:9":
        return "ugc_composited_16_9.mp4"
    return "ugc_composited.mp4"


def _ugc_canvas_width_height(aspect_ratio: str | None) -> tuple[int, int]:
    """FFmpeg output width × height for UGC composite canvas (strict mapping)."""
    ar = normalize_ugc_aspect_ratio(aspect_ratio)
    if ar == "1:1":
        return (1080, 1080)
    if ar == "16:9":
        return (1920, 1080)
    return (1080, 1920)


def _ugc_script_scrub_reserved(script: dict | None) -> dict | None:
    """Drop keys that could confuse tooling if GPT echoed them inside ``ugc_script``."""
    if not isinstance(script, dict):
        return script
    reserved = frozenset({"aspect_ratio", "aspectRatio"})
    if not reserved.intersection(script.keys()):
        return script
    return {k: v for k, v in script.items() if k not in reserved}


def _ffmpeg_binary() -> str:
    return os.environ.get("UGC_FFMPEG_BINARY", "ffmpeg").strip() or "ffmpeg"


def composite_enabled() -> bool:
    if os.environ.get("UGC_FFMPEG_COMPOSITE", "1").strip().lower() in (
        "0",
        "false",
        "no",
        "off",
    ):
        return False
    return shutil.which(_ffmpeg_binary()) is not None


def _download_video(url: str, dest: Path, timeout: int = 180) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with dest.open("wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 256):
                if chunk:
                    f.write(chunk)


def try_composite_pip_blur(
    *,
    task_id: str,
    source_video_url: str,
    work_dir: Path,
    speed_factor: float = 1.0,
    aspect_ratio: str = "9:16",
) -> tuple[str | None, str | None]:
    """Download provider MP4, run FFmpeg blurred-background composite, write aspect-specific MP4.

    Args:
        speed_factor: Playback rate for video+audio (1.0 = unchanged). Clamped to 0.5–2.0
            for FFmpeg ``atempo`` compatibility.
        aspect_ratio: ``9:16`` (1080×1920), ``1:1`` (1080×1080), or ``16:9`` (1920×1080).

    Returns:
        ``(relative_url, note)`` — relative_url like ``/task-files/<id>/ugc_composited.mp4``,
        or ``(None, note)`` when skipped/failed (note explains why; may be None).
    """
    if not composite_enabled():
        bin_name = _ffmpeg_binary()
        if shutil.which(bin_name) is None:
            return None, (
                "FFmpeg is not installed on the server. Showing raw provider video. "
                "To enable the UGC FFmpeg composite (blurred background + fit foreground), "
                "please install FFmpeg "
                f"and set UGC_FFMPEG_BINARY to its full path (e.g. C:/laragon/ffpm/bin/ffmpeg.exe). "
                f"[looked for: {bin_name!r}]"
            )
        return None, "UGC composite disabled (UGC_FFMPEG_COMPOSITE)."

    ffmpeg = _ffmpeg_binary()
    out_name = composited_filename_for_aspect_ratio(aspect_ratio)
    out_path = work_dir / out_name
    dl_path = work_dir / _DOWNLOAD_FILENAME
    w, h = _ugc_canvas_width_height(aspect_ratio)
    logger.info(
        "[ugc_composite] task_id=%s aspect=%s canvas=%d×%d (blur-bg + fit-fg)",
        task_id,
        normalize_ugc_aspect_ratio(aspect_ratio),
        w,
        h,
    )

    try:
        logger.info(
            "[ugc_composite] task_id=%s downloading provider video…", task_id
        )
        _download_video(source_video_url, dl_path)
    except requests.RequestException as exc:
        msg = f"UGC composite skipped: download failed ({exc})."
        logger.warning("[ugc_composite] task_id=%s %s", task_id, msg)
        return None, msg

    # speed_factor: playback rate (e.g. 1.15 = 15% faster).  setpts=PTS/sf compresses
    # the video timeline; atempo matches audio (FFmpeg atempo supports 0.5–2.0 per stage).
    sf = float(speed_factor)
    if sf <= 0 or sf != sf:  # NaN
        sf = 1.0
    else:
        sf = min(2.0, max(0.5, sf))
    use_speed = abs(sf - 1.0) > 1e-3

    # Background: fill canvas + crop + heavy blur. Foreground: fit inside canvas (no crop).
    # Overlay centers fg on bg so aspect changes (e.g. 9:16 → 16:9) do not decapitate the avatar.
    _overlay_tail = (
        f"[bg][fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,setsar=1"
        + (f",setpts=PTS/{sf}" if use_speed else "")
        + "[outv]"
    )
    fc = (
        f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,"
        f"crop={w}:{h}:(iw-ow)/2:(ih-oh)/2,boxblur=20:10[bg];"
        f"[0:v]scale={w}:{h}:force_original_aspect_ratio=decrease[fg];"
        f"{_overlay_tail}"
    )

    def _run_ffmpeg(with_audio: bool) -> subprocess.CompletedProcess[str]:
        c = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(dl_path),
            "-filter_complex",
            fc,
            "-map",
            "[outv]",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            "20",
            "-preset",
            "fast",
            "-movflags",
            "+faststart",
        ]
        if with_audio:
            audio_chain: list[str] = ["-map", "0:a?"]
            if use_speed:
                audio_chain.extend(["-filter:a", f"atempo={sf}"])
            audio_chain.extend(["-c:a", "aac", "-b:a", "192k"])
            c.extend(audio_chain)
        else:
            c.append("-an")
        c.append(str(out_path))
        return subprocess.run(
            c,
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )

    try:
        proc = _run_ffmpeg(with_audio=True)
        if proc.returncode != 0:
            err_txt = (proc.stderr or proc.stdout or "").lower()
            if "matches no streams" in err_txt or "could not find" in err_txt:
                proc = _run_ffmpeg(with_audio=False)
    except subprocess.TimeoutExpired:
        msg = "UGC composite failed: ffmpeg timeout (600s)."
        logger.error("[ugc_composite] task_id=%s %s", task_id, msg)
        return None, msg
    except OSError as exc:
        msg = f"UGC composite failed: could not run ffmpeg ({exc})."
        logger.error("[ugc_composite] task_id=%s %s", task_id, msg)
        return None, msg

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()[:800]
        msg = f"UGC composite failed (ffmpeg exit {proc.returncode}): {err or 'no stderr'}"
        logger.error("[ugc_composite] task_id=%s %s", task_id, msg)
        return None, msg

    if not out_path.is_file() or out_path.stat().st_size < 1024:
        msg = "UGC composite failed: output file missing or too small."
        logger.error("[ugc_composite] task_id=%s %s", task_id, msg)
        return None, msg

    rel = f"/task-files/{task_id}/{out_name}"
    logger.info("[ugc_composite] task_id=%s OK → %s", task_id, rel)
    return rel, None


def get_video_duration_seconds(path: Path) -> float | None:
    """Return the exact duration (seconds) of a local video file via ffprobe.

    Derives the ffprobe binary from ``UGC_FFMPEG_BINARY`` by substituting
    ``ffmpeg`` → ``ffprobe`` in the filename.  Returns ``None`` on any failure so
    callers can fall back to the AI-estimated duration without crashing.
    """
    ffmpeg_bin = _ffmpeg_binary()
    ffprobe_bin = ffmpeg_bin.replace("ffmpeg.exe", "ffprobe.exe")
    if ffprobe_bin == ffmpeg_bin:
        ffprobe_bin = ffmpeg_bin.replace("ffmpeg", "ffprobe")
    if not (shutil.which(ffprobe_bin) or Path(ffprobe_bin).is_file()):
        return None
    try:
        proc = subprocess.run(
            [
                ffprobe_bin,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        return float(proc.stdout.strip())
    except Exception:
        return None


# ── Remotion caption render ───────────────────────────────────────────────────

def _video_engine_render_ugc_url() -> str:
    base = os.environ.get("VIDEO_ENGINE_URL", "http://127.0.0.1:9000").rstrip("/")
    return f"{base}/render-ugc"


def call_video_engine_render_ugc(
    *,
    task_id: str,
    raw_video_url: str,
    ugc_script: dict,
    bgm_url: str = "",
    website_display: str | None = None,
    logo_url: str | None = None,
    product_image_url: str | None = None,
    brand_color: str | None = None,
    aspect_ratio: str = "9:16",
) -> tuple[str | None, str | None]:
    """POST to the Node.js video engine's /render-ugc endpoint.

    Remotion overlays animated Hebrew captions (from ``ugc_script.scenes[].on_screen_text``)
    onto the avatar video and returns a finished MP4.

    Args:
        task_id:       Used for sub-directory organisation inside the video engine.
        raw_video_url: Publicly reachable URL of the HeyGen/D-ID source video.
        ugc_script:    Validated script dict (``estimated_duration_seconds`` + ``scenes``).
        bgm_url:       Optional background music URL (passed through to Remotion).

    Returns:
        ``(video_url, None)`` on success — ``video_url`` is the absolute URL returned by
        the video engine.
        ``(None, error_message)`` on any failure so callers can fall back gracefully.
    """
    endpoint = _video_engine_render_ugc_url()
    timeout = int(os.environ.get("VIDEO_ENGINE_RENDER_UGC_TIMEOUT", "600"))

    ar = normalize_ugc_aspect_ratio(aspect_ratio)
    script_out = _ugc_script_scrub_reserved(ugc_script) if isinstance(ugc_script, dict) else ugc_script

    payload: dict = {
        "task_id": task_id,
        "raw_video_url": raw_video_url,
        "ugc_script": script_out,
        "aspect_ratio": ar,
    }
    if bgm_url:
        payload["bgm_url"] = bgm_url
    if website_display:
        payload["website_display"] = website_display
    if logo_url:
        payload["logo_url"] = logo_url
    if product_image_url:
        payload["product_image_url"] = product_image_url
    if brand_color:
        payload["brand_color"] = brand_color

    logger.info(
        "[ugc_render] task_id=%s  POSTing to %s  aspect=%s  scenes=%d  duration=%ss",
        task_id,
        endpoint,
        ar,
        len((script_out or {}).get("scenes") or []),
        (script_out or {}).get("estimated_duration_seconds", "?"),
    )

    try:
        resp = requests.post(endpoint, json=payload, timeout=timeout)
    except requests.ConnectionError as exc:
        msg = f"Video engine unreachable ({endpoint}): {exc}"
        logger.warning("[ugc_render] task_id=%s  %s", task_id, msg)
        return None, msg
    except requests.Timeout:
        msg = f"Video engine timed out after {timeout}s ({endpoint})."
        logger.warning("[ugc_render] task_id=%s  %s", task_id, msg)
        return None, msg
    except requests.RequestException as exc:
        msg = f"Video engine request failed: {exc}"
        logger.warning("[ugc_render] task_id=%s  %s", task_id, msg)
        return None, msg

    if resp.status_code >= 400:
        # Try to surface the structured error detail from the Node response.
        detail = resp.text[:500] if resp.text else resp.reason
        try:
            err_json = resp.json()
            if isinstance(err_json, dict):
                raw_d = err_json.get("details") or err_json.get("error") or detail
                detail = " ".join(str(x) for x in raw_d) if isinstance(raw_d, list) else str(raw_d)
        except (json.JSONDecodeError, ValueError):
            pass
        msg = f"Video engine returned HTTP {resp.status_code}: {detail}"
        logger.warning("[ugc_render] task_id=%s  %s", task_id, msg)
        return None, msg

    try:
        data = resp.json()
    except (json.JSONDecodeError, ValueError) as exc:
        msg = f"Video engine returned non-JSON response: {exc}"
        logger.warning("[ugc_render] task_id=%s  %s", task_id, msg)
        return None, msg

    if not data.get("success"):
        fail = data.get("error") or data.get("details") or "render failed"
        msg = f"Video engine render failed: {fail}"
        logger.warning("[ugc_render] task_id=%s  %s", task_id, msg)
        return None, msg

    video_url = data.get("videoUrl") or data.get("video_url") or ""
    if not isinstance(video_url, str) or not video_url.strip():
        msg = "Video engine response missing videoUrl."
        logger.warning("[ugc_render] task_id=%s  %s", task_id, msg)
        return None, msg

    final_url = video_url.strip()
    logger.info("[ugc_render] task_id=%s  OK → %s", task_id, final_url)
    return final_url, None
