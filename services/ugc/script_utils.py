"""Helpers for UGC script payloads."""


def combined_spoken_text_from_script(ugc_script: dict | None) -> str:
    """Concatenate all ``spoken_text`` values from ``ugc_script.scenes`` (UGC pipeline / Celery step 2)."""
    scenes = (ugc_script or {}).get("scenes") or []
    return " ".join(str(scene.get("spoken_text", "") or "").strip() for scene in scenes).strip()
