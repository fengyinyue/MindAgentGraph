"""一句话 → 节点树 (DAG)。

核心思路：用 tool_use / tool_choice 强约束输出 schema，避免自由文本解析失败。
provider 抽象在 [providers/](providers/)：MVP 支持 anthropic + deepseek。
"""

from __future__ import annotations
import logging
import os
import uuid
from typing import Any

from app.schemas import Graph, Node, Edge, Position
from app.services.providers.base import PlanProvider, ProviderError
from app.services.providers.anthropic_provider import AnthropicProvider
from app.services.providers.deepseek_provider import DeepSeekProvider

_log = logging.getLogger("mag.planner")

# 默认 provider/model 来自 env，请求体可以覆盖。
DEFAULT_PROVIDER = os.environ.get("MAG_PROVIDER", "anthropic")
DEFAULT_MODELS = {
    "anthropic": os.environ.get("MAG_MODEL_ANTHROPIC", "claude-sonnet-4-6"),
    "deepseek": os.environ.get("MAG_MODEL_DEEPSEEK", "deepseek-chat"),
}

PLANNER_SYSTEM = """你是 MindAgentGraph 的项目规划助手。

你的任务：把用户的一句话目标，拆解成一个由"思维节点"组成的 DAG (有向无环图)。

节点类型说明：
- planning: 高层规划/总控节点（通常是根节点）
- prompt: 与 AI 对话生成内容的节点
- code: 代码实现节点
- asset: 资源/素材节点
- task: 待办任务节点
- memory: 记忆/上下文节点
- filescope: 文件作用域定义

设计原则：
1. 5-12 个节点，覆盖目标的关键模块
2. 每个节点应有清晰的单一职责
3. 用 links 表达数据依赖（A 的输出是 B 的输入）
4. 节点位置 (position) 要分散。layout 从上到下：同级节点 x 间距 ≥ 200（水平均匀散开），父子节点 y 间距 ≥ 300（向下延伸）
5. 根节点放在 (0,0)，下游节点向下展开，同层兄弟节点水平排列

必须用 emit_graph 工具返回结构化结果，不要写自由文本。"""

EMIT_GRAPH_TOOL = {
    "name": "emit_graph",
    "description": "Emit the planned node graph as structured JSON.",
    "input_schema": {
        "type": "object",
        "required": ["nodes", "links"],
        "properties": {
            "nodes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["id", "type", "title", "x", "y"],
                    "properties": {
                        "id": {"type": "string"},
                        "type": {
                            "type": "string",
                            "enum": [
                                "prompt", "planning", "memory", "filescope",
                                "code", "api", "asset", "agent", "task", "semantic",
                            ],
                        },
                        "title": {"type": "string"},
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "purpose": {"type": "string", "description": "What this node does"},
                    },
                },
            },
            "links": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["source", "target"],
                    "properties": {
                        "source": {"type": "string"},
                        "target": {"type": "string"},
                        "label": {"type": "string"},
                    },
                },
            },
        },
    },
}

_PROVIDERS: dict[str, PlanProvider] = {
    "anthropic": AnthropicProvider(),
    "deepseek": DeepSeekProvider(),
}


def _to_internal_graph(payload: dict[str, Any]) -> Graph:
    nodes: list[Node] = []
    for raw in payload.get("nodes", []):
        nodes.append(
            Node(
                id=raw["id"],
                type=raw["type"],
                title=raw["title"],
                position=Position(x=float(raw["x"]), y=float(raw["y"])),
                data={"purpose": raw.get("purpose", "")},
            )
        )
    links: list[Edge] = []
    for raw in payload.get("links", []):
        links.append(
            Edge(
                id=str(uuid.uuid4()),
                source=raw["source"],
                target=raw["target"],
                channel=None,
            )
        )
    return Graph(nodes=nodes, links=links)


async def plan_graph(
    goal: str,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> Graph:
    chosen = (provider or DEFAULT_PROVIDER).lower()
    if chosen not in _PROVIDERS:
        raise ProviderError(f"unknown provider: {chosen}")
    impl = _PROVIDERS[chosen]
    chosen_model = model or DEFAULT_MODELS.get(chosen)

    try:
        payload = await impl.emit_graph(
            system_prompt=PLANNER_SYSTEM,
            user_goal=goal,
            tool_schema=EMIT_GRAPH_TOOL,
            model=chosen_model,
            api_key=api_key,
        )
        return _to_internal_graph(payload)
    except ProviderError as e:
        # No API key OR provider refused → fall back to offline demo so the
        # UI flow stays demonstrable. We still log so users notice.
        _log.warning("provider=%s fell back to offline demo: %s", chosen, e)
        return _offline_demo(goal)


def _offline_demo(goal: str) -> Graph:
    """No API key → 返回硬编码示例，让 UI 流程可演示。"""
    nodes_raw = [
        {"id": "root", "type": "planning", "title": goal[:30] or "Project", "x": 0, "y": 0},
        {"id": "design", "type": "prompt", "title": "需求拆解", "x": -220, "y": 300},
        {"id": "data", "type": "memory", "title": "项目记忆", "x": 0, "y": 300},
        {"id": "impl", "type": "code", "title": "代码实现", "x": 220, "y": 300},
        {"id": "test", "type": "task", "title": "测试验证", "x": 0, "y": 600},
    ]
    links_raw = [
        {"source": "root", "target": "design"},
        {"source": "root", "target": "data"},
        {"source": "design", "target": "impl"},
        {"source": "data", "target": "impl"},
        {"source": "impl", "target": "test"},
    ]
    return _to_internal_graph({"nodes": nodes_raw, "links": links_raw})
