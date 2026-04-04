"""
Scan the project directory (folder containing this script), export all .py sources,
banner_data.json, and a directory tree into project_context.txt for AI / tooling context.

Ignores .git and __pycache__ everywhere.

Usage: python export_context.py
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUTPUT_FILE = ROOT / "project_context.txt"

IGNORE_DIRS = frozenset({".git", "__pycache__"})

FILE_HEADER_LINE = "=" * 80


def _tree_lines(directory: Path, prefix: str) -> list[str]:
    lines: list[str] = []
    try:
        entries = [
            p
            for p in directory.iterdir()
            if not (p.is_dir() and p.name in IGNORE_DIRS)
        ]
        entries.sort(key=lambda p: (not p.is_dir(), p.name.lower()))
    except OSError as exc:
        return [f"{prefix}[Error reading directory: {exc}]"]

    for i, entry in enumerate(entries):
        is_last = i == len(entries) - 1
        branch = "└── " if is_last else "├── "
        lines.append(f"{prefix}{branch}{entry.name}")
        if entry.is_dir():
            extension = "    " if is_last else "│   "
            lines.extend(_tree_lines(entry, prefix + extension))
    return lines


def build_project_structure(root: Path) -> str:
    header = f"{root.name}/"
    body_lines = _tree_lines(root, "")
    return header + ("\n" + "\n".join(body_lines) if body_lines else "")


def collect_py_files(root: Path) -> list[Path]:
    paths: list[Path] = []
    root_str = os.fspath(root)
    for dirpath, dirnames, filenames in os.walk(root_str):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for name in filenames:
            if name.endswith(".py"):
                paths.append(Path(dirpath) / name)
    return sorted(paths)


def read_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def file_section(relative_display: str, body: str) -> list[str]:
    return [
        "",
        FILE_HEADER_LINE,
        f"FILE: {relative_display}",
        FILE_HEADER_LINE,
        "",
        body.rstrip("\n"),
        "",
    ]


def main() -> None:
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    chunks: list[str] = [
        "PROJECT CONTEXT EXPORT",
        f"Generated: {generated_at}",
        f"Root directory: {ROOT}",
        "",
        FILE_HEADER_LINE,
        "SECTION: PROJECT STRUCTURE",
        FILE_HEADER_LINE,
        "",
        build_project_structure(ROOT),
    ]

    py_files = collect_py_files(ROOT)
    chunks.append("")
    chunks.append(FILE_HEADER_LINE)
    chunks.append(f"SECTION: PYTHON SOURCES ({len(py_files)} file(s))")
    chunks.append(FILE_HEADER_LINE)

    for py_path in py_files:
        rel = py_path.relative_to(ROOT)
        chunks.extend(file_section(rel.as_posix(), read_text_file(py_path)))

    json_path = ROOT / "banner_data.json"
    chunks.append(FILE_HEADER_LINE)
    chunks.append("SECTION: banner_data.json")
    chunks.append(FILE_HEADER_LINE)
    if json_path.is_file():
        chunks.extend(file_section("banner_data.json", read_text_file(json_path)))
    else:
        chunks.extend(
            file_section(
                "banner_data.json (missing)",
                "[This file was not found in the project root.]",
            )
        )

    OUTPUT_FILE.write_text("\n".join(chunks).rstrip() + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
