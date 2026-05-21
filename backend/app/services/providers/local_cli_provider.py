"""Local CLI providers for already-configured Claude/Codex accounts.

These providers are intended for planning and normal node expansion. They run
the local CLI in non-interactive/read-only style and parse stdout. Code-writing
nodes should continue to use code_runner.py, which has project/file-scope
handling and cancellation.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shlex
import shutil
from typing import Any, AsyncIterator, Literal

from app.services.providers.base import ProviderError


ProviderKind = Literal["claude", "codex"]


class LocalCliProvider:
    def __init__(self, kind: ProviderKind):
        self.kind = kind
        self.name = f"local-{kind}"

    async def emit_graph(
        self,
        *,
        system_prompt: str,
        user_goal: str,
        tool_schema: dict[str, Any],
        model: str | None = None,
        api_key: str | None = None,
    ) -> dict[str, Any]:
        del api_key
        schema_desc = json.dumps(tool_schema["input_schema"], ensure_ascii=False, indent=2)
        prompt = (
            f"{system_prompt}\n\n"
            "你必须只输出一个 JSON object，不要输出 markdown fence、解释或额外文本。\n"
            f"JSON 必须匹配这个 schema:\n{schema_desc}\n\n"
            f"目标：{user_goal}"
        )
        raw = await _run_cli_once(self.kind, prompt, model=model)
        parsed = _extract_json(raw)
        if isinstance(parsed, dict):
            return parsed
        raise ProviderError(f"{self.name} returned unparseable JSON")

    async def stream_text(
        self,
        *,
        system_prompt: str,
        user_message: str,
        model: str | None = None,
        api_key: str | None = None,
        max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        del api_key, max_tokens
        prompt = f"{system_prompt}\n\n---\n\n{user_message}"
        async for chunk in _run_cli_stream(self.kind, prompt, model=model):
            yield chunk


def _find_executable(kind: ProviderKind) -> str:
    env_key = "MAG_LOCAL_CLAUDE_CMD" if kind == "claude" else "MAG_LOCAL_CODEX_CMD"
    override = os.environ.get(env_key)
    if override:
        # Return the first token; full override args are handled in _base_args.
        return shlex.split(override)[0]

    candidates = ["claude.cmd", "claude"] if kind == "claude" else ["codex.cmd", "codex"]
    for candidate in candidates:
        found = shutil.which(candidate)
        if found:
            return found
    raise ProviderError(f"local {kind} CLI not found in PATH")


def _base_args(kind: ProviderKind, model: str | None) -> list[str]:
    env_key = "MAG_LOCAL_CLAUDE_CMD" if kind == "claude" else "MAG_LOCAL_CODEX_CMD"
    override = os.environ.get(env_key)
    if override:
        args = shlex.split(override)
    elif kind == "claude":
        args = [
            _find_executable(kind),
            "--print",
            "--no-session-persistence",
            "--output-format",
            "text",
            "--tools",
            "",
        ]
        if model:
            args += ["--model", model]
    else:
        args = [
            _find_executable(kind),
            "exec",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "--color",
            "never",
        ]
        if model:
            args += ["--model", model]
        args.append("-")
    return args


async def _run_cli_once(kind: ProviderKind, prompt: str, model: str | None = None) -> str:
    chunks: list[str] = []
    async for chunk in _run_cli_stream(kind, prompt, model=model):
        chunks.append(chunk)
    return "".join(chunks)


async def _run_cli_stream(kind: ProviderKind, prompt: str, model: str | None = None) -> AsyncIterator[str]:
    args = _base_args(kind, model)
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "NO_COLOR": "1"},
        )
    except FileNotFoundError as exc:
        raise ProviderError(f"local {kind} CLI not found") from exc

    if proc.stdin:
        proc.stdin.write(prompt.encode("utf-8"))
        await proc.stdin.drain()
        proc.stdin.close()

    assert proc.stdout is not None
    async for line in proc.stdout:
        yield line.decode("utf-8", "replace")

    await proc.wait()
    stderr = ""
    if proc.stderr:
        stderr = (await proc.stderr.read()).decode("utf-8", "replace").strip()
    if proc.returncode != 0:
        detail = f": {stderr}" if stderr else ""
        raise ProviderError(f"local {kind} CLI exited with code {proc.returncode}{detail}")


_MD_FENCE = re.compile(r"```(?:json)?\s*\n?(.*?)\n?```", re.DOTALL)


def _extract_json(text: str) -> Any | None:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = _MD_FENCE.search(text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    try:
        decoder = json.JSONDecoder()
        idx = 0
        while idx < len(text) and text[idx].isspace():
            idx += 1
        obj, _end = decoder.raw_decode(text, idx)
        return obj
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass
    return None
