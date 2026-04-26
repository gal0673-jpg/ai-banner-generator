"""split_gallery — DALL·E 3 stills for 2×2 grid (TL, TR, BL)."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import requests
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    InternalServerError,
    OpenAI,
    RateLimitError,
)
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from services.ugc.exceptions import UGCServiceError

logger = logging.getLogger(__name__)

_TRANSIENT_OPENAI_STATUS = frozenset({408, 429, 500, 502, 503, 504})


def _is_transient_openai_for_split_gallery(exc: BaseException) -> bool:
    if isinstance(exc, (APIConnectionError, APITimeoutError, RateLimitError, InternalServerError)):
        return True
    if isinstance(exc, APIStatusError):
        return exc.status_code in _TRANSIENT_OPENAI_STATUS
    return False


def _is_transient_dalle_split_gallery(exc: BaseException) -> bool:
    if _is_transient_openai_for_split_gallery(exc):
        return True
    if isinstance(
        exc,
        (
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
            requests.exceptions.ChunkedEncodingError,
        ),
    ):
        return True
    if isinstance(exc, requests.exceptions.HTTPError):
        resp = exc.response
        return resp is not None and resp.status_code in _TRANSIENT_OPENAI_STATUS
    return False


_split_gallery_chat_retry = retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    retry=retry_if_exception(_is_transient_openai_for_split_gallery),
)

_split_gallery_dalle_retry = retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    retry=retry_if_exception(_is_transient_dalle_split_gallery),
)


_SPLIT_GALLERY_GPT_SYSTEM = """You turn three short Hebrew product/scene labels into three separate English image prompts for OpenAI DALL·E 3.

Rules:
- Output valid JSON only, with a single key "prompts" whose value is an array of exactly three strings, in the same order as the Hebrew inputs.
- Each English prompt must be a highly detailed, cinematic, photorealistic or premium editorial still description suitable for DALL·E 3.
- The three images are shown as a 2×2 grid (this slot is top-left, top-right, or bottom-left). Style them as a cohesive set (matching lighting/mood) when it fits the subject.
- No text, letters, numbers, watermarks, logos, or UI in the image. No subtitles or signage.
- Avoid humans, faces, hands, or identifiable people unless the Hebrew explicitly requires a person; prefer products, environments, and objects.
- 1024×1024 square composition; center-weighted, bold composition, dramatic lighting, rich texture."""


@_split_gallery_chat_retry
def _split_gallery_prompts_from_hebrew(client: OpenAI, hebrew_lines: list[str]) -> list[str]:
    joined = "\n".join(f"{i + 1}. {line}" for i, line in enumerate(hebrew_lines))
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": _SPLIT_GALLERY_GPT_SYSTEM},
            {
                "role": "user",
                "content": f"Translate and expand these three Hebrew lines into DALL·E 3 prompts (JSON with key prompts):\n\n{joined}",
            },
        ],
        response_format={"type": "json_object"},
    )
    text = response.choices[0].message.content
    if not text:
        raise UGCServiceError("GPT-4o returned an empty response for split_gallery prompts.")
    data = json.loads(text)
    prompts = data.get("prompts")
    if not isinstance(prompts, list) or len(prompts) != 3:
        raise UGCServiceError(
            f"split_gallery GPT response must be JSON with prompts: [str, str, str]; got {data!r}."
        )
    out: list[str] = []
    for i, p in enumerate(prompts):
        if not isinstance(p, str) or not p.strip():
            raise UGCServiceError(f"split_gallery prompts[{i}] must be a non-empty string.")
        out.append(p.strip())
    return out


@_split_gallery_dalle_retry
def _dalle3_generate_to_path(client: OpenAI, prompt: str, dest: Path) -> None:
    img_response = client.images.generate(
        model="dall-e-3",
        prompt=prompt,
        size="1024x1024",
    )
    image_url = img_response.data[0].url
    if not image_url:
        raise UGCServiceError("DALL·E 3 returned no image URL.")
    r = requests.get(image_url, timeout=120)
    r.raise_for_status()
    dest.write_bytes(r.content)


def generate_split_gallery_images(
    image_prompts: list,
    task_id: str,
    work_dir: str | os.PathLike[str],
    *,
    name_prefix: str = "split_gallery",
    refine_prompts_with_gpt: bool = False,
    custom_image_urls: list[str] | None = None,
) -> list[str]:
    """Generate three DALL·E 3 images from three prompt strings on disk.

    When *refine_prompts_with_gpt* is False (default), each string in *image_prompts* is sent
    directly to DALL·E 3 (director ``image_prompt`` fields).

    When True, strings are treated as Hebrew labels and expanded to English DALL·E prompts
    via GPT-4o (legacy scripts).
    """
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise UGCServiceError("OPENAI_API_KEY is not set in the environment.")

    lines: list[str] = []
    arr = list(image_prompts) if isinstance(image_prompts, list) else []
    for k in range(3):
        s = str(arr[k]).strip() if k < len(arr) and arr[k] is not None else ""
        if not s:
            raise UGCServiceError(
                f"split_gallery requires three non-empty image prompt strings; index {k} is missing."
            )
        lines.append(s)

    prefix = (name_prefix or "split_gallery").strip() or "split_gallery"
    root = Path(work_dir)
    root.mkdir(parents=True, exist_ok=True)

    client = OpenAI(api_key=api_key)
    if refine_prompts_with_gpt:
        prompts = _split_gallery_prompts_from_hebrew(client, lines)
    else:
        prompts = lines

    urls: list[str] = []
    for i, prompt in enumerate(prompts, start=1):
        custom_url = ""
        if isinstance(custom_image_urls, list) and len(custom_image_urls) >= i:
            cu = custom_image_urls[i - 1]
            custom_url = str(cu).strip() if cu is not None else ""
        if custom_url:
            urls.append(custom_url)
            continue
        dest = root / f"{prefix}_{i}.png"
        _dalle3_generate_to_path(client, prompt, dest)
        urls.append(f"/task-files/{task_id}/{prefix}_{i}.png")

    logger.info(
        "[ugc_service] split_gallery generated 3 DALL·E images for task_id=%s prefix=%s",
        task_id,
        prefix,
    )
    return urls
