"""Run a single node (MVP minimal closed loop).

Context strategy (MVP):
  - Only the node's own title / type / data.purpose + the optional userPrompt
    are sent to the model. No parent chain, no fileScope, no tool calls.
  - This is intentional — contextMode / fileScope / parent summary are M2.

Output: an async generator of text chunks. Caller wraps it as SSE.
"""

from __future__ import annotations
import asyncio
import logging
import os
from typing import Any, AsyncIterator

from app.services.providers.base import ProviderError
from app.services.planner import _PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODELS

_log = logging.getLogger("mag.runner")

NODE_RUN_SYSTEM = """你是一个被绑定到某个"思维节点"上的助手。

每个节点是项目规划图中的一个独立单元，拥有自己的职责（title）、类型（type）和目的（purpose）。
用户会要求你在这个节点的语境下展开工作 —— 输出与该节点职责严格相关的内容。

输出原则：
1. 紧扣节点的 title / purpose；不要漫谈到节点之外的事
2. Markdown 格式，结构清晰（标题、列表、代码块）
3. 默认中文，除非用户用其他语言提问
4. 长度控制在 600 字以内，重点是密度而非全面"""


async def run_node_stream(
    *,
    node_title: str,
    node_type: str,
    node_purpose: str,
    user_prompt: str | None,
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
    )

    try:
        async for chunk in impl.stream_text(
            system_prompt=NODE_RUN_SYSTEM,
            user_message=user_message,
            model=chosen_model,
            api_key=api_key,
        ):
            yield chunk
    except ProviderError as e:
        # Same fallback philosophy as planner: keep UX demoable.
        _log.warning("provider=%s fell back to offline demo: %s", chosen, e)
        async for chunk in _offline_demo_stream(node_title, node_type, node_purpose):
            yield chunk


def _build_user_message(
    *,
    node_title: str,
    node_type: str,
    node_purpose: str,
    user_prompt: str | None,
) -> str:
    parts = [f"节点：{node_title}", f"类型：{node_type}"]
    if node_purpose:
        parts.append(f"目的：{node_purpose}")
    if user_prompt and user_prompt.strip():
        parts.append(f"\n用户要求：{user_prompt.strip()}")
    else:
        parts.append("\n请基于上面的节点信息，展开这个节点的具体内容。")
    return "\n".join(parts)


async def _offline_demo_stream(
    title: str, type_: str, purpose: str
) -> AsyncIterator[str]:
    """No key → emit a believable streaming demo so the UI flow is verifiable."""
    chunks = [
        f"## {title}\n\n",
        f"_类型: `{type_}`_\n\n",
        f"**当前为离线 demo 模式**（未配置 API key）。\n\n",
        "在真实模式下，AI 会基于此节点的 ",
        f"`{purpose or '(未填写 purpose)'}` ",
        "展开具体输出，例如：\n\n",
        "- 子任务拆解\n",
        "- 关键约束识别\n",
        "- 与上下游节点的接口建议\n\n",
        "前往 ⚙ 设置中填入 API key 即可启用真实生成。",
    ]
    for c in chunks:
        await asyncio.sleep(0.08)
        yield c
