"""
Export project context for AI assistants and other tools.

Scans the *current working directory* (where you run the command) and writes
``project_context.txt`` with:

  - A tree of the project structure
  - The full text of every ``.py`` file (recursive)
  - The contents of every ``banner_data.json`` found (recursive)

Always ignored: ``.git``, ``__pycache__`` (as requested).

Also skipped so the export stays usable (huge / non-source trees): ``node_modules``,
``.venv``, ``venv``, ``dist``, ``build``, ``.eggs``, and directories whose names end with
``.egg-info``.

Usage (from the project folder):

    cd c:\\path\\to\\your\\project
    python path/to/export_context.py

To scan the folder that contains this script instead of cwd:

    python export_context.py --root .
"""

from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

RULE = "=" * 80
IGNORE_DIR_NAMES = frozenset({
    ".git",
    "__pycache__",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    ".eggs",
})
OUTPUT_NAME = "project_context.txt"


def _dir_skipped(name: str) -> bool:
    if name in IGNORE_DIR_NAMES:
        return True
    if name.endswith(".egg-info"):
        return True
    return False


def project_tree_lines(directory: Path, prefix: str = "") -> list[str]:
    """ASCII tree of files and dirs under ``directory``, skipping ignored dirs."""
    lines: list[str] = []
    try:
        children = sorted(
            [p for p in directory.iterdir() if not _dir_skipped(p.name)],
            key=lambda p: (not p.is_dir(), p.name.lower()),
        )
    except OSError as exc:
        return [f"{prefix}[cannot read: {exc}]"]

    for i, path in enumerate(children):
        last = i == len(children) - 1
        branch = "└── " if last else "├── "
        lines.append(f"{prefix}{branch}{path.name}")
        if path.is_dir():
            ext = "    " if last else "│   "
            lines.extend(project_tree_lines(path, prefix + ext))
    return lines


def structure_section(root: Path) -> str:
    top = f"{root.name}/"
    body = project_tree_lines(root)
    return top + ("\n" + "\n".join(body) if body else "")


def walk_filtered(root: Path):
    """Like os.walk but never descends into ignored directory names."""
    root_s = os.fspath(root.resolve())
    for dirpath, dirnames, filenames in os.walk(root_s):
        dirnames[:] = [d for d in dirnames if not _dir_skipped(d)]
        yield dirpath, dirnames, filenames


def iter_py_files(root: Path) -> list[Path]:
    paths: list[Path] = []
    for dirpath, _dirnames, filenames in walk_filtered(root):
        for name in filenames:
            if name.endswith(".py"):
                paths.append(Path(dirpath) / name)
    return sorted(paths)


def iter_banner_data_json(root: Path) -> list[Path]:
    paths: list[Path] = []
    for dirpath, _dirnames, filenames in walk_filtered(root):
        if "banner_data.json" in filenames:
            paths.append(Path(dirpath) / "banner_data.json")
    return sorted(paths)


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


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export project tree + Python + banner_data.json to one text file.")
    p.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Directory to scan (default: current working directory).",
    )
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help=f"Output file path (default: <root>/{OUTPUT_NAME}).",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    root = (args.root or Path.cwd()).resolve()
    out = (args.output or (root / OUTPUT_NAME)).resolve()

    if not root.is_dir():
        raise SystemExit(f"Not a directory: {root}")

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    parts: list[str] = [
        "PROJECT CONTEXT EXPORT",
        f"Generated (UTC): {stamp}",
        f"Root (scanned): {root}",
        f"Output: {out}",
        "",
        "Includes: project structure tree, all .py files under root, and all banner_data.json files.",
        "Ignored: .git, __pycache__, node_modules, venv/.venv, dist, build, .eggs, *.egg-info",
        "",
    ]

    parts.extend(header_block("SECTION: PROJECT STRUCTURE"))
    parts.append(structure_section(root))

    py_paths = iter_py_files(root)
    parts.extend(header_block(f"SECTION: PYTHON FILES ({len(py_paths)} file(s))"))
    for path in py_paths:
        rel = path.relative_to(root).as_posix()
        parts.extend(file_block(rel, read_utf8(path)))

    json_paths = iter_banner_data_json(root)
    parts.extend(header_block(f"SECTION: banner_data.json ({len(json_paths)} file(s))"))
    if json_paths:
        for path in json_paths:
            rel = path.relative_to(root).as_posix()
            parts.extend(file_block(rel, read_utf8(path)))
    else:
        parts.extend(
            file_block(
                "banner_data.json (none found)",
                "[No banner_data.json found under the scanned root.]",
            )
        )

    out.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
