"""Project memory helpers for `.mag/memory/`.

Memory is addressed by a node-level `memoryRef` and is always resolved under
`<projectPath>/memory/` to avoid path traversal.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath


class MemoryRefError(ValueError):
    pass


def _resolve_memory_path(project_path: str | None, memory_ref: str | None) -> Path | None:
    if not project_path or not memory_ref or not memory_ref.strip():
        return None

    ref_text = memory_ref.strip().replace("\\", "/")
    ref = PurePosixPath(ref_text)
    if ref.is_absolute() or ".." in ref.parts:
        raise MemoryRefError(f"invalid memoryRef: {memory_ref}")

    if not ref.suffix:
        ref = ref.with_suffix(".md")

    root = Path(project_path).expanduser().resolve()
    memory_dir = (root / "memory").resolve()
    path = (memory_dir / Path(*ref.parts)).resolve()
    if not path.is_relative_to(memory_dir):
        raise MemoryRefError(f"memoryRef escapes memory dir: {memory_ref}")
    return path


def read_memory(project_path: str | None, memory_ref: str | None) -> str | None:
    path = _resolve_memory_path(project_path, memory_ref)
    if path is None or not path.exists() or not path.is_file():
        return None
    return path.read_text(encoding="utf-8")


def write_memory(
    project_path: str | None,
    memory_ref: str | None,
    content: str,
    *,
    node_title: str,
) -> Path | None:
    if not content.strip():
        return None
    path = _resolve_memory_path(project_path, memory_ref)
    if path is None:
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"# {node_title}\n\n{content.strip()}\n", encoding="utf-8")
    return path
