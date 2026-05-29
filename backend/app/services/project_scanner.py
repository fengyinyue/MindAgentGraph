"""Read-only repository scanner for repository context summaries."""

from __future__ import annotations

import fnmatch
import json
import tomllib
from pathlib import Path
from typing import Any

from app.schemas import FileScope, ProjectScanCommand, ProjectScanFile, ProjectScanResult

IGNORE_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "node_modules",
    "dist",
    "build",
    "target",
    ".next",
    ".turbo",
    ".cache",
    "__pycache__",
}

TEXT_EXTENSIONS = {
    ".bat",
    ".c",
    ".cfg",
    ".conf",
    ".cpp",
    ".cs",
    ".css",
    ".env",
    ".go",
    ".h",
    ".html",
    ".ini",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".lock",
    ".lua",
    ".md",
    ".mjs",
    ".py",
    ".rs",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".vue",
    ".yaml",
    ".yml",
}

KEY_FILENAMES = {
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "README.md",
    "readme.md",
    "tsconfig.json",
    "vite.config.ts",
    "vite.config.js",
    "next.config.js",
    "next.config.mjs",
    "tauri.conf.json",
}


def scan_project(
    *,
    project_dir: str,
    purpose: str = "",
    file_scope_allow: list[str] | None = None,
    file_scope_deny: list[str] | None = None,
    max_files: int = 200,
    max_bytes_per_file: int = 4000,
) -> ProjectScanResult:
    root = Path(project_dir).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError(f"projectDir is not a readable directory: {project_dir}")

    allow = file_scope_allow or []
    deny = file_scope_deny or []
    warnings: list[str] = []
    files: list[ProjectScanFile] = []
    stack: set[str] = set()
    commands: list[ProjectScanCommand] = []
    top_level: list[str] = []

    for child in sorted(root.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        if child.name in IGNORE_DIRS:
            continue
        suffix = "/" if child.is_dir() else ""
        top_level.append(f"{child.name}{suffix}")
        if len(top_level) >= 40:
            break

    scanned_count = 0
    for path in _iter_project_files(root):
        rel = _relpath(root, path)
        if not _matches_scope(rel, allow, deny):
            continue
        scanned_count += 1
        if len(files) >= max_files:
            warnings.append(f"Scan truncated after {max_files} files.")
            break

        kind, reason = _classify_file(path, rel)
        if kind:
            files.append(ProjectScanFile(path=rel, kind=kind, reason=reason))

        _detect_stack_from_path(rel, stack)
        if path.name == "package.json":
            _read_package_json(path, stack, commands, warnings, max_bytes_per_file)
        elif path.name == "pyproject.toml":
            _read_pyproject(path, stack, commands, warnings, max_bytes_per_file)
        elif path.name == "Cargo.toml":
            stack.add("Rust")
            commands.append(ProjectScanCommand(name="Rust tests", command="cargo test"))
        elif rel.endswith("src-tauri/tauri.conf.json"):
            stack.add("Tauri")

    if scanned_count == 0:
        warnings.append("No files matched the current FileScope.")

    suggested = _suggest_file_scope(files, purpose)
    summary = _build_summary(
        root=root,
        top_level=top_level,
        files=files,
        stack=sorted(stack),
        commands=commands,
        suggested=suggested,
        warnings=warnings,
    )
    return ProjectScanResult(
        summary=summary,
        files=files[:80],
        detectedStack=sorted(stack),
        suggestedFileScope=suggested,
        commands=commands[:20],
        warnings=warnings,
    )


def _iter_project_files(root: Path):
    for path in sorted(root.rglob("*"), key=lambda p: _relpath(root, p).lower()):
        if not path.is_file():
            continue
        rel_parts = path.relative_to(root).parts
        if any(part in IGNORE_DIRS for part in rel_parts[:-1]):
            continue
        if not _is_probably_text(path):
            continue
        yield path


def _relpath(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def _matches_scope(rel: str, allow: list[str], deny: list[str]) -> bool:
    if allow and not any(fnmatch.fnmatch(rel, pattern) for pattern in allow):
        return False
    return not any(fnmatch.fnmatch(rel, pattern) for pattern in deny)


def _is_probably_text(path: Path) -> bool:
    if path.name in KEY_FILENAMES:
        return True
    return path.suffix.lower() in TEXT_EXTENSIONS


def _classify_file(path: Path, rel: str) -> tuple[str | None, str | None]:
    name = path.name
    if name in KEY_FILENAMES or rel.endswith("src-tauri/tauri.conf.json"):
        return "config", "Project manifest or key configuration"
    if name.lower().startswith("readme"):
        return "docs", "Project documentation"
    if "/test" in f"/{rel.lower()}" or rel.lower().endswith((".spec.ts", ".test.ts", "_test.py")):
        return "test", "Test file"
    if path.suffix.lower() in {".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go"}:
        if any(part in rel.split("/") for part in ("src", "app", "backend", "frontend")):
            return "source", "Source file"
    return None, None


def _detect_stack_from_path(rel: str, stack: set[str]) -> None:
    suffix = Path(rel).suffix.lower()
    if suffix in {".ts", ".tsx"}:
        stack.add("TypeScript")
    if suffix in {".js", ".jsx", ".mjs"}:
        stack.add("JavaScript")
    if suffix == ".py":
        stack.add("Python")
    if suffix == ".rs":
        stack.add("Rust")
    if rel.startswith("frontend/") or rel.endswith(".tsx"):
        stack.add("React")
    if rel.startswith("backend/app/"):
        stack.add("FastAPI")
    if rel.startswith("src-tauri/"):
        stack.add("Tauri")


def _read_limited_text(path: Path, warnings: list[str], max_bytes: int) -> str:
    try:
        raw = path.read_bytes()[:max_bytes]
        return raw.decode("utf-8", errors="replace")
    except OSError as exc:
        warnings.append(f"Could not read {path.name}: {exc}")
        return ""


def _read_package_json(
    path: Path,
    stack: set[str],
    commands: list[ProjectScanCommand],
    warnings: list[str],
    max_bytes: int,
) -> None:
    text = _read_limited_text(path, warnings, max_bytes)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        warnings.append("package.json could not be parsed.")
        return
    deps: dict[str, Any] = {}
    for key in ("dependencies", "devDependencies"):
        value = data.get(key)
        if isinstance(value, dict):
            deps.update(value)
    if "react" in deps:
        stack.add("React")
    if "typescript" in deps:
        stack.add("TypeScript")
    if "@tauri-apps/api" in deps or "@tauri-apps/cli" in deps:
        stack.add("Tauri")
    if "vite" in deps:
        stack.add("Vite")

    scripts = data.get("scripts")
    if isinstance(scripts, dict):
        for name in ("dev", "build", "lint", "test", "typecheck"):
            command = scripts.get(name)
            if isinstance(command, str):
                commands.append(ProjectScanCommand(name=f"npm {name}", command=f"npm run {name}"))


def _read_pyproject(
    path: Path,
    stack: set[str],
    commands: list[ProjectScanCommand],
    warnings: list[str],
    max_bytes: int,
) -> None:
    text = _read_limited_text(path, warnings, max_bytes)
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        warnings.append("pyproject.toml could not be parsed.")
        return
    stack.add("Python")
    project = data.get("project")
    deps = []
    if isinstance(project, dict):
        raw_deps = project.get("dependencies")
        if isinstance(raw_deps, list):
            deps.extend(str(dep).lower() for dep in raw_deps)
    if any("fastapi" in dep for dep in deps):
        stack.add("FastAPI")
    commands.append(ProjectScanCommand(name="Python tests", command="uv run pytest"))


def _suggest_file_scope(files: list[ProjectScanFile], purpose: str) -> FileScope:
    allow: list[str] = []
    lower = purpose.lower()
    if any(word in lower for word in ("frontend", "ui", "react", "页面", "界面", "前端")):
        allow.extend(["frontend/src/**", "shared/**"])
    if any(word in lower for word in ("backend", "api", "fastapi", "后端", "接口")):
        allow.extend(["backend/app/**", "backend/tests/**"])
    if any(word in lower for word in ("tauri", "desktop", "桌面")):
        allow.extend(["src-tauri/**"])
    if not allow:
        for item in files:
            first = item.path.split("/", 1)[0]
            if first in {"frontend", "backend", "shared", "src-tauri"} and f"{first}/**" not in allow:
                allow.append(f"{first}/**")
            if len(allow) >= 4:
                break

    deny = [
        ".git/**",
        "node_modules/**",
        "dist/**",
        "build/**",
        ".venv/**",
        "target/**",
    ]
    return FileScope(allow=allow, deny=deny)


def _build_summary(
    *,
    root: Path,
    top_level: list[str],
    files: list[ProjectScanFile],
    stack: list[str],
    commands: list[ProjectScanCommand],
    suggested: FileScope,
    warnings: list[str],
) -> str:
    key_files = files[:30]
    lines = [
        f"# Repository Context: {root.name}",
        "",
        "## Detected Stack",
        ", ".join(stack) if stack else "Unknown",
        "",
        "## Top-Level Structure",
    ]
    lines.extend(f"- `{name}`" for name in top_level[:30])
    lines.extend(["", "## Key Files"])
    if key_files:
        lines.extend(f"- `{item.path}` ({item.kind}) - {item.reason or 'Relevant project file'}" for item in key_files)
    else:
        lines.append("- No key files found within the current scope.")
    lines.extend(["", "## Suggested FileScope", "Allow:"])
    lines.extend(f"- `{pattern}`" for pattern in suggested.allow) if suggested.allow else lines.append("- `(none)`")
    lines.append("Deny:")
    lines.extend(f"- `{pattern}`" for pattern in suggested.deny)
    lines.extend(["", "## Useful Commands"])
    if commands:
        seen: set[str] = set()
        for command in commands:
            if command.command in seen:
                continue
            seen.add(command.command)
            lines.append(f"- {command.name}: `{command.command}`")
    else:
        lines.append("- No commands detected.")
    if warnings:
        lines.extend(["", "## Warnings"])
        lines.extend(f"- {warning}" for warning in warnings)
    return "\n".join(lines)
