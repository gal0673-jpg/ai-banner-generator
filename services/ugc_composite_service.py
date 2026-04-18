"""Optional FFmpeg post-step + Remotion caption render for the UGC pipeline.

Triggered from Celery after HeyGen/D-ID returns a CDN URL.

FFmpeg step (try_composite_pip_blur):
  Converts the raw horizontal video to a 9:16 vertical format with a blurred
  background.  On failure, callers keep ``ugc_raw_video_url`` only.

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
                               (default: 600; set to 960 in .env for blur-bg renders).
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

_COMPOSITED_FILENAME = "ugc_composited.mp4"
_DOWNLOAD_FILENAME = "ugc_provider_source.mp4"


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
) -> tuple[str | None, str | None]:
    """Download provider MP4, run blur-bg PiP composite, write ``ugc_composited.mp4``.

    Returns:
        ``(relative_url, note)`` — relative_url like ``/task-files/<id>/ugc_composited.mp4``,
        or ``(None, note)`` when skipped/failed (note explains why; may be None).
    """
    if not composite_enabled():
        bin_name = _ffmpeg_binary()
        if shutil.which(bin_name) is None:
            return None, (
                "FFmpeg is not installed on the server. Showing raw horizontal video. "
                "To get the vertical 9:16 blurred-background effect, please install FFmpeg "
                f"and set UGC_FFMPEG_BINARY to its full path (e.g. C:/laragon/ffpm/bin/ffmpeg.exe). "
                f"[looked for: {bin_name!r}]"
            )
        return None, "UGC composite disabled (UGC_FFMPEG_COMPOSITE)."

    ffmpeg = _ffmpeg_binary()
    out_path = work_dir / _COMPOSITED_FILENAME
    dl_path = work_dir / _DOWNLOAD_FILENAME

    try:
        logger.info(
            "[ugc_composite] task_id=%s downloading provider video…", task_id
        )
        _download_video(source_video_url, dl_path)
    except requests.RequestException as exc:
        msg = f"UGC composite skipped: download failed ({exc})."
        logger.warning("[ugc_composite] task_id=%s %s", task_id, msg)
        return None, msg

    # COVER-mode blur-bg composite (works for both portrait AND landscape sources).
    #
    # Background: `increase` + `crop` → cover-fills 1080×1920 without letterbox bars.
    #
    # Foreground: `decrease` → fits the full video within 1080×1920 without any
    # cropping, then centred exactly in the middle of the canvas.  This preserves
    # the avatar's head/forehead regardless of the source aspect ratio.
    fc = (
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,setsar=1,split=2[bg][fg_orig];"
        "[bg]gblur=sigma=25[bg_blurred];"
        "[fg_orig]scale=1080:1920:force_original_aspect_ratio=decrease[fg_scaled];"
        "[bg_blurred][fg_scaled]overlay=(W-w)/2:(H-h)/2:shortest=1[outv]"
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
            c.extend(["-map", "0:a?", "-c:a", "aac", "-b:a", "192k"])
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

    rel = f"/task-files/{task_id}/{_COMPOSITED_FILENAME}"
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

    payload: dict = {
        "task_id": task_id,
        "raw_video_url": raw_video_url,
        "ugc_script": ugc_script,
    }
    if bgm_url:
        payload["bgm_url"] = bgm_url
    if website_display:
        payload["website_display"] = website_display
    if logo_url:
        payload["logo_url"] = logo_url
    if product_image_url:
        payload["product_image_url"] = product_image_url

    logger.info(
        "[ugc_render] task_id=%s  POSTing to %s  scenes=%d  duration=%ss",
        task_id,
        endpoint,
        len(ugc_script.get("scenes") or []),
        ugc_script.get("estimated_duration_seconds", "?"),
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
