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
from app.services.providers.local_cli_provider import LocalCliProvider

_log = logging.getLogger("mag.planner")

# 默认 provider/model 来自 env，请求体可以覆盖。
DEFAULT_PROVIDER = os.environ.get("MAG_PROVIDER", "anthropic")
DEFAULT_MODELS = {
    "anthropic": os.environ.get("MAG_MODEL_ANTHROPIC", "claude-sonnet-4-6"),
    "deepseek": os.environ.get("MAG_MODEL_DEEPSEEK", "deepseek-chat"),
    "local-claude": os.environ.get("MAG_MODEL_LOCAL_CLAUDE", "sonnet"),
    "local-codex": os.environ.get("MAG_MODEL_LOCAL_CODEX", ""),
}

PLANNER_SYSTEM = """你是 MindAgentGraph 的项目规划助手。

你的任务：把用户的一句话目标，拆解成一个由"思维节点"组成的 DAG (有向无环图)。

节点类型说明：
- planning: 高层规划/总控节点（通常是根节点）
- prompt: 与 AI 对话生成内容的节点
- code: 代码实现节点
- project_scan: 只读扫描已有工程结构，输出技术栈、关键文件、改动边界和风险
- code_analysis: 使用 Claude Code 只读分析已有代码，输出架构理解、实现入口、风险和建议改动范围
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
                                "project_scan", "code_analysis", "code", "api", "asset", "agent", "task", "semantic",
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
    "local-claude": LocalCliProvider("claude"),
    "local-codex": LocalCliProvider("codex"),
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
                contextMode="inherit",
                memoryRef=f"{raw['id']}.md" if raw["type"] == "memory" else None,
                purpose=raw.get("purpose", ""),
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


EXPAND_SYSTEM = """你是 MindAgentGraph 的项目规划助手。

你的任务：根据已有的高层规划文本，将其拆解成一组节点组成的 DAG (有向无环图)。

节点类型选择规则：
- 小/中型项目（单一系统，如"番茄钟"、"Markdown编辑器"）：直接生成实现节点（code、task、prompt），不要创建 planning 子节点
- 大型项目（覆盖多个独立子系统，如"电商平台"、"游戏引擎"）：可以为每个子系统创建一个 planning 节点（后续可各自 Explain + Generate Nodes 展开），子系统之间直接生成实现节点
- 如果规划文本包含"当前项目"、"已有项目"、"现有代码"、"修复"、"改造"、"接入"、"重构"等已有工程开发意图，优先生成一个 project_scan 节点
- project_scan 节点必须位于后续 code_analysis/prompt/task/code 节点上游，用 links 表达依赖
- 对需要理解真实代码结构的已有项目改动，在 project_scan 后生成 code_analysis 节点，再让 code 节点依赖 code_analysis
- 如果输入中提供了"已有图上下文"，且其中已经存在可复用的 project_scan 或 code_analysis 节点，优先复用这些已有上下文，不要重复生成同类扫描/分析节点
- 工具返回的 links 只能连接本次返回的 nodes；如果需要依赖已有节点，请在新节点 purpose 中明确写"依赖已有节点：<title>"
- 全新项目、纯文案/创作任务、独立代码片段，不要生成 project_scan 节点

节点类型说明：
- planning: 仅用于大型项目中独立子系统的规划入口
- project_scan: 只读扫描已有工程结构，输出技术栈、关键文件、改动边界和风险
- code_analysis: 使用 Claude Code 只读分析已有代码，输出架构理解、实现入口、风险和建议改动范围
- code: 代码实现节点
- prompt: 与 AI 对话生成内容的节点
- asset: 资源/素材节点
- task: 待办任务节点
- memory: 记忆/上下文节点
- filescope: 文件作用域定义

设计原则：
1. 3-10 个节点，覆盖规划中的关键模块
2. 每个节点应有清晰的单一职责
3. 用 links 表达数据依赖（A 的输出是 B 的输入）
4. 节点位置 (position) 分散。同级节点 x 间距 ≥ 200，父子节点 y 间距 ≥ 250
5. 根节点放在 (0,0)，下游节点向下展开，同层兄弟节点水平排列
6. 节点的 purpose 字段要具体

必须用 emit_graph 工具返回结构化结果，不要写自由文本。"""


async def expand_plan(
    plan_text: str,
    existing_nodes: list[dict[str, Any]] | None = None,
    upstream_outputs: dict[str, str] | None = None,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> dict[str, object]:
    """将规划文本展开为子节点+连线。返回 {"nodes": [...], "links": [...]}。"""
    chosen = (provider or DEFAULT_PROVIDER).lower()
    if chosen not in _PROVIDERS:
        raise ProviderError(f"unknown provider: {chosen}")
    impl = _PROVIDERS[chosen]
    chosen_model = model or DEFAULT_MODELS.get(chosen)

    try:
        user_goal = _build_expand_user_goal(
            plan_text=plan_text,
            existing_nodes=existing_nodes or [],
            upstream_outputs=upstream_outputs or {},
        )
        payload = await impl.emit_graph(
            system_prompt=EXPAND_SYSTEM,
            user_goal=user_goal,
            tool_schema=EMIT_GRAPH_TOOL,
            model=chosen_model,
            api_key=api_key,
        )
        return payload
    except ProviderError as e:
        _log.warning("expand_plan provider=%s failed: %s", chosen, e)
        raise


def _build_expand_user_goal(
    *,
    plan_text: str,
    existing_nodes: list[dict[str, Any]],
    upstream_outputs: dict[str, str],
) -> str:
    if not existing_nodes and not upstream_outputs:
        return plan_text

    parts = [
        "## 当前规划文本",
        plan_text,
        "",
        "## 已有图上下文",
        "这些节点已经存在于画布中。生成新节点时应避免重复创建同类上下文节点。",
    ]
    if existing_nodes:
        for node in existing_nodes[:12]:
            output = str(node.get("outputSummary") or "").strip()
            output_line = f"\n  output摘要: {output[:900]}" if output else ""
            parts.append(
                f"- id={node.get('id')} type={node.get('type')} title={node.get('title')} "
                f"hasOutput={node.get('hasOutput')} purpose={node.get('purpose') or ''}{output_line}"
            )
    else:
        parts.append("- 无")

    if upstream_outputs:
        parts.extend(["", "## Planning 上游输出摘要"])
        for key, text in list(upstream_outputs.items())[:8]:
            snippet = text.strip()[:1000]
            parts.append(f"### {key}\n{snippet}")

    parts.extend([
        "",
        "## 生成要求",
        "- 如果已有图上下文中存在 hasOutput=true 的 project_scan，不要重复生成 project_scan。",
        "- 如果已有图上下文中存在 hasOutput=true 的 code_analysis，不要重复生成 code_analysis。",
        "- 如果新节点需要依赖已有上下文，请在新节点 purpose 中明确写出依赖哪个已有节点。",
        "- 只生成仍然缺失的执行节点、任务节点或代码节点。",
    ])
    return "\n".join(parts)


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
