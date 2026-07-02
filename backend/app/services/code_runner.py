"""MAG Native Code Runner for code nodes.

The runner drives DeepSeek tool calls and executes file tools in-process so MAG
can enforce file scope, stream structured tool traces, and capture changed files.
"""

from __future__ import annotations
import asyncio
import difflib
import fnmatch
import os
import json
import re
import shlex
import signal
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from openai import APIConnectionError, APIStatusError, AsyncOpenAI

from app.services.providers.base import ProviderError

CODE_DIFF_MAX_BYTES = 200_000
SNAPSHOT_MAX_BYTES = 1_000_000
NATIVE_MAX_TOOL_STEPS = 20
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash"
RUN_COMMAND_MAX_OUTPUT = 30_000
RUN_COMMAND_DEFAULT_TIMEOUT = 60
RUN_COMMAND_MAX_TIMEOUT = 120
RUN_COMMAND_ALLOWLIST: dict[tuple[str, ...], str] = {
    ("npm", "run", "build"): "Build frontend/package scripts",
    ("npm", "test"): "Run npm test",
    ("npm", "run", "test"): "Run npm test script",
    ("pytest",): "Run pytest",
    ("python", "-m", "pytest"): "Run pytest via python",
    ("uv", "run", "pytest"): "Run pytest via uv",
    ("ruff", "check"): "Run ruff check",
    ("ruff", "format", "--check"): "Check ruff formatting",
    ("tsc", "--noEmit"): "Run TypeScript type check",
}


def _allowed_run_commands_text() -> str:
    return ", ".join(" ".join(item) for item in sorted(RUN_COMMAND_ALLOWLIST))

NATIVE_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List project files under an optional relative path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "pattern": {"type": "string"},
                    "limit": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a text file from the project.",
            "parameters": {
                "type": "object",
                "required": ["path"],
                "properties": {"path": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create a new text file or overwrite an existing project file when overwrite=true.",
            "parameters": {
                "type": "object",
                "required": ["path", "content"],
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                    "overwrite": {"type": "boolean"},
                    "createDirs": {"type": "boolean"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Delete a project file. Requires confirm=true.",
            "parameters": {
                "type": "object",
                "required": ["path", "confirm"],
                "properties": {
                    "path": {"type": "string"},
                    "confirm": {"type": "boolean"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_file",
            "description": "Move or rename a project file.",
            "parameters": {
                "type": "object",
                "required": ["sourcePath", "targetPath"],
                "properties": {
                    "sourcePath": {"type": "string"},
                    "targetPath": {"type": "string"},
                    "overwrite": {"type": "boolean"},
                    "createDirs": {"type": "boolean"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mkdir",
            "description": "Create a directory inside the project.",
            "parameters": {
                "type": "object",
                "required": ["path"],
                "properties": {"path": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Run a whitelisted validation command in the project directory.",
            "parameters": {
                "type": "object",
                "required": ["command"],
                "properties": {
                    "command": {"type": "string"},
                    "timeoutSeconds": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_project",
            "description": "Inspect project files to identify languages, package managers, scripts, and suggested validation commands.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grep",
            "description": "Search text files for a literal or regex pattern.",
            "parameters": {
                "type": "object",
                "required": ["pattern"],
                "properties": {
                    "pattern": {"type": "string"},
                    "path": {"type": "string"},
                    "regex": {"type": "boolean"},
                    "limit": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "apply_patch",
            "description": "Replace oldText with newText in a single project file.",
            "parameters": {
                "type": "object",
                "required": ["path", "oldText", "newText"],
                "properties": {
                    "path": {"type": "string"},
                    "oldText": {"type": "string"},
                    "newText": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_diff",
            "description": "Inspect the current changed files and text diff.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish",
            "description": "Finish the code run with a concise summary.",
            "parameters": {
                "type": "object",
                "required": ["summary"],
                "properties": {"summary": {"type": "string"}},
            },
        },
    },
]

READ_ONLY_NATIVE_TOOL_NAMES = {"list_files", "read_file", "grep", "inspect_project", "finish"}
READ_ONLY_NATIVE_TOOLS = [
    tool for tool in NATIVE_TOOLS
    if tool["function"]["name"] in READ_ONLY_NATIVE_TOOL_NAMES
]

_ACTIVE_CLAUDE_RUNS: dict[str, asyncio.subprocess.Process] = {}
_CANCELLED_NATIVE_RUNS: set[str] = set()


def _normalize_rel_path(path: str) -> str | None:
    rel = path.replace("\\", "/").strip()
    if not rel or rel.startswith("/") or rel.startswith("../") or "/../" in rel:
        return None
    if rel.startswith(".mag_") or "/.mag_" in rel or rel.startswith(".git/"):
        return None
    return rel


def _is_text_bytes(data: bytes) -> bool:
    return b"\x00" not in data


async def _run_git(
    project_dir: str,
    args: list[str],
    *,
    timeout: float = 10,
) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        "git",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=project_dir,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    return (
        proc.returncode or 0,
        stdout.decode("utf-8", "replace"),
        stderr.decode("utf-8", "replace"),
    )


async def _is_git_repo(project_dir: str) -> bool:
    try:
        code, stdout, _ = await _run_git(project_dir, ["rev-parse", "--is-inside-work-tree"])
        return code == 0 and stdout.strip() == "true"
    except Exception:
        return False


async def _git_status_map(project_dir: str) -> dict[str, str]:
    try:
        code, stdout, _ = await _run_git(project_dir, ["status", "--porcelain", "-uall"], timeout=10)
        if code != 0:
            return {}
        statuses: dict[str, str] = {}
        for line in stdout.splitlines():
            if not line:
                continue
            status_code = line[:2].strip()
            path = line[3:].strip()
            if " -> " in path:
                path = path.rsplit(" -> ", 1)[1]
            rel = _normalize_rel_path(path.strip('"'))
            if rel:
                statuses[rel] = status_code
        return statuses
    except Exception:
        return {}


def _read_text_snapshot(project_dir: str, rel_path: str) -> str | None:
    rel = _normalize_rel_path(rel_path)
    if not rel:
        return None
    abs_path = os.path.abspath(os.path.join(project_dir, rel))
    root = os.path.abspath(project_dir)
    if not (abs_path == root or abs_path.startswith(root + os.sep)):
        return None
    if not os.path.isfile(abs_path):
        return ""
    try:
        if os.path.getsize(abs_path) > SNAPSHOT_MAX_BYTES:
            return None
        with open(abs_path, "rb") as f:
            data = f.read()
        if not _is_text_bytes(data):
            return None
        return data.decode("utf-8", "replace")
    except OSError:
        return None


async def _git_head_text(project_dir: str, rel_path: str) -> str | None:
    rel = _normalize_rel_path(rel_path)
    if not rel:
        return None
    try:
        code, stdout, _ = await _run_git(project_dir, ["show", f"HEAD:{rel}"], timeout=10)
        if code != 0:
            return None
        return stdout
    except Exception:
        return None


async def _snapshot_dirty_files(project_dir: str, status_map: dict[str, str]) -> dict[str, str | None]:
    snapshots: dict[str, str | None] = {}
    for rel in status_map:
        snapshots[rel] = _read_text_snapshot(project_dir, rel)
    return snapshots


def _log_claude(run_id: str, status: str, detail: str = "") -> None:
    suffix = f" {detail}" if detail else ""
    print(f"[ClaudeCode][{run_id}] {status}{suffix}", file=sys.stderr, flush=True)


async def _kill_process_tree(proc: asyncio.subprocess.Process, run_id: str) -> bool:
    if proc.returncode is not None:
        return False

    pid = proc.pid
    _log_claude(run_id, "CANCEL", f"terminating pid={pid}")
    try:
        if os.name == "nt":
            killer = await asyncio.create_subprocess_exec(
                "taskkill", "/PID", str(pid), "/T", "/F",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await killer.communicate()
        else:
            os.killpg(pid, signal.SIGTERM)

        try:
            await asyncio.wait_for(proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            if os.name == "nt":
                proc.kill()
            else:
                os.killpg(pid, signal.SIGKILL)
            await proc.wait()
        _log_claude(run_id, "CANCELLED", f"pid={pid}")
        return True
    except ProcessLookupError:
        return False


async def cancel_claude_run(run_id: str) -> bool:
    proc = _ACTIVE_CLAUDE_RUNS.get(run_id)
    if proc is None:
        _log_claude(run_id, "CANCEL_MISS")
        return False
    return await _kill_process_tree(proc, run_id)


async def cancel_code_run(run_id: str) -> bool:
    _CANCELLED_NATIVE_RUNS.add(run_id)
    proc = _ACTIVE_CLAUDE_RUNS.get(run_id)
    if proc is not None:
        return await _kill_process_tree(proc, run_id)
    return True


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _marker(name: str, payload: object) -> str:
    return f"__{name}__:{json.dumps(payload, ensure_ascii=False)}"


def _mtime_after_marker(project_dir: str, rel_path: str, before_marker_file: str | None) -> bool:
    if not before_marker_file or not os.path.exists(before_marker_file):
        return False
    rel = _normalize_rel_path(rel_path)
    if not rel:
        return False
    try:
        abs_path = os.path.join(project_dir, rel)
        return os.path.exists(abs_path) and os.path.getmtime(abs_path) > os.path.getmtime(before_marker_file)
    except OSError:
        return False


def _status_prefix(status_code: str) -> str:
    if status_code in {"??", "A", "AM"}:
        return "+"
    if status_code == "D":
        return "-"
    if status_code.startswith("R"):
        return "R"
    if status_code:
        return "~"
    return "~"


async def _detect_changed_files(
    project_dir: str,
    before_marker_file: str | None,
    before_status: dict[str, str] | None = None,
) -> list[str]:
    """Return files created or modified since before_marker was written.

    Prefers git status before/after comparison; falls back to checking mtime.
    """
    # Git-based detection. Compare before/after status and mtime to avoid
    # reporting unrelated dirty files that existed before this run.
    if await _is_git_repo(project_dir):
        try:
            before_status = before_status or {}
            after_status = await _git_status_map(project_dir)
            files: list[str] = []
            for path in sorted(set(before_status) | set(after_status)):
                rel = _normalize_rel_path(path)
                if not rel:
                    continue
                before = before_status.get(rel)
                after = after_status.get(rel)
                if before == after and not _mtime_after_marker(project_dir, rel, before_marker_file):
                    continue
                files.append(f"{_status_prefix(after or before or 'M')} {rel}")
            return files
        except Exception:
            pass

    # Timestamp-based fallback
    if before_marker_file and os.path.exists(before_marker_file):
        try:
            ref_mtime = os.path.getmtime(before_marker_file)
            changed: list[str] = []
            for root, dirs, filenames in os.walk(project_dir):
                dirs[:] = [d for d in dirs if not d.startswith(".") and d != "node_modules"]
                for f in filenames:
                    fp = os.path.join(root, f)
                    try:
                        if os.path.getmtime(fp) > ref_mtime:
                            rel = os.path.relpath(fp, project_dir)
                            changed.append(f"+ {rel}")
                    except OSError:
                        pass
            return changed
        except Exception:
            pass

    return []


def _extract_changed_rel_paths(changed_files: list[str]) -> list[str]:
    rels: list[str] = []
    for item in changed_files:
        rel = item[2:].strip() if len(item) > 2 and item[1] == " " else item.strip()
        normalized = _normalize_rel_path(rel)
        if normalized:
            rels.append(normalized)
    return rels


def _append_limited(parts: list[str], text: str, max_bytes: int) -> bool:
    current = sum(len(part.encode("utf-8", "replace")) for part in parts)
    remaining = max_bytes - current
    if remaining <= 0:
        return True
    data = text.encode("utf-8", "replace")
    if len(data) <= remaining:
        parts.append(text)
        return False
    parts.append(data[:remaining].decode("utf-8", "replace"))
    return True


async def _capture_code_diff(
    project_dir: str,
    changed_files: list[str],
    before_status: dict[str, str],
    before_snapshots: dict[str, str | None],
) -> dict[str, object]:
    warnings: list[str] = []
    if not await _is_git_repo(project_dir):
        return {
            "available": False,
            "isGitRepo": False,
            "changedFiles": changed_files,
            "diff": "",
            "truncated": False,
            "warnings": ["Diff capture requires a Git working tree."],
        }

    after_status = await _git_status_map(project_dir)
    parts: list[str] = []
    truncated = False
    for rel in _extract_changed_rel_paths(changed_files):
        if rel in before_snapshots:
            before_text = before_snapshots[rel]
        elif after_status.get(rel) == "??":
            before_text = ""
        else:
            before_text = await _git_head_text(project_dir, rel)
            if before_text is None:
                before_text = ""

        after_text = _read_text_snapshot(project_dir, rel)
        if before_text is None or after_text is None:
            warnings.append(f"Skipped binary or large file diff: {rel}")
            continue

        if before_text == after_text:
            continue

        diff = "".join(
            difflib.unified_diff(
                before_text.splitlines(keepends=True),
                after_text.splitlines(keepends=True),
                fromfile=f"a/{rel}",
                tofile=f"b/{rel}",
            )
        )
        if not diff:
            continue
        truncated = _append_limited(parts, diff, CODE_DIFF_MAX_BYTES)
        if truncated:
            warnings.append(f"Diff truncated at {CODE_DIFF_MAX_BYTES} bytes.")
            break

    if changed_files and not parts:
        warnings.append("No text diff was captured for files changed during this run.")

    return {
        "available": True,
        "isGitRepo": True,
        "changedFiles": changed_files,
        "diff": "".join(parts),
        "truncated": truncated,
        "warnings": warnings,
    }


def _matches_scope(rel_path: str, patterns: list[str]) -> bool:
    rel = rel_path.replace("\\", "/")
    return any(fnmatch.fnmatch(rel, pattern.replace("\\", "/")) for pattern in patterns)


def _check_scope(rel_path: str, allow: list[str], deny: list[str]) -> None:
    rel = rel_path.replace("\\", "/")
    if not _normalize_rel_path(rel):
        raise ValueError(f"path is not allowed: {rel_path}")
    if deny and _matches_scope(rel, deny):
        raise ValueError(f"path denied by file scope: {rel}")
    if allow and not _matches_scope(rel, allow):
        raise ValueError(f"path is outside file scope allow list: {rel}")


def _resolve_project_path(project_dir: str, path: str, allow: list[str], deny: list[str]) -> tuple[str, str]:
    rel = _normalize_rel_path(path or ".")
    if rel is None:
        raise ValueError(f"path is not allowed: {path}")
    if rel != ".":
        _check_scope(rel, allow, deny)
    root = os.path.abspath(project_dir)
    abs_path = os.path.abspath(os.path.join(root, rel))
    if not (abs_path == root or abs_path.startswith(root + os.sep)):
        raise ValueError(f"path escapes project directory: {path}")
    return rel, abs_path


def _safe_summary(value: object, max_chars: int = 600) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text[:max_chars] + ("..." if len(text) > max_chars else "")


def _capped_output(result: dict[str, Any], max_chars: int = 4000) -> Any:
    """Full structured tool result with large text fields capped, for the trace.

    Lets the UI show/edit real output without shipping huge file contents.
    """
    payload = dict(result)
    if isinstance(payload.get("content"), str) and len(payload["content"]) > max_chars:
        payload["content"] = payload["content"][:max_chars] + "\n... [truncated]"
    if isinstance(payload.get("diff"), dict) and isinstance(payload["diff"].get("diff"), str):
        diff_text = payload["diff"]["diff"]
        if len(diff_text) > max_chars:
            payload["diff"] = {**payload["diff"], "diff": diff_text[:max_chars] + "\n... [truncated]"}
    return payload


def _iter_text_files(project_dir: str, base_abs: str, allow: list[str], deny: list[str]):
    root = os.path.abspath(project_dir)
    if os.path.isfile(base_abs):
        candidates = [base_abs]
    else:
        candidates = []
        for current, dirs, files in os.walk(base_abs):
            dirs[:] = [
                d for d in dirs
                if d not in {".git", "node_modules", "__pycache__"} and not d.startswith(".mag_")
            ]
            for filename in files:
                candidates.append(os.path.join(current, filename))

    for abs_path in candidates:
        try:
            rel = os.path.relpath(abs_path, root).replace("\\", "/")
            _check_scope(rel, allow, deny)
            if os.path.getsize(abs_path) > SNAPSHOT_MAX_BYTES:
                continue
            with open(abs_path, "rb") as f:
                data = f.read(4096)
            if not _is_text_bytes(data):
                continue
            yield rel, abs_path
        except (OSError, ValueError):
            continue


def _tool_list_files(project_dir: str, args: dict[str, Any], allow: list[str], deny: list[str]) -> dict[str, Any]:
    rel, abs_path = _resolve_project_path(project_dir, str(args.get("path") or "."), allow, deny)
    pattern = str(args.get("pattern") or "*")
    limit = int(args.get("limit") or 80)
    if not os.path.exists(abs_path):
        raise ValueError(f"path not found: {rel}")
    root = os.path.abspath(project_dir)
    files: list[str] = []
    for file_rel, _ in _iter_text_files(project_dir, abs_path, allow, deny):
        if fnmatch.fnmatch(os.path.basename(file_rel), pattern) or fnmatch.fnmatch(file_rel, pattern):
            files.append(file_rel)
        if len(files) >= limit:
            break
    return {"files": files, "truncated": len(files) >= limit}


def _tool_read_file(project_dir: str, args: dict[str, Any], allow: list[str], deny: list[str]) -> dict[str, Any]:
    rel, abs_path = _resolve_project_path(project_dir, str(args.get("path") or ""), allow, deny)
    if not os.path.isfile(abs_path):
        raise ValueError(f"file not found: {rel}")
    if os.path.getsize(abs_path) > SNAPSHOT_MAX_BYTES:
        raise ValueError(f"file is too large to read: {rel}")
    with open(abs_path, "rb") as f:
        data = f.read()
    if not _is_text_bytes(data):
        raise ValueError(f"file is binary: {rel}")
    return {"path": rel, "content": data.decode("utf-8", "replace")}


def _tool_grep(project_dir: str, args: dict[str, Any], allow: list[str], deny: list[str]) -> dict[str, Any]:
    pattern = str(args.get("pattern") or "")
    if not pattern:
        raise ValueError("grep pattern is required")
    rel, abs_path = _resolve_project_path(project_dir, str(args.get("path") or "."), allow, deny)
    use_regex = bool(args.get("regex"))
    limit = int(args.get("limit") or 80)
    regex = re.compile(pattern) if use_regex else None
    matches: list[dict[str, Any]] = []
    for file_rel, file_abs in _iter_text_files(project_dir, abs_path, allow, deny):
        try:
            with open(file_abs, "r", encoding="utf-8", errors="replace") as f:
                for lineno, line in enumerate(f, start=1):
                    hit = bool(regex.search(line)) if regex else pattern in line
                    if hit:
                        matches.append({"path": file_rel, "line": lineno, "text": line.rstrip("\n")[:500]})
                        if len(matches) >= limit:
                            return {"matches": matches, "truncated": True}
        except OSError:
            continue
    return {"matches": matches, "truncated": False}


def _tool_apply_patch(project_dir: str, args: dict[str, Any], allow: list[str], deny: list[str]) -> dict[str, Any]:
    rel, abs_path = _resolve_project_path(project_dir, str(args.get("path") or ""), allow, deny)
    old_text = str(args.get("oldText") or "")
    new_text = str(args.get("newText") or "")
    if os.path.exists(abs_path):
        if os.path.getsize(abs_path) > SNAPSHOT_MAX_BYTES:
            raise ValueError(f"file is too large to edit: {rel}")
        with open(abs_path, "rb") as f:
            data = f.read()
        if not _is_text_bytes(data):
            raise ValueError(f"file is binary: {rel}")
        text = data.decode("utf-8", "replace")
    else:
        if old_text:
            raise ValueError(f"file not found for non-empty oldText: {rel}")
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "w", encoding="utf-8", newline="") as f:
            f.write(new_text)
        return {"path": rel, "replacements": 0, "created": True, "affectedFiles": [rel]}
    if not old_text:
        raise ValueError("oldText is required when editing an existing file")
    occurrences = text.count(old_text)
    if occurrences != 1:
        raise ValueError(f"oldText must match exactly once in {rel}; matched {occurrences}")
    updated = text.replace(old_text, new_text, 1)
    with open(abs_path, "w", encoding="utf-8", newline="") as f:
        f.write(updated)
    return {"path": rel, "replacements": 1, "affectedFiles": [rel]}


def _tool_write_file(project_dir: str, args: dict[str, Any], allow: list[str], deny: list[str]) -> dict[str, Any]:
    rel, abs_path = _resolve_project_path(project_dir, str(args.get("path") or ""), allow, deny)
    content = str(args.get("content") or "")
    overwrite = bool(args.get("overwrite"))
    create_dirs = args.get("createDirs")
    should_create_dirs = True if create_dirs is None else bool(create_dirs)
    existed = os.path.exists(abs_path)
    if existed and not os.path.isfile(abs_path):
        raise ValueError(f"path is not a file: {rel}")
    if existed and not overwrite:
        raise ValueError(f"file already exists; pass overwrite=true to replace: {rel}")
    parent = os.path.dirname(abs_path)
    if parent and not os.path.isdir(parent):
        if not should_create_dirs:
            raise ValueError(f"parent directory does not exist: {os.path.dirname(rel)}")
        os.makedirs(parent, exist_ok=True)
    with open(abs_path, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    return {
        "path": rel,
        "created": not existed,
        "overwritten": existed,
        "bytes": len(content.encode("utf-8")),
        "affectedFiles": [rel],
    }


def _tool_delete_file(project_dir: str, args: dict[str, Any], allow: list[str], deny: list[str]) -> dict[str, Any]:
    rel, abs_path = _resolve_project_path(project_dir, str(args.get("path") or ""), allow, deny)
    if not bool(args.get("confirm")):
        raise ValueError("delete_file requires confirm=true")
    if not os.path.isfile(abs_path):
        raise ValueError(f"file not found: {rel}")
    os.remove(abs_path)
    return {"path": rel, "deleted": True, "affectedFiles": [rel]}


def _tool_move_file(project_dir: str, args: dict[str, Any], allow: list[str], deny: list[str]) -> dict[str, Any]:
    source_rel, source_abs = _resolve_project_path(project_dir, str(args.get("sourcePath") or ""), allow, deny)
    target_rel, target_abs = _resolve_project_path(project_dir, str(args.get("targetPath") or ""), allow, deny)
    overwrite = bool(args.get("overwrite"))
    create_dirs = args.get("createDirs")
    should_create_dirs = True if create_dirs is None else bool(create_dirs)
    if not os.path.isfile(source_abs):
        raise ValueError(f"source file not found: {source_rel}")
    if os.path.exists(target_abs) and not overwrite:
        raise ValueError(f"target already exists; pass overwrite=true to replace: {target_rel}")
    parent = os.path.dirname(target_abs)
    if parent and not os.path.isdir(parent):
        if not should_create_dirs:
            raise ValueError(f"target parent directory does not exist: {os.path.dirname(target_rel)}")
        os.makedirs(parent, exist_ok=True)
    os.replace(source_abs, target_abs)
    return {
        "sourcePath": source_rel,
        "targetPath": target_rel,
        "moved": True,
        "affectedFiles": [source_rel, target_rel],
    }


def _tool_mkdir(project_dir: str, args: dict[str, Any], allow: list[str], deny: list[str]) -> dict[str, Any]:
    rel, abs_path = _resolve_project_path(project_dir, str(args.get("path") or ""), allow, deny)
    existed = os.path.isdir(abs_path)
    if os.path.exists(abs_path) and not existed:
        raise ValueError(f"path exists and is not a directory: {rel}")
    os.makedirs(abs_path, exist_ok=True)
    return {"path": rel, "created": not existed, "affectedFiles": []}


def _parse_allowed_command(command: str) -> tuple[list[str], tuple[str, ...]]:
    if not command.strip():
        raise ValueError("run_command command is required")
    if re.search(r"[|&;<>()`$]", command):
        raise ValueError(
            "run_command does not allow shell operators, cd, pipes, or chained commands. "
            "Commands already run in the project directory. "
            f"Use one allowed command exactly: {_allowed_run_commands_text()}"
        )
    try:
        tokens = shlex.split(command, posix=os.name != "nt")
    except ValueError as e:
        raise ValueError(f"invalid command: {e}") from e
    if not tokens:
        raise ValueError("run_command command is required")
    normalized = tuple("npm" if token.lower() == "npm.cmd" else token for token in tokens)
    if normalized not in RUN_COMMAND_ALLOWLIST:
        raise ValueError(f"command is not whitelisted: {command}. Allowed: {_allowed_run_commands_text()}")
    argv = list(normalized)
    if os.name == "nt" and argv[0] == "npm":
        argv[0] = "npm.cmd"
    return argv, normalized


async def _tool_run_command(project_dir: str, args: dict[str, Any]) -> dict[str, Any]:
    command = str(args.get("command") or "")
    argv, normalized = _parse_allowed_command(command)
    timeout = int(args.get("timeoutSeconds") or RUN_COMMAND_DEFAULT_TIMEOUT)
    timeout = max(1, min(timeout, RUN_COMMAND_MAX_TIMEOUT))
    started = datetime.now(timezone.utc)
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=project_dir,
    )
    timed_out = False
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        timed_out = True
        proc.kill()
        stdout, stderr = await proc.communicate()
    finished = datetime.now(timezone.utc)
    stdout_text = stdout.decode("utf-8", "replace")
    stderr_text = stderr.decode("utf-8", "replace")
    if len(stdout_text) > RUN_COMMAND_MAX_OUTPUT:
        stdout_text = stdout_text[:RUN_COMMAND_MAX_OUTPUT] + "\n... [truncated]"
    if len(stderr_text) > RUN_COMMAND_MAX_OUTPUT:
        stderr_text = stderr_text[:RUN_COMMAND_MAX_OUTPUT] + "\n... [truncated]"
    return {
        "command": " ".join(normalized),
        "exitCode": proc.returncode,
        "timedOut": timed_out,
        "durationMs": int((finished - started).total_seconds() * 1000),
        "stdout": stdout_text,
        "stderr": stderr_text,
    }


def _read_json_file(path: str) -> dict[str, Any] | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            value = json.load(f)
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _tool_inspect_project(project_dir: str) -> dict[str, Any]:
    root_files = sorted(
        name for name in os.listdir(project_dir)
        if not name.startswith(".mag_") and name != ".git"
    )
    markers = {
        "package.json": os.path.exists(os.path.join(project_dir, "package.json")),
        "pnpm-lock.yaml": os.path.exists(os.path.join(project_dir, "pnpm-lock.yaml")),
        "yarn.lock": os.path.exists(os.path.join(project_dir, "yarn.lock")),
        "package-lock.json": os.path.exists(os.path.join(project_dir, "package-lock.json")),
        "pyproject.toml": os.path.exists(os.path.join(project_dir, "pyproject.toml")),
        "requirements.txt": os.path.exists(os.path.join(project_dir, "requirements.txt")),
        "uv.lock": os.path.exists(os.path.join(project_dir, "uv.lock")),
        "Cargo.toml": os.path.exists(os.path.join(project_dir, "Cargo.toml")),
    }
    languages: list[str] = []
    if markers["package.json"]:
        languages.append("javascript/typescript")
    if markers["pyproject.toml"] or markers["requirements.txt"] or markers["uv.lock"]:
        languages.append("python")
    if markers["Cargo.toml"]:
        languages.append("rust")

    package_manager = None
    if markers["pnpm-lock.yaml"]:
        package_manager = "pnpm"
    elif markers["yarn.lock"]:
        package_manager = "yarn"
    elif markers["package-lock.json"] or markers["package.json"]:
        package_manager = "npm"
    elif markers["uv.lock"]:
        package_manager = "uv"

    scripts: dict[str, str] = {}
    package_json = _read_json_file(os.path.join(project_dir, "package.json"))
    if package_json and isinstance(package_json.get("scripts"), dict):
        scripts = {str(k): str(v) for k, v in package_json["scripts"].items()}

    suggested_commands: list[str] = []
    if "build" in scripts:
        suggested_commands.append("npm run build")
    if "test" in scripts:
        suggested_commands.append("npm test")
    if markers["uv.lock"]:
        suggested_commands.append("uv run pytest")
    elif markers["pyproject.toml"] or markers["requirements.txt"]:
        suggested_commands.append("pytest")

    return {
        "rootFiles": root_files[:120],
        "rootFilesTruncated": len(root_files) > 120,
        "markers": markers,
        "languages": languages,
        "packageManager": package_manager,
        "scripts": scripts,
        "suggestedCommands": suggested_commands,
        "allowedCommands": [" ".join(item) for item in sorted(RUN_COMMAND_ALLOWLIST)],
    }


async def _tool_get_diff(
    project_dir: str,
    before_status: dict[str, str],
    before_snapshots: dict[str, str | None],
    marker: str | None,
) -> dict[str, Any]:
    changed = await _detect_changed_files(project_dir, marker, before_status)
    diff_info = await _capture_code_diff(project_dir, changed, before_status, before_snapshots)
    return {"changedFiles": changed, "diff": diff_info}


async def _execute_native_tool(
    *,
    tool_name: str,
    args: dict[str, Any],
    project_dir: str,
    allow: list[str],
    deny: list[str],
    before_status: dict[str, str],
    before_snapshots: dict[str, str | None],
    marker: str | None,
) -> tuple[dict[str, Any], list[str]]:
    if tool_name == "list_files":
        result = _tool_list_files(project_dir, args, allow, deny)
        return result, []
    if tool_name == "read_file":
        result = _tool_read_file(project_dir, args, allow, deny)
        return result, []
    if tool_name == "grep":
        result = _tool_grep(project_dir, args, allow, deny)
        return result, []
    if tool_name == "apply_patch":
        result = _tool_apply_patch(project_dir, args, allow, deny)
        return result, list(result.get("affectedFiles", []))
    if tool_name == "write_file":
        result = _tool_write_file(project_dir, args, allow, deny)
        return result, list(result.get("affectedFiles", []))
    if tool_name == "delete_file":
        result = _tool_delete_file(project_dir, args, allow, deny)
        return result, list(result.get("affectedFiles", []))
    if tool_name == "move_file":
        result = _tool_move_file(project_dir, args, allow, deny)
        return result, list(result.get("affectedFiles", []))
    if tool_name == "mkdir":
        result = _tool_mkdir(project_dir, args, allow, deny)
        return result, list(result.get("affectedFiles", []))
    if tool_name == "run_command":
        result = await _tool_run_command(project_dir, args)
        return result, []
    if tool_name == "inspect_project":
        result = _tool_inspect_project(project_dir)
        return result, []
    if tool_name == "get_diff":
        result = await _tool_get_diff(project_dir, before_status, before_snapshots, marker)
        return result, list(result.get("changedFiles", []))
    if tool_name == "finish":
        return {"summary": str(args.get("summary") or "Done.")}, []
    raise ValueError(f"unknown native code tool: {tool_name}")


def _build_native_user_message(
    *,
    node_title: str,
    node_type: str,
    node_purpose: str,
    project_dir: str,
    file_scope_allow: list[str],
    file_scope_deny: list[str],
    parent_outputs: dict[str, str] | None,
    user_prompt: str | None,
    context_mode: str,
    memory_text: str | None,
    system_prompt: str | None,
    read_only: bool = False,
) -> str:
    mode = context_mode if context_mode in {"inherit", "explicit", "isolated"} else "inherit"
    parent_context = ""
    if mode == "inherit" and parent_outputs:
        parent_context = "\n\n".join(
            f"### {key}\n{text[:1200]}{'...' if len(text) > 1200 else ''}"
            for key, text in parent_outputs.items()
        )
    memory_context = ""
    if mode == "inherit" and memory_text and memory_text.strip():
        memory_context = memory_text.strip()[:2000]
        if len(memory_text.strip()) > 2000:
            memory_context += "..."
    default_task = (
        f"Analyze the code task for node: {node_title}"
        if read_only
        else f"Implement the code task for node: {node_title}"
    )
    task = user_prompt.strip() if user_prompt and user_prompt.strip() else default_task
    if node_purpose:
        task += f"\nPurpose: {node_purpose}"
    return "\n".join([
        f"Node: {node_title}",
        f"Type: {node_type}",
        f"Project directory: {project_dir}",
        f"Context mode: {mode}",
        "",
        "System prompt:",
        system_prompt.strip() if system_prompt and system_prompt.strip()
        else (
            "Analyze the project without changing files. Output relevant modules, implementation entry points, "
            "suggested files to change, risks, acceptance checks, and concrete guidance for the next Code node."
            if read_only
            else "Complete the implementation safely."
        ),
        "",
        "Task:",
        task,
        "",
        "File scope allow:",
        "\n".join(f"- {item}" for item in file_scope_allow) if file_scope_allow else "- all project files",
        "",
        "File scope deny:",
        "\n".join(f"- {item}" for item in file_scope_deny) if file_scope_deny else "- none",
        "",
        "Upstream outputs:",
        parent_context or "(none)",
        "",
        "Memory:",
        memory_context or "(none)",
    ])


def _compact_tool_result(result: dict[str, Any]) -> str:
    payload = dict(result)
    if isinstance(payload.get("content"), str) and len(payload["content"]) > 30000:
        payload["content"] = payload["content"][:30000] + "\n... [truncated]"
    if isinstance(payload.get("diff"), dict) and isinstance(payload["diff"].get("diff"), str):
        diff_text = payload["diff"]["diff"]
        if len(diff_text) > 30000:
            payload["diff"] = {**payload["diff"], "diff": diff_text[:30000] + "\n... [truncated]"}
    return json.dumps(payload, ensure_ascii=False)


async def run_node_native_code(
    *,
    node_title: str,
    node_type: str,
    node_purpose: str,
    project_dir: str,
    file_scope_allow: list[str] | None = None,
    file_scope_deny: list[str] | None = None,
    parent_outputs: dict[str, str] | None = None,
    user_prompt: str | None = None,
    context_mode: str = "inherit",
    memory_text: str | None = None,
    system_prompt: str | None = None,
    provider: str | None = "deepseek",
    model: str | None = None,
    api_key: str | None = None,
    run_id: str | None = None,
    read_only: bool = False,
) -> AsyncIterator[str]:
    effective_run_id = run_id or f"native-{uuid.uuid4().hex[:8]}"
    chosen_provider = (provider or "deepseek").lower()
    if chosen_provider != "deepseek":
        raise ProviderError("MAG Native Code Runner v1 only supports provider=deepseek")
    api_key = api_key or os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise ProviderError("DEEPSEEK_API_KEY not set")
    if not os.path.isdir(project_dir):
        yield f"[error] 瀹搞儳鈻奸惄顔肩秿娑撳秴鐡ㄩ崷? {project_dir}\n"
        return

    allow = file_scope_allow or []
    deny = file_scope_deny or []
    before_status = await _git_status_map(project_dir) if (not read_only and await _is_git_repo(project_dir)) else {}
    before_snapshots = await _snapshot_dirty_files(project_dir, before_status) if before_status else {}
    marker = None
    if not read_only:
        marker = os.path.join(project_dir, ".mag_code_run_marker")
        try:
            with open(marker, "w", encoding="utf-8") as f:
                f.write("marker")
        except OSError:
            marker = None

    client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    tools = READ_ONLY_NATIVE_TOOLS if read_only else NATIVE_TOOLS
    system_content = (
        "You are MAG Native Code Runner in read-only analysis mode. Work only through the provided tools. "
        "Do not create, modify, delete, move, format, install, build, or test files. "
        "Use inspect_project, list_files, grep, and read_file to understand the project. "
        "Call finish with a concise Chinese Markdown analysis when done."
        if read_only
        else (
            "You are MAG Native Code Runner. Work only through the provided tools. "
            "Do not ask the user to edit files manually. Use apply_patch or write_file for changes. "
            "Use run_command only for whitelisted validation commands, exactly as listed by inspect_project. "
            "run_command already executes in the project directory; never include cd, paths, shell operators, "
            "pipes, or chained commands such as &&. "
            "Use inspect_project when you need to discover project type or validation commands. "
            "Call finish with a concise summary when done."
        )
    )
    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": system_content,
        },
        {
            "role": "user",
            "content": _build_native_user_message(
                node_title=node_title,
                node_type=node_type,
                node_purpose=node_purpose,
                project_dir=project_dir,
                file_scope_allow=allow,
                file_scope_deny=deny,
                parent_outputs=parent_outputs,
                user_prompt=user_prompt,
                context_mode=context_mode,
                memory_text=memory_text,
                system_prompt=system_prompt,
                read_only=read_only,
            ),
        },
    ]

    changed: list[str] = []
    diff_info: dict[str, Any] = {
        "available": False,
        "isGitRepo": False,
        "changedFiles": [],
        "diff": "",
        "truncated": False,
        "warnings": [],
    }
    finished = False
    step = 0

    try:
        yield _marker("log", {
            "level": "info",
            "source": "code",
            "status": "START",
            "message": "MAG Native Code Runner started (read-only)." if read_only else "MAG Native Code Runner started (DeepSeek tool calls).",
        })
        for _ in range(NATIVE_MAX_TOOL_STEPS):
            if effective_run_id in _CANCELLED_NATIVE_RUNS:
                raise asyncio.CancelledError()

            try:
                resp = await client.chat.completions.create(
                    model=model or DEEPSEEK_DEFAULT_MODEL,
                    messages=messages,
                    tools=tools,
                    tool_choice="auto",
                    temperature=0.1,
                )
            except (APIStatusError, APIConnectionError) as e:
                raise ProviderError(f"deepseek API error: {e}") from e

            usage = getattr(resp, "usage", None)
            if usage:
                yield _marker("usage", {
                    "inputTokens": getattr(usage, "prompt_tokens", None),
                    "outputTokens": getattr(usage, "completion_tokens", None),
                })

            msg = resp.choices[0].message
            assistant_msg = msg.model_dump(exclude_none=True)
            messages.append(assistant_msg)

            content = msg.content or ""
            if content.strip():
                yield content
                if not getattr(msg, "tool_calls", None):
                    finished = True
                    break

            tool_calls = getattr(msg, "tool_calls", None) or []
            if not tool_calls:
                finished = True
                break

            for call in tool_calls:
                if effective_run_id in _CANCELLED_NATIVE_RUNS:
                    raise asyncio.CancelledError()
                step += 1
                tool_name = call.function.name
                raw_args = call.function.arguments or "{}"
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
                except (TypeError, json.JSONDecodeError):
                    args = {}
                trace = {
                    "id": call.id or f"tool-{step}",
                    "step": step,
                    "tool": tool_name,
                    "status": "running",
                    "startedAt": _utc_now(),
                    "input": args,
                }
                yield _marker("tool_start", trace)
                yield _marker("log", {
                    "level": "info",
                    "source": "code",
                    "status": "TOOL",
                    "message": f"{step}. {tool_name}",
                })

                try:
                    result, affected = await _execute_native_tool(
                        tool_name=tool_name,
                        args=args,
                        project_dir=project_dir,
                        allow=allow,
                        deny=deny,
                        before_status=before_status,
                        before_snapshots=before_snapshots,
                        marker=marker,
                    )
                    if tool_name == "get_diff":
                        changed = list(result.get("changedFiles", []))
                        diff_info = dict(result.get("diff", diff_info))
                    if tool_name == "finish":
                        finished = True
                        summary = str(result.get("summary") or "Done.")
                        yield summary + "\n"
                    trace_result = {
                        **trace,
                        "status": "done",
                        "finishedAt": _utc_now(),
                        "outputSummary": _safe_summary(result),
                        "output": _capped_output(result),
                        "affectedFiles": affected,
                    }
                    yield _marker("tool_result", trace_result)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": _compact_tool_result(result),
                    })
                    if finished:
                        break
                except Exception as e:  # noqa: BLE001
                    error_result = {"error": str(e)}
                    trace_result = {
                        **trace,
                        "status": "error",
                        "finishedAt": _utc_now(),
                        "error": str(e),
                    }
                    yield _marker("tool_result", trace_result)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": json.dumps(error_result, ensure_ascii=False),
                    })
            if finished:
                break

        if not finished:
            raise ProviderError(f"Native code runner reached max tool steps ({NATIVE_MAX_TOOL_STEPS})")

        if not read_only:
            changed = await _detect_changed_files(project_dir, marker, before_status)
            diff_info = await _capture_code_diff(project_dir, changed, before_status, before_snapshots)
    except asyncio.CancelledError:
        yield "\n[cancelled] Native code run cancelled.\n"
        raise
    finally:
        _CANCELLED_NATIVE_RUNS.discard(effective_run_id)
        if marker:
            try:
                os.remove(marker)
            except OSError:
                pass

    if not read_only:
        yield _marker("files", changed)
        yield _marker("diff", diff_info)


async def replay_tool_sequence(
    *,
    project_dir: str,
    file_scope_allow: list[str] | None = None,
    file_scope_deny: list[str] | None = None,
    steps: list[dict[str, Any]],
    run_id: str | None = None,
) -> AsyncIterator[str]:
    """Deterministically replay a recorded tool sequence WITHOUT any LLM.

    Each step is {id?, tool, input}. Args are self-contained (as recorded), so
    no inter-step data wiring is needed. Emits the same markers as a real code
    run (tool_start/tool_result/files/diff/log) so the UI path is identical.
    """
    effective_run_id = run_id or f"replay-{uuid.uuid4().hex[:8]}"
    if not os.path.isdir(project_dir):
        yield f"[error] project directory not found: {project_dir}\n"
        return

    allow = file_scope_allow or []
    deny = file_scope_deny or []
    before_status = await _git_status_map(project_dir) if await _is_git_repo(project_dir) else {}
    before_snapshots = await _snapshot_dirty_files(project_dir, before_status) if before_status else {}
    marker = os.path.join(project_dir, ".mag_code_run_marker")
    try:
        with open(marker, "w", encoding="utf-8") as f:
            f.write("marker")
    except OSError:
        marker = None

    changed: list[str] = []
    diff_info: dict[str, Any] = {
        "available": False,
        "isGitRepo": False,
        "changedFiles": [],
        "diff": "",
        "truncated": False,
        "warnings": [],
    }
    # Accumulated results per step id, so a step's input args can be bound to an
    # upstream step's output field (data binding via port edges).
    results_by_id: dict[str, Any] = {}

    def _apply_bindings(args: dict[str, Any], step: dict[str, Any]) -> dict[str, Any]:
        bindings = step.get("bindings") or []
        for b in bindings:
            src = results_by_id.get(str(b.get("sourceStepId") or ""))
            if not isinstance(src, dict):
                continue
            field = str(b.get("sourceField") or "")
            target = str(b.get("targetArg") or "")
            if field in src and target:
                args[target] = src[field]
        return args

    try:
        yield "MAG tool replay started (no LLM).\n"
        for index, step in enumerate(steps, start=1):
            if effective_run_id in _CANCELLED_NATIVE_RUNS:
                raise asyncio.CancelledError()

            step_id = str(step.get("id") or f"replay-{index}")
            tool_name = str(step.get("tool") or "")
            raw_input = step.get("input")
            args = dict(raw_input) if isinstance(raw_input, dict) else {}
            args = _apply_bindings(args, step)  # upstream outputs override literals
            trace = {
                "id": step_id,
                "step": index,
                "tool": tool_name,
                "status": "running",
                "startedAt": _utc_now(),
                "input": args,
            }
            yield _marker("tool_start", trace)
            yield _marker("log", {
                "level": "info",
                "source": "code",
                "status": "REPLAY",
                "message": f"{index}. {tool_name}",
            })

            if tool_name == "value":
                # Constant/parameter node: emits its literal so downstream
                # input ports can bind to it. No file access.
                value_result = {"value": args.get("value")}
                results_by_id[step_id] = value_result
                yield _marker("tool_result", {
                    **trace,
                    "status": "done",
                    "finishedAt": _utc_now(),
                    "outputSummary": _safe_summary(value_result),
                    "output": value_result,
                    "affectedFiles": [],
                })
                continue

            if tool_name == "finish":
                # Terminal no-op in replay; record and stop.
                summary_result = {"summary": args.get("summary") or "Done."}
                results_by_id[step_id] = summary_result
                yield _marker("tool_result", {
                    **trace,
                    "status": "done",
                    "finishedAt": _utc_now(),
                    "outputSummary": _safe_summary(summary_result),
                    "output": summary_result,
                    "affectedFiles": [],
                })
                break

            try:
                result, affected = await _execute_native_tool(
                    tool_name=tool_name,
                    args=args,
                    project_dir=project_dir,
                    allow=allow,
                    deny=deny,
                    before_status=before_status,
                    before_snapshots=before_snapshots,
                    marker=marker,
                )
                results_by_id[step_id] = result
                yield _marker("tool_result", {
                    **trace,
                    "status": "done",
                    "finishedAt": _utc_now(),
                    "outputSummary": _safe_summary(result),
                    "output": _capped_output(result),
                    "affectedFiles": affected,
                })
            except Exception as e:  # noqa: BLE001
                yield _marker("tool_result", {
                    **trace,
                    "status": "error",
                    "finishedAt": _utc_now(),
                    "error": str(e),
                })

        changed = await _detect_changed_files(project_dir, marker, before_status)
        diff_info = await _capture_code_diff(project_dir, changed, before_status, before_snapshots)
    except asyncio.CancelledError:
        yield "\n[cancelled] Tool replay cancelled.\n"
        raise
    finally:
        _CANCELLED_NATIVE_RUNS.discard(effective_run_id)
        if marker:
            try:
                os.remove(marker)
            except OSError:
                pass

    yield _marker("files", changed)
    yield _marker("diff", diff_info)
