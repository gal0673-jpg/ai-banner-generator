"""
FastAPI backend for the banner generator React app.

Run: uvicorn api:app --reload --host 0.0.0.0 --port 8000

Requires: pip install fastapi uvicorn python-dotenv
"""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

import json
import os
import uuid
from typing import Any, Literal

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from main import BASE_DIR, crawl_from_url, run_agency_banner_pipeline

TASKS_DIR = BASE_DIR / "tasks"
TASKS_DIR.mkdir(parents=True, exist_ok=True)

TaskStatus = Literal["pending", "scraped", "generating_image", "completed", "failed"]

tasks: dict[str, dict[str, Any]] = {}

app = FastAPI(title="Banner generator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/task-files", StaticFiles(directory=str(TASKS_DIR)), name="task_files")


class GenerateRequest(BaseModel):
    url: str = Field(..., min_length=1, description="Site URL to crawl")


def run_banner_task(task_id: str, url: str) -> None:
    work_dir = TASKS_DIR / task_id
    rec = tasks[task_id]
    try:
        crawl_from_url(url, work_dir=work_dir)
        rec["status"] = "scraped"

        if not os.environ.get("OPENAI_API_KEY"):
            rec["status"] = "failed"
            rec["error"] = "OPENAI_API_KEY is not set"
            return

        rec["status"] = "generating_image"
        run_agency_banner_pipeline(work_dir=work_dir)

        campaign_path = work_dir / "creative_campaign.json"
        background = work_dir / "background.png"
        logo = work_dir / "logo.png"
        if not campaign_path.is_file() or not background.is_file() or not logo.is_file():
            rec["status"] = "failed"
            rec["error"] = (
                "Missing creative_campaign.json, background.png, or logo.png after pipeline."
            )
            return

        with campaign_path.open(encoding="utf-8") as f:
            data = json.load(f)

        for key in ("headline", "subhead", "cta"):
            if key not in data or not str(data[key]).strip():
                rec["status"] = "failed"
                rec["error"] = f"Invalid creative_campaign.json: missing or empty {key!r}"
                return
        bullets = data.get("bullet_points")
        if not isinstance(bullets, list) or len(bullets) != 3:
            rec["status"] = "failed"
            rec["error"] = "Invalid creative_campaign.json: bullet_points must be 3 strings."
            return

        rec["status"] = "completed"
        rec["error"] = None
        rec["headline"] = str(data["headline"]).strip()
        rec["subhead"] = str(data["subhead"]).strip()
        rec["bullet_points"] = [str(b).strip() for b in bullets]
        rec["cta"] = str(data["cta"]).strip()
        rec["background_url"] = f"/task-files/{task_id}/background.png"
        rec["logo_url"] = f"/task-files/{task_id}/logo.png"
    except Exception as exc:  # noqa: BLE001 — surface any pipeline failure to the client
        rec["status"] = "failed"
        rec["error"] = str(exc)


@app.post("/generate")
def generate(body: GenerateRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url must not be empty")

    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "status": "pending",
        "url": url,
        "error": None,
        "headline": None,
        "subhead": None,
        "bullet_points": None,
        "cta": None,
        "background_url": None,
        "logo_url": None,
    }
    background_tasks.add_task(run_banner_task, task_id, url)
    return {"task_id": task_id}


@app.get("/status/{task_id}")
def get_status(task_id: str) -> dict[str, Any]:
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Unknown task_id")

    rec = tasks[task_id]
    status: TaskStatus = rec["status"]
    return {
        "task_id": task_id,
        "status": status,
        "error": rec.get("error"),
        "headline": rec.get("headline"),
        "subhead": rec.get("subhead"),
        "bullet_points": rec.get("bullet_points"),
        "cta": rec.get("cta"),
        "background_url": rec.get("background_url"),
        "logo_url": rec.get("logo_url"),
    }
