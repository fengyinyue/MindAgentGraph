"""Run a single non-code node with context, memory and streaming output."""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

from app.services.providers.base import ProviderError
from app.services.planner import _PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODELS

_log = logging.getLogger("mag.runner")

NODE_RUN_SYSTEM = """你是一个被绑定到某个“思维节点”上的助手。

每个节点是项目规划图中的一个独立单元，拥有自己的职责（title）、类型（type）和目的（purpose）。
用户会要求你在这个节点的语境下展开工作 —— 输出与该节点职责严格相关的内容。

输出原则：
1. 紧扣节点的 title / purpose；不要漫谈到节点之外的事
2. Markdown 格式，结构清晰（标题、列表、代码块）
3. 默认中文，除非用户用其他语言提问
4. 长度控制在 600 字以内，重点是密度而非全面"""

CONFIRMATION_PROTOCOL = """
If the node cannot produce a responsible result without user input, do not guess.
Return the useful partial work first, then append exactly one fenced block:

```mag-confirmation
{
  "title": "Need confirmation",
  "note": "Brief reason this blocks the node.",
  "questions": [
    {
      "id": "stable_snake_case_id",
      "label": "Question shown to the user",
      "description": "Optional context",
      "options": ["Optional choice A", "Optional choice B"],
      "placeholder": "Optional free text placeholder"
    }
  ]
}
```

Use options only for finite choices. Use no more than 3 questions.
"""


def _effective_system_prompt(system_prompt: str | None) -> str:
    base = system_prompt.strip() if system_prompt and system_prompt.strip() else NODE_RUN_SYSTEM
    return f"{base}\n\n{CONFIRMATION_PROTOCOL}"


async def run_node_stream(
    *,
    node_title: str,
    node_type: str,
    node_purpose: str,
    user_prompt: str | None,
    context_mode: str = "explicit",
    parent_outputs: dict[str, str] | None = None,
    memory_text: str | None = None,
    system_prompt: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> AsyncIterator[str]:
    chosen = (provider or DEFAULT_PROVIDER).lower()
    if chosen not in _PROVIDERS:
        raise ProviderError(f"unknown provider: {chosen}")
    impl = _PROVIDERS[chosen]
    chosen_model = model or DEFAULT_MODELS.get(chosen)

    user_message = _build_user_message(
        node_title=node_title,
        node_type=node_type,
        node_purpose=node_purpose,
        user_prompt=user_prompt,
        context_mode=context_mode,
        parent_outputs=parent_outputs,
        memory_text=memory_text,
    )

    try:
        async for chunk in impl.stream_text(
            system_prompt=_effective_system_prompt(system_prompt),
            user_message=user_message,
            model=chosen_model,
            api_key=api_key,
        ):
            yield chunk
    except ProviderError as e:
        _log.warning("provider=%s fell back to offline demo: %s", chosen, e)
        async for chunk in _offline_demo_stream(node_title, node_type, node_purpose, context_mode):
            yield chunk


def _build_user_message(
    *,
    node_title: str,
    node_type: str,
    node_purpose: str,
    user_prompt: str | None,
    context_mode: str,
    parent_outputs: dict[str, str] | None,
    memory_text: str | None,
) -> str:
    mode = context_mode if context_mode in {"inherit", "explicit", "isolated"} else "explicit"
    parts = [
        f"节点：{node_title}",
        f"类型：{node_type}",
        f"ContextMode：{mode}",
    ]
    if node_purpose:
        parts.append(f"目的：{node_purpose}")

    if mode == "inherit" and parent_outputs:
        blocks: list[str] = []
        for pid, text in parent_outputs.items():
            snippet = text[:1200] + ("…" if len(text) > 1200 else "")
            blocks.append(f"### {pid}\n{snippet}")
        if blocks:
            parts.append("\n## 上游输出\n" + "\n\n".join(blocks))

    if mode == "inherit" and memory_text and memory_text.strip():
        snippet = memory_text.strip()[:1600]
        if len(memory_text.strip()) > 1600:
            snippet += "…"
        parts.append("\n## Memory\n" + snippet)

    if user_prompt and user_prompt.strip():
        parts.append(f"\n## 节点 Prompt\n{user_prompt.strip()}")
    else:
        parts.append("\n请基于上面的节点信息，展开这个节点的具体内容。")
    return "\n".join(parts)


async def _offline_demo_stream(
    title: str,
    type_: str,
    purpose: str,
    context_mode: str,
) -> AsyncIterator[str]:
    chunks = [
        f"## {title}\n\n",
        f"_类型: `{type_}` / contextMode: `{context_mode}`_\n\n",
        "**当前为离线 demo 模式**（未配置 API key）。\n\n",
        "真实模式下会按 `contextMode` 注入上游输出和 memoryRef 对应的 `.mag/memory/` 内容。\n\n",
        f"节点目的：`{purpose or '(未填写 purpose)'}`\n",
    ]
    for c in chunks:
        await asyncio.sleep(0.08)
        yield c
