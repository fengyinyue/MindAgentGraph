"""Run a single non-code node with context, memory and streaming output."""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

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
4. 长度控制在 600 字以内，重点是密度而非全面
5. 不要尝试读取文件或探索项目目录，直接基于你的知识输出文本"""

WORKFLOW_RUN_SYSTEM = """你是 MindAgentGraph 的 Design 节点助手。

当前节点类型是 planning。你的任务是根据节点 purpose 和直接输入，产出该节点负责的设计结果。
Design 节点不等同于软件开发规划；它可以用于软件设计、内容设定、创作整合、流程规划或决策整理。

输出原则：
1. 优先服从节点自己的 purpose 和 systemPrompt。
2. 如果 purpose 要求生成最终内容，就直接输出成品内容，不要输出计划。
3. 如果 purpose 要求规划流程，才输出阶段、职责、交付物和风险。
4. 不要默认生成 Mermaid、实现步骤、测试计划或工程验收标准，除非节点明确要求。
5. 只使用当前节点的直接输入，不自动假设祖先节点内容。
6. 默认中文，使用结构清晰的 Markdown。
7. 不要尝试读取文件、探索目录或执行任何命令。"""

STRUCTURE_RUN_SYSTEM = """你是 MindAgentGraph 的 Subgraph 结构设计助手。

当前节点类型是 subgraph。你的职责是输出结构化数据流/依赖设计，供后续 Generate Nodes 生成端口化内部子图。

输出原则：
1. 聚焦输入、处理节点、输出、数据类型、依赖关系和关键接口
2. 可以描述端口级数据流，但不要安排项目管理阶段、测试计划或代码执行路线
3. 明确哪些数据从哪个节点流向哪个节点，适合后续生成 asset/code/task 节点
4. Markdown 格式，默认中文，控制在 600 字以内
5. 不要尝试读取文件、探索目录或执行任何命令"""

CONFIRMATION_PROTOCOL = """
如果当前节点缺少必要信息，无法负责任地产出结果，不要猜测。
请先输出已经能确定的有用内容，然后在末尾追加且只追加一个 fenced block：

```mag-confirmation
{
  "title": "需要确认",
  "note": "简要说明为什么这个问题会阻塞当前节点。",
  "questions": [
    {
      "id": "stable_snake_case_id",
      "label": "展示给用户的问题",
      "description": "可选的背景说明",
      "options": ["可选项 A", "可选项 B"],
      "placeholder": "可选的自由输入占位文本"
    }
  ]
}
```

只有在选项有限时才使用 options。最多提出 3 个问题。
"""


def _effective_system_prompt(system_prompt: str | None, node_type: str = "") -> str:
    if system_prompt and system_prompt.strip():
        base = system_prompt.strip()
    elif node_type == "planning":
        base = WORKFLOW_RUN_SYSTEM
    elif node_type == "subgraph":
        base = STRUCTURE_RUN_SYSTEM
    else:
        base = NODE_RUN_SYSTEM
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
            system_prompt=_effective_system_prompt(system_prompt, node_type),
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
            snippet = text[:1200] + ("..." if len(text) > 1200 else "")
            blocks.append(f"### {pid}\n{snippet}")
        if blocks:
            parts.append("\n## 上游输出\n" + "\n\n".join(blocks))

    if mode == "inherit" and memory_text and memory_text.strip():
        snippet = memory_text.strip()[:1600]
        if len(memory_text.strip()) > 1600:
            snippet += "..."
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
