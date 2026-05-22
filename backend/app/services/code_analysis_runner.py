"""Read-only codebase analysis through Claude Code CLI."""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
import uuid
from typing import AsyncIterator

from app.services.code_runner import _ACTIVE_CLAUDE_RUNS, _kill_process_tree

CODE_ANALYSIS_SYSTEM = """你是 MindAgentGraph 的只读代码分析节点，运行在 Claude Code CLI 中。

## 任务
{task}
{purpose_hint}

## 工作目录
当前工作目录是：{project_dir}

## ContextMode
{context_mode}

## 文件范围建议
优先分析以下路径：
{allow_globs}
{banned_section}

## 上游参考
{parent_context}

## Memory
{memory_context}

## 严格规则
1. 只允许读取和分析项目文件，不要创建、修改、删除、移动任何文件。
2. 不要执行构建、测试、安装依赖、格式化或任何会改变工程状态的命令。
3. 不要调用写文件、编辑文件或 shell 写入类能力。
4. 如果需要更多信息，先基于已读文件给出最有用的分析，并列出还需要查看的文件。
5. 输出中文 Markdown，重点回答：项目结构、相关模块、实现入口、建议改动文件、风险、下一步 Code 节点应如何做。
"""


def _log_analysis(run_id: str, status: str, detail: str = "") -> None:
    suffix = f" {detail}" if detail else ""
    print(f"[ClaudeCodeAnalysis][{run_id}] {status}{suffix}", file=sys.stderr, flush=True)


def _assemble_analysis_prompt(
    *,
    node_title: str,
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
    allow = "\n".join(f"- {g}" for g in file_scope_allow) if file_scope_allow else "- 未设置，先从项目清单和关键入口开始"
    banned = ""
    if file_scope_deny:
        banned = "避免分析以下路径：\n" + "\n".join(f"- {g}" for g in file_scope_deny)

    mode = context_mode if context_mode in {"inherit", "explicit", "isolated"} else "explicit"
    parent_context = ""
    if mode == "inherit" and parent_outputs:
        for pid, text in parent_outputs.items():
            snippet = text[:1800] + ("..." if len(text) > 1800 else "")
            parent_context += f"\n### {pid}\n{snippet}\n"

    memory_context = "(无)"
    if mode == "inherit" and memory_text and memory_text.strip():
        memory_context = memory_text.strip()[:2000]
        if len(memory_text.strip()) > 2000:
            memory_context += "..."

    task = user_prompt.strip() if user_prompt and user_prompt.strip() else f"分析 {node_title} 节点相关代码"
    if system_prompt and system_prompt.strip():
        task = f"{system_prompt.strip()}\n\n{task}"
    purpose_hint = f"\n具体目标：{node_purpose}" if node_purpose else ""

    return CODE_ANALYSIS_SYSTEM.format(
        task=task,
        purpose_hint=purpose_hint,
        project_dir=project_dir,
        context_mode=mode,
        allow_globs=allow,
        banned_section=banned,
        parent_context=parent_context or "(无)",
        memory_context=memory_context,
    )


async def run_code_analysis_with_claude(
    *,
    node_title: str,
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
    effective_run_id = run_id or f"analysis-{uuid.uuid4().hex[:8]}"
    _log_analysis(effective_run_id, "START", f"node={node_title!r} cwd={project_dir}")
    if not os.path.isdir(project_dir):
        _log_analysis(effective_run_id, "ERROR", f"missing cwd={project_dir}")
        yield f"[error] 工程目录不存在: {project_dir}\n"
        return

    prompt = _assemble_analysis_prompt(
        node_title=node_title,
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

    claude_bin = shutil.which("claude")
    if not claude_bin:
        _log_analysis(effective_run_id, "ERROR", "claude command not found")
        yield (
            "[fallback] 未找到 `claude` 命令行工具。\n"
            "请安装 Claude Code CLI 或将 claude 加入 PATH。\n\n"
            f"## 节点：{node_title}\n\n"
            f"**目的**：{node_purpose}\n\n"
            f"**工作目录**：{project_dir}\n\n"
            f"**只读分析 prompt 预览**：\n```\n{prompt[:1600]}\n```\n"
        )
        return

    proc = None
    try:
        args = [
            claude_bin,
            "--print",
            "--no-session-persistence",
            "--output-format",
            "text",
            "--tools",
            "Read,Glob,Grep,LS",
        ]
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
        _log_analysis(effective_run_id, "RUNNING", f"pid={proc.pid}")
        if proc.stdin:
            proc.stdin.write(prompt.encode("utf-8"))
            await proc.stdin.drain()
            proc.stdin.close()

        assert proc.stdout is not None
        async for line in proc.stdout:
            yield line.decode("utf-8", "replace")

        await proc.wait()
        _log_analysis(effective_run_id, "EXIT", f"pid={proc.pid} code={proc.returncode}")
        if proc.stderr:
            stderr_text = (await proc.stderr.read()).decode("utf-8", "replace")
            if stderr_text.strip():
                yield f"\n[stderr]\n{stderr_text}"
        if proc.returncode != 0:
            yield f"\n[claude exited with code {proc.returncode}]"
    except asyncio.CancelledError:
        if proc is not None:
            await _kill_process_tree(proc, effective_run_id)
        raise
    except Exception as e:
        _log_analysis(effective_run_id, "ERROR", str(e))
        yield f"\n[error] 执行异常: {e}\n"
    finally:
        _ACTIVE_CLAUDE_RUNS.pop(effective_run_id, None)
