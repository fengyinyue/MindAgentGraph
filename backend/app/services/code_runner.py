"""Run a node with Claude Code CLI (`claude --print`).

Spawns a `claude` subprocess in the project directory with a node-specific
context (purpose, fileScope, parent outputs).  Streams stdout chunks back.
After the subprocess finishes, detects which files were created/modified
and appends a special marker event so the frontend can show a file list.
"""

from __future__ import annotations
import asyncio
import difflib
import os
import shutil
import signal
import subprocess
import sys
import uuid
from typing import AsyncIterator

CODE_DIFF_MAX_BYTES = 200_000
SNAPSHOT_MAX_BYTES = 1_000_000

CODE_RUN_SYSTEM = """你需要完成以下编程任务。直接执行，不要提问、不要解释、不要等确认。

## 节点系统 Prompt
{system_prompt}

## 任务
{task}
{purpose_hint}

## 工作目录
当前工作目录是：{project_dir}

## ContextMode
{context_mode}

## 文件约束
你**只能**在以下路径操作文件：
{allow_globs}
{banned_section}

## 上游参考
{parent_context}

## Memory
{memory_context}

## 规则
1. 直接调用 write_file / edit / bash 工具完成任务
2. 不要输出"我可以帮你..."之类的解释，直接干活
3. 生成完整可运行的代码
"""


_ACTIVE_CLAUDE_RUNS: dict[str, asyncio.subprocess.Process] = {}


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


def _assemble_prompt(
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
) -> str:
    allow = (
        ", ".join(file_scope_allow)
        if file_scope_allow
        else "**/* (全部 — 未设置文件作用域)"
    )
    banned = ""
    if file_scope_deny:
        banned = "禁止操作以下路径：\n" + "\n".join(
            f"  - 禁止：{g}" for g in file_scope_deny
        )

    mode = context_mode if context_mode in {"inherit", "explicit", "isolated"} else "explicit"
    parent_context = ""
    if mode == "inherit" and parent_outputs:
        for pid, text in parent_outputs.items():
            snippet = text[:800] + ("…" if len(text) > 800 else "")
            parent_context += f"\n上游节点 {pid} 的输出：\n{snippet}\n"

    memory_context = "(无)"
    if mode == "inherit" and memory_text and memory_text.strip():
        memory_context = memory_text.strip()[:1600]
        if len(memory_text.strip()) > 1600:
            memory_context += "…"

    task = user_prompt.strip() if user_prompt and user_prompt.strip() else f"实现 {node_title} 节点的全部代码（{node_purpose}）"
    purpose_hint = ""
    if node_purpose and not (user_prompt and user_prompt.strip()):
        purpose_hint = f"\n具体目标：{node_purpose}"

    return CODE_RUN_SYSTEM.format(
        system_prompt=(system_prompt.strip() if system_prompt and system_prompt.strip() else "按节点职责完成代码生成。"),
        project_dir=project_dir,
        context_mode=mode,
        allow_globs=allow,
        banned_section=banned,
        parent_context=parent_context or "(无)",
        memory_context=memory_context,
        task=task,
        purpose_hint=purpose_hint,
    )


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


async def run_node_with_claude(
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
    model: str | None = None,
    run_id: str | None = None,
) -> AsyncIterator[str]:
    """Yield stdout chunks from ``claude --print``, then final metadata markers."""
    effective_run_id = run_id or f"local-{uuid.uuid4().hex[:8]}"
    _log_claude(effective_run_id, "START", f"node={node_title!r} cwd={project_dir}")
    if not os.path.isdir(project_dir):
        _log_claude(effective_run_id, "ERROR", f"missing cwd={project_dir}")
        yield f"[error] 工程目录不存在: {project_dir}\n"
        return

    prompt = _assemble_prompt(
        node_title=node_title,
        node_type=node_type,
        node_purpose=node_purpose,
        project_dir=project_dir,
        file_scope_allow=file_scope_allow or [],
        file_scope_deny=file_scope_deny or [],
        parent_outputs=parent_outputs,
        user_prompt=user_prompt,
        context_mode=context_mode,
        memory_text=memory_text,
        system_prompt=system_prompt,
    )

    before_status = await _git_status_map(project_dir) if await _is_git_repo(project_dir) else {}
    before_snapshots = await _snapshot_dirty_files(project_dir, before_status) if before_status else {}

    # Marker file for timestamp-based file detection.
    marker = os.path.join(project_dir, ".mag_code_run_marker")
    try:
        with open(marker, "w") as f:
            f.write("marker")
    except OSError:
        marker = None  # can't write? skip file detection

    claude_bin = shutil.which("claude")
    if not claude_bin:
        _log_claude(effective_run_id, "ERROR", "claude command not found")
        # ── fallback: no Claude Code CLI ──
        yield (
            "[fallback] 未找到 `claude` 命令行工具。\n"
            "请安装 Claude Code CLI 或将 claude 加入 PATH。\n\n"
            f"---\n## 节点：{node_title}\n\n"
            f"**类型**：{node_type}\n\n"
            f"**目的**：{node_purpose}\n\n"
            f"**工作目录**：{project_dir}\n\n"
            f"**文件作用域（允许）**：{', '.join(file_scope_allow) if file_scope_allow else '未设置'}\n\n"
            f"**prompt 预览**：\n```\n{prompt[:1200]}\n```\n"
        )
        yield f"__files__:{[]}"
        yield "__diff__:{\"available\":false,\"isGitRepo\":false,\"changedFiles\":[],\"diff\":\"\",\"truncated\":false,\"warnings\":[\"Claude Code CLI was not found.\"]}"
        return

    proc = None
    try:
        args = [claude_bin, "--print", "--dangerously-skip-permissions"]
        if model:
            args += ["--model", model]

        spawn_kwargs = {
            "stdin": asyncio.subprocess.PIPE,
            "stdout": asyncio.subprocess.PIPE,
            "stderr": asyncio.subprocess.PIPE,
            "cwd": project_dir,
            "env": {**os.environ, "NO_COLOR": "1", "CLAUDE_CODE_SIMPLE": "1"},
        }
        if os.name == "nt":
            spawn_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            spawn_kwargs["start_new_session"] = True

        proc = await asyncio.create_subprocess_exec(*args, **spawn_kwargs)
        _ACTIVE_CLAUDE_RUNS[effective_run_id] = proc
        _log_claude(effective_run_id, "RUNNING", f"pid={proc.pid}")
        # Pass prompt via stdin (more reliable than cmdline arg).
        if proc.stdin:
            proc.stdin.write(prompt.encode("utf-8"))
            await proc.stdin.drain()
            proc.stdin.close()

        # Read stdout line-by-line, yield immediately for streaming.
        async for line in proc.stdout:  # type: ignore[attr-defined]
            text = line.decode("utf-8", "replace")
            yield text

        # Wait for process to finish.
        await proc.wait()
        _log_claude(effective_run_id, "EXIT", f"pid={proc.pid} code={proc.returncode}")

        # Capture stderr for diagnostics.
        if proc.stderr:
            stderr_text = (await proc.stderr.read()).decode("utf-8", "replace")
            if stderr_text.strip():
                yield f"\n[stderr]\n{stderr_text}"

        if proc.returncode != 0:
            yield f"\n[claude exited with code {proc.returncode}]"

        # Detect changed files (only on clean completion).
        changed = await _detect_changed_files(project_dir, marker, before_status)
        diff_info = await _capture_code_diff(project_dir, changed, before_status, before_snapshots)
        _log_claude(effective_run_id, "DONE", f"files={len(changed)}")

    except asyncio.CancelledError:
        if proc is not None:
            await _kill_process_tree(proc, effective_run_id)
        raise

    except FileNotFoundError:
        _log_claude(effective_run_id, "ERROR", "claude command not found")
        yield "\n[error] `claude` 命令未找到。请确认 Claude Code 已安装。\n"
        changed = []
        diff_info = {
            "available": False,
            "isGitRepo": False,
            "changedFiles": [],
            "diff": "",
            "truncated": False,
            "warnings": ["Claude Code CLI was not found."],
        }
    except Exception as e:
        _log_claude(effective_run_id, "ERROR", str(e))
        yield f"\n[error] 执行异常: {e}\n"
        changed = await _detect_changed_files(project_dir, marker, before_status)
        diff_info = await _capture_code_diff(project_dir, changed, before_status, before_snapshots)

    finally:
        _ACTIVE_CLAUDE_RUNS.pop(effective_run_id, None)
        # Clean up marker.
        if marker:
            try:
                os.remove(marker)
            except OSError:
                pass

    # Final marker (yield as a separate chunk so main.py can detect it cleanly).
    import json as _json
    yield f"__files__:{_json.dumps(changed)}"
    yield f"__diff__:{_json.dumps(diff_info)}"
