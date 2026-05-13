"""Run a node with Claude Code CLI (`claude --print`).

Spawns a `claude` subprocess in the project directory with a node-specific
context (purpose, fileScope, parent outputs).  Streams stdout chunks back.
After the subprocess finishes, detects which files were created/modified
and appends a special marker event so the frontend can show a file list.
"""

from __future__ import annotations
import asyncio
import os
import shutil
from typing import AsyncIterator

CODE_RUN_SYSTEM = """你需要完成以下编程任务。直接执行，不要提问、不要解释、不要等确认。

## 任务
{task}
{purpose_hint}

## 工作目录
当前工作目录是：{project_dir}

## 文件约束
你**只能**在以下路径操作文件：
{allow_globs}
{banned_section}

## 上游参考
{parent_context}

## 规则
1. 直接调用 write_file / edit / bash 工具完成任务
2. 不要输出"我可以帮你..."之类的解释，直接干活
3. 生成完整可运行的代码
"""


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

    parent_context = ""
    if parent_outputs:
        for pid, text in parent_outputs.items():
            snippet = text[:600] + ("…" if len(text) > 600 else "")
            parent_context += f"\n上游节点 {pid} 的输出：\n{snippet}\n"

    task = user_prompt.strip() if user_prompt and user_prompt.strip() else f"实现 {node_title} 节点的全部代码（{node_purpose}）"
    purpose_hint = ""
    if node_purpose and not (user_prompt and user_prompt.strip()):
        purpose_hint = f"\n具体目标：{node_purpose}"

    return CODE_RUN_SYSTEM.format(
        project_dir=project_dir,
        allow_globs=allow,
        banned_section=banned,
        parent_context=parent_context or "(无)",
        task=task,
        purpose_hint=purpose_hint,
    )


async def _detect_changed_files(project_dir: str, before_marker_file: str | None) -> list[str]:
    """Return files created or modified since before_marker was written.

    Prefers ``git diff --name-status``; falls back to checking mtime.
    """
    # Git-based detection (use status porcelain for new + modified files)
    if os.path.isdir(os.path.join(project_dir, ".git")):
        try:
            proc = await asyncio.create_subprocess_exec(
                "git", "status", "--porcelain",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                cwd=project_dir,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            files: list[str] = []
            for line in stdout.decode("utf-8", "replace").strip().split("\n"):
                if not line:
                    continue
                # git status --porcelain: "XY filename" where X=index Y=worktree
                status_code = line[:2].strip()
                path = line[3:].strip()
                # Filter noise.
                if path.startswith("__pycache__") or path.startswith(".mag_"):
                    continue
                prefix = {
                    "??": "+", "A": "+", "M": "~", "AM": "+",
                    "D": "-", "R": "→",
                }.get(status_code, status_code)
                files.append(f"{prefix} {path}")
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
    model: str | None = None,
) -> AsyncIterator[str]:
    """Yield stdout chunks from ``claude --print``, then a final
    ``__files__:["+ src/a.py", ...]`` marker line."""
    if not os.path.isdir(project_dir):
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
    )

    # Marker file for timestamp-based file detection
    marker = os.path.join(project_dir, ".mag_code_run_marker")
    try:
        with open(marker, "w") as f:
            f.write("marker")
    except OSError:
        marker = None  # can't write? skip file detection

    claude_bin = shutil.which("claude")
    if not claude_bin:
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
        return

    try:
        args = [claude_bin, "--print", "--dangerously-skip-permissions"]
        if model:
            args += ["--model", model]

        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=project_dir,
            env={**os.environ, "NO_COLOR": "1", "CLAUDE_CODE_SIMPLE": "1"},
        )
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

        # Capture stderr for diagnostics.
        if proc.stderr:
            stderr_text = (await proc.stderr.read()).decode("utf-8", "replace")
            if stderr_text.strip():
                yield f"\n[stderr]\n{stderr_text}"

        if proc.returncode != 0:
            yield f"\n[claude exited with code {proc.returncode}]"

    except FileNotFoundError:
        yield "\n[error] `claude` 命令未找到。请确认 Claude Code 已安装。\n"
    except Exception as e:
        yield f"\n[error] 执行异常: {e}\n"

    # Detect changed files.
    changed = await _detect_changed_files(project_dir, marker)

    # Clean up marker.
    if marker:
        try:
            os.remove(marker)
        except OSError:
            pass

    # Final marker (yield as a separate chunk so main.py can detect it cleanly).
    import json as _json
    yield f"__files__:{_json.dumps(changed)}"
