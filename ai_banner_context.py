"""
Generate ai-banner-context.txt: compact handoff for AI (architecture, DB, tree, source).

Skipped: .git, __pycache__, node_modules, venv, dist, build, .cursor, tasks/* contents,
         and embedding of previous giant context dumps.

CLI:  python ai_banner_context.py
      python ai_banner_context.py --root .
"""

from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

RULE = "=" * 80

OUTPUT_FILENAME = "ai-banner-context.txt"

IGNORE_DIR_NAMES = frozenset({
    ".git",
    "__pycache__",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    ".eggs",
    ".cursor",
})

# Do not paste these into the bundle (self-bloat / regenerated artifacts).
SKIP_CONTENT_FILENAMES = frozenset({
    "project_context.txt",
    OUTPUT_FILENAME,
})

# Omit from tree listing only (not source); keeps the structure readable for AI.
_TREE_ARTIFACT_SUFFIXES = (
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".ico",
    ".db",
    ".sqlite",
    ".sqlite3",
    ".woff2",
    ".ttf",
    ".pdf",
)


def _dir_skipped(name: str) -> bool:
    if name in IGNORE_DIR_NAMES:
        return True
    if name.endswith(".egg-info"):
        return True
    return False


def _tree_entry_skipped(path: Path) -> bool:
    if _dir_skipped(path.name):
        return True
    if path.is_file():
        if path.name in SKIP_CONTENT_FILENAMES:
            return True
        low = path.name.lower()
        if any(low.endswith(s) for s in _TREE_ARTIFACT_SUFFIXES):
            return True
    return False


def _should_skip_file_for_content(path: Path, root: Path) -> bool:
    try:
        rel = path.relative_to(root)
    except ValueError:
        return True
    if rel.name in SKIP_CONTENT_FILENAMES:
        return True
    return False


def project_tree_lines(directory: Path, prefix: str = "", project_root: Path | None = None) -> list[str]:
    """ASCII tree; under <root>/tasks/ only a stub line (no UUID spam)."""
    project_root = project_root or directory
    lines: list[str] = []
    try:
        children = sorted(
            [p for p in directory.iterdir() if not _tree_entry_skipped(p)],
            key=lambda p: (not p.is_dir(), p.name.lower()),
        )
    except OSError as exc:
        return [f"{prefix}[cannot read: {exc}]"]

    root_res = project_root.resolve()
    for i, path in enumerate(children):
        last = i == len(children) - 1
        branch = "└── " if last else "├── "
        lines.append(f"{prefix}{branch}{path.name}")

        if not path.is_dir():
            continue

        ext = "    " if last else "│   "
        next_prefix = prefix + ext

        if path.resolve() == (root_res / "tasks").resolve():
            try:
                n = sum(1 for p in path.iterdir() if p.is_dir())
            except OSError:
                n = 0
            lines.append(f"{next_prefix}└── [{n} task UUID folders — runtime outputs omitted]")
            continue

        lines.extend(project_tree_lines(path, next_prefix, project_root))
    return lines


def structure_section(root: Path) -> str:
    top = f"{root.name}/"
    body = project_tree_lines(root, "", root)
    return top + ("\n" + "\n".join(body) if body else "")


def walk_filtered(root: Path):
    root_s = os.fspath(root.resolve())
    for dirpath, dirnames, filenames in os.walk(root_s):
        dirnames[:] = [d for d in dirnames if not _dir_skipped(d)]
        # Never walk into tasks/*/ (only skip one level under tasks)
        rel = Path(dirpath).resolve().relative_to(root.resolve())
        parts = rel.parts
        if len(parts) >= 2 and parts[0] == "tasks":
            dirnames[:] = []
        yield dirpath, dirnames, filenames


def iter_py_files(root: Path) -> list[Path]:
    paths: list[Path] = []
    for dirpath, _dirnames, filenames in walk_filtered(root):
        for name in filenames:
            if name.endswith(".py"):
                p = Path(dirpath) / name
                if not _should_skip_file_for_content(p, root):
                    paths.append(p)
    return sorted(paths)


def iter_client_source_files(root: Path) -> list[Path]:
    """React/Vite sources and config (no node_modules)."""
    client = root / "client"
    if not client.is_dir():
        return []
    extra = [
        client / "package.json",
        client / "vite.config.js",
        client / "index.html",
        client / "eslint.config.js",
    ]
    paths: list[Path] = []
    src = client / "src"
    if src.is_dir():
        for dirpath, _dirnames, filenames in os.walk(src):
            for name in filenames:
                if name.endswith((".jsx", ".js", ".css")):
                    paths.append(Path(dirpath) / name)
    paths.extend(p for p in extra if p.is_file())
    paths = [p for p in paths if not _should_skip_file_for_content(p, root)]
    return sorted(set(paths), key=lambda p: str(p).lower())


def iter_root_config_files(root: Path) -> list[Path]:
    names = ("requirements.txt", ".env.example")
    out: list[Path] = []
    for n in names:
        p = root / n
        if p.is_file() and not _should_skip_file_for_content(p, root):
            out.append(p)
    return out


def read_utf8(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def header_block(title: str) -> list[str]:
    return ["", RULE, title, RULE, ""]


def file_block(label: str, content: str) -> list[str]:
    return [
        "",
        RULE,
        f"FILE: {label}",
        RULE,
        "",
        content.rstrip("\n"),
        "",
    ]


def architecture_section() -> str:
    return """
SYSTEM OVERVIEW (banner generator)
---------------------------------
- Backend: FastAPI in api.py — JWT auth (auth.py), SQLAlchemy models (models.py), MySQL via DATABASE_URL (database.py).
- Bootstrap: on startup, creates superuser gal0673@gmail.com if missing (see SUPERUSER_EMAIL in api.py).
- Flow: POST /generate enqueues crawl + creative pipeline (main.py); task row in banner_tasks; static files under tasks/<uuid>/ served at /task-files/...
- Client: Vite + React (client/) — Login, BannerWorkspace, BannerCanvas (Framer Motion + re-resizable, html-to-image export).
- Pipeline pieces: creative_agent.py, generate_copy.py, html_renderer.py, composite_banner.py (image generation path).
- Admin: GET /admin/tasks (superuser). Primary-admin-only: GET /admin/ai-banner-context (same email as SUPERUSER_EMAIL).

This file is generated for AI-assisted development and debugging; it omits git, node_modules, per-task binary trees, and prior context dumps.
""".strip()


def database_section() -> str:
    return """
DATABASE (SQLAlchemy, MySQL via DATABASE_URL)
--------------------------------------------
users
  - id (UUID, PK)
  - email (unique)
  - hashed_password
  - is_superuser (bool)
  - created_at (timezone-aware)

banner_tasks
  - id (UUID, PK)
  - user_id (FK -> users.id, CASCADE)
  - status (pending | scraped | generating_image | completed | failed)
  - url, brief (optional), error (optional)
  - headline, subhead, bullet_points (JSON list), cta, brand_color
  - background_url, logo_url (paths under /task-files/...)

See models.py for exact column types and relationships.
""".strip()


def build_document(root: Path) -> str:
    root = root.resolve()
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    parts: list[str] = [
        "AI BANNER CONTEXT EXPORT",
        f"Generated (UTC): {stamp}",
        f"Project root: {root}",
        f"Output filename: {OUTPUT_FILENAME}",
        "",
        "Includes: architecture summary, DB summary, filtered tree, Python sources, client sources, root config.",
        "Excluded: .git, __pycache__, node_modules, venv, dist, build, .cursor, tasks/* file contents,",
        f"         {', '.join(sorted(SKIP_CONTENT_FILENAMES))}.",
        "",
    ]

    parts.extend(header_block("SECTION: ARCHITECTURE"))
    parts.append(architecture_section())

    parts.extend(header_block("SECTION: DATABASE"))
    parts.append(database_section())

    parts.extend(header_block("SECTION: PROJECT STRUCTURE (filtered)"))
    parts.append(structure_section(root))

    py_paths = iter_py_files(root)
    parts.extend(header_block(f"SECTION: PYTHON FILES ({len(py_paths)})"))
    for path in py_paths:
        rel = path.relative_to(root).as_posix()
        parts.extend(file_block(rel, read_utf8(path)))

    client_paths = iter_client_source_files(root)
    parts.extend(header_block(f"SECTION: CLIENT SOURCE FILES ({len(client_paths)})"))
    for path in client_paths:
        rel = path.relative_to(root).as_posix()
        parts.extend(file_block(rel, read_utf8(path)))

    cfg_paths = iter_root_config_files(root)
    parts.extend(header_block(f"SECTION: ROOT CONFIG ({len(cfg_paths)})"))
    for path in cfg_paths:
        rel = path.relative_to(root).as_posix()
        parts.extend(file_block(rel, read_utf8(path)))

    return "\n".join(parts).rstrip() + "\n"


def write_to_project_root(root: Path | None = None) -> Path:
    root = (root or Path(__file__).resolve().parent).resolve()
    out = root / OUTPUT_FILENAME
    out.write_text(build_document(root), encoding="utf-8")
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=f"Write {OUTPUT_FILENAME} for AI context.")
    p.add_argument("--root", type=Path, default=None, help="Project root (default: parent of this script).")
    args = p.parse_args()
    root = (args.root or Path(__file__).resolve().parent).resolve()
    if not root.is_dir():
        raise SystemExit(f"Not a directory: {root}")
    out = write_to_project_root(root)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
